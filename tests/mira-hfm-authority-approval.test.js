'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  issueApprovalToken, createDatabaseApprovalVerifier
} = require('../services/mira-hfm-authority-approval');

const now = Date.now();
const subject = '11111111-1111-4111-8111-111111111111';
const actorId = 'mira:mira.admins:' + subject;
const projectId = 'project-alpha';
const sessionID = 'approval-test-session';
const secret = 'hfm-approval-token-test-secret-32-bytes-minimum';
const req = {
  role: 'admin', sessionID,
  session: {
    authenticated: true, role: 'admin',
    hfmPrincipal: {
      verified: true, issuer: 'mira.admins', subject,
      actorType: 'HUMAN', authenticationMethod: 'ADMIN_SUBJECT',
      authenticationRef: sessionID,
      authenticatedAt: new Date(now - 30000).toISOString(),
      expiresAt: new Date(now + 3600000).toISOString()
    },
    hfmProjectBinding: {
      verified: true, bindingVersion: 'HFM_PROJECT_BINDING_V1',
      actorId, projectId, selectedAt: new Date(now - 10000).toISOString()
    }
  }
};
const calls = [];
let nonceConsumed = false;
const client = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM mira_hfm.project_owners')) {
      return { rows: [{ revision: 4, status: 'ACTIVE' }], rowCount: 1 };
    }
    if (sql.includes('FROM mira_hfm.project_memberships')) {
      return { rows: [{
        revision: 8, status: 'ACTIVE', permissions: { operations: ['memory.read', 'memory.write', 'memory.trash', 'memory.restore'] }
      }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO mira_hfm.authority_approval_nonces')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE mira_hfm.authority_approval_nonces')) {
      if (nonceConsumed) return { rows: [], rowCount: 0 };
      nonceConsumed = true;
      return { rows: [{ nonce_hash: params[0] }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  },
  release() {}
};
const pool = { async connect() { return client; } };
const env = {
  MIRA_ADMIN_SUBJECT_ID: subject,
  MIRA_HFM_APPROVAL_TOKEN_SECRET: secret
};

(async () => {
  const issued = await issueApprovalToken({
    req, pool, env, secret,
    purpose: 'approved retrieval',
    approvalConfirmed: true
  });
  assert.equal(issued.status, 'APPROVAL_TOKEN_ISSUED');
  assert.equal(issued.singleUse, true);
  assert.equal(typeof issued.token, 'string');
  assert.equal(issued.token.includes(issued.approvalRef), false);
  assert.ok(calls.some(c => c.sql.startsWith('INSERT INTO mira_hfm.authority_approval_nonces')));
  assert.ok(calls.some(c => c.sql.includes("'APPROVAL_TOKEN_ISSUED'")));
  assert.ok(calls.some(c => c.sql === 'COMMIT'));
  const insert = calls.find(c => c.sql.startsWith('INSERT INTO mira_hfm.authority_approval_nonces'));
  assert.equal(insert.params[0].length, 64);
  assert.equal(insert.params[3], actorId);
  console.log('HFM_APPROVAL_ISSUE_RECENT_ADMIN_AND_EXPLICIT_CONFIRMATION=PASS');
  console.log('HFM_APPROVAL_NONCE_HASH_ONLY_PERSISTED=PASS');
  console.log('HFM_APPROVAL_ISSUANCE_AUDITED=PASS');

  const trashApproval = await issueApprovalToken({
    req, pool, env, secret,
    purpose: 'user confirmed Facebook-published draft trash',
    operation: 'memory.trash',
    resource: 'memory:social-draft-001',
    approvalConfirmed: true
  });
  assert.equal(trashApproval.operation, 'memory.trash');
  assert.equal(trashApproval.resource, 'memory:social-draft-001');
  const trashInsert = calls.filter(c => c.sql.startsWith('INSERT INTO mira_hfm.authority_approval_nonces')).at(-1);
  assert.equal(trashInsert.params[4], 'memory.trash');
  assert.equal(trashInsert.params[5], 'memory:social-draft-001');
  console.log('HFM_APPROVAL_BINDS_EXACT_MEMORY_TRASH_RESOURCE=PASS');

  await assert.rejects(
    issueApprovalToken({
      req, pool, env, secret, purpose: 'permanent purge',
      operation: 'memory.purge', resource: 'memory:social-draft-001',
      approvalConfirmed: true
    }),
    error => error.code === 'HFM_AUTHORITY_OPERATION_NOT_ALLOWED'
  );
  console.log('HFM_APPROVAL_PERMANENT_PURGE_NOT_APPROVABLE=PASS');

  const verify = createDatabaseApprovalVerifier({ pool, env, secret });
  const expected = {
    projectId, actorId, approverActorId: actorId,
    operation: 'memory.read',
    resource: 'memory:project:' + projectId,
    purpose: 'approved retrieval'
  };
  const receipt = await verify(issued.token, expected, { consume: true, singleUse: true });
  assert.equal(receipt.verified, true);
  assert.equal(receipt.consumed, true);
  assert.equal(receipt.approverActorId, actorId);
  assert.ok(calls.some(c => c.sql.startsWith('UPDATE mira_hfm.authority_approval_nonces')));
  assert.ok(calls.some(c => c.sql.includes("'APPROVAL_TOKEN_CONSUMED'")));
  console.log('HFM_APPROVAL_NONCE_ATOMIC_CONSUMPTION_AND_AUDIT=PASS');

  await assert.rejects(
    verify(issued.token, expected, { consume: true, singleUse: true }),
    error => error.code === 'HFM_APPROVAL_TOKEN_REPLAY_OR_UNKNOWN'
  );
  console.log('HFM_APPROVAL_DATABASE_REPLAY_BLOCK=PASS');

  await assert.rejects(
    issueApprovalToken({
      req, pool, env, secret, purpose: 'no explicit click',
      approvalConfirmed: false
    }),
    error => error.code === 'HFM_APPROVAL_EXPLICIT_CONFIRMATION_REQUIRED'
  );
  console.log('HFM_APPROVAL_MISSING_EXPLICIT_CONFIRMATION_BLOCK=PASS');

  const staleReq = {
    ...req,
    session: {
      ...req.session,
      hfmPrincipal: {
        ...req.session.hfmPrincipal,
        authenticatedAt: new Date(now - 10 * 60 * 1000).toISOString()
      }
    }
  };
  await assert.rejects(
    issueApprovalToken({
      req: staleReq, pool, env, secret, purpose: 'stale login',
      approvalConfirmed: true
    }),
    error => error.code === 'HFM_APPROVAL_RECENT_AUTHENTICATION_REQUIRED'
  );
  console.log('HFM_APPROVAL_STALE_ADMIN_SESSION_BLOCK=PASS');

  await assert.rejects(
    issueApprovalToken({
      req, pool, env: { ...env, MIRA_ADMIN_SUBJECT_ID: 'another-subject' },
      secret, purpose: 'wrong admin', approvalConfirmed: true
    }),
    error => error.code === 'HFM_APPROVAL_ADMIN_SUBJECT_NOT_CONFIGURED'
  );
  console.log('HFM_APPROVAL_ADMIN_SUBJECT_MISMATCH_BLOCK=PASS');

  const approvalService = fs.readFileSync(path.join(__dirname, '..', 'services/mira-hfm-authority-approval.js'), 'utf8');
  assert.doesNotMatch(approvalService, /UPDATE mira_hfm\.authority_approval_nonces[\s\S]{0,900}RETURNING/i);
  console.log('HFM_APPROVAL_NONCE_CONSUMPTION_DOES_NOT_BYPASS_POST_UPDATE_RLS=PASS');

  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations/hfm/009_authority_approval_nonce_registry.sql'), 'utf8');
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.ok(migration.includes('GRANT UPDATE (consumed_at)'));
  assert.ok(migration.includes('authority_approval_nonces_actor_is_approver'));
  assert.ok(migration.includes('resource = \'memory:project:\' || NULLIF(current_setting(\'mira.project_id\', true), \'\')'));
  assert.match(migration, /consumed_at IS NULL/);
  assert.match(migration, /consumed_at IS NOT NULL/);
  assert.ok(migration.includes("operation IN ('memory.read','memory.write','memory.trash','memory.restore')"));
  assert.ok(migration.includes('WITH CHECK (consumed_at IS NOT NULL);'));
  assert.doesNotMatch(migration, /GRANT[^;]+DELETE/i);
  assert.doesNotMatch(migration, /GRANT[^;]+TRUNCATE/i);
  console.log('HFM_APPROVAL_NONCE_MIGRATION_LEAST_PRIVILEGE=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
