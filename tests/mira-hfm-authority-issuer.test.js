'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { issueMemoryReadAuthority } = require('../services/mira-hfm-authority-issuer');
const {
  REQUIRED_TRUE, REQUIRED_FALSE, verifyAuthorityIssuerPreflight,
  getAuthorityIssuerConfig
} = require('../services/mira-hfm-authority-issuer-runtime');

const now = Date.now();
const subject = '11111111-1111-4111-8111-111111111111';
const sessionID = 'hfm-authority-issuer-session-001';
const actorId = 'mira:mira.admins:' + subject;
const projectId = 'project-alpha';
const principal = {
  verified: true, issuer: 'mira.admins', subject, actorType: 'HUMAN',
  authenticationMethod: 'ADMIN_SUBJECT', authenticationRef: sessionID,
  authenticatedAt: new Date(now - 60000).toISOString(),
  expiresAt: new Date(now + 3600000).toISOString()
};
const req = {
  role: 'admin', sessionID,
  session: {
    authenticated: true, role: 'admin', hfmPrincipal: principal,
    hfmProjectBinding: {
      verified: true, bindingVersion: 'HFM_PROJECT_BINDING_V1',
      actorId, projectId, selectedAt: new Date(now - 30000).toISOString()
    }
  }
};
const receipt = {
  verified: true, approved: true, consumed: true, maxUses: 1,
  approvalRef: 'human-approval-issuer-test',
  projectId, actorId, approverActorId: actorId, operation: 'memory.read',
  resource: 'memory:project:' + projectId,
  purpose: 'approved memory retrieval',
  issuedAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 120000).toISOString(),
  maxUses: 1
};
const calls = [];
const client = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM mira_hfm.project_owners')) {
      return { rows: [{ revision: 5, status: 'ACTIVE' }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT (status =')) {
      return { rows: [{ membership_valid: true }], rowCount: 1 };
    }
    if (sql.includes('FROM mira_hfm.project_memberships')) {
      return { rows: [{
        revision: 7, status: 'ACTIVE',
        permissions: { operations: ['memory.read'] },
        valid_from: new Date(now - 60000).toISOString(), expires_at: null
      }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO mira_hfm.operation_authorities')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  },
  release() {}
};
const pool = { async connect() { return client; } };

(async () => {
  const result = await issueMemoryReadAuthority({
    req, pool, purpose: receipt.purpose, approvalToken: 'signed-approval-token',
    env: { MIRA_ADMIN_SUBJECT_ID: subject },
    verifyApprovalToken: async (token, expected, options) => {
      assert.equal(token, 'signed-approval-token');
      assert.deepEqual(options, { consume: true, singleUse: true });
      assert.deepEqual(expected, {
        projectId, actorId, approverActorId: actorId, operation: 'memory.read',
        resource: 'memory:project:' + projectId, purpose: receipt.purpose
      });
      return receipt;
    }
  });
  assert.equal(result.status, 'AUTHORITY_ISSUED');
  assert.equal(result.singleUse, true);
  assert.equal(result.projectId, projectId);
  assert.ok(Date.parse(result.expiresAt) <= Date.parse(receipt.expiresAt));
  assert.equal(calls.filter(c => c.sql.startsWith('INSERT INTO mira_hfm.operation_authorities')).length, 1);
  assert.equal(calls.filter(c => c.sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')).length, 1);
  assert.ok(calls.some(c => c.sql === 'COMMIT'));
  assert.ok(calls.some(c => c.sql.includes("set_config('mira.actor_id'") && c.params[0] === actorId));
  assert.equal(calls.find(c => c.sql.startsWith('INSERT INTO mira_hfm.operation_authorities')).params[2], actorId);
  console.log('HFM_AUTHORITY_ISSUER_VERIFIED_ADMIN_AND_APPROVAL=PASS');
  console.log('HFM_AUTHORITY_ISSUER_SINGLE_USE_SHORT_TTL=PASS');
  console.log('HFM_AUTHORITY_ISSUER_AND_AUDIT_ATOMIC=PASS');

  await assert.rejects(() => issueMemoryReadAuthority({
    req, pool, purpose: receipt.purpose, approvalToken: 'bad',
    env: { MIRA_ADMIN_SUBJECT_ID: subject },
    verifyApprovalToken: async () => ({ ...receipt, projectId: 'project-attacker' })
  }), /HFM_AUTHORITY_APPROVAL_SCOPE_MISMATCH/);
  console.log('HFM_AUTHORITY_ISSUER_SCOPE_MISMATCH_BLOCK=PASS');

  await assert.rejects(() => issueMemoryReadAuthority({
    req, pool, purpose: receipt.purpose, approvalToken: 'bad',
    env: { MIRA_ADMIN_SUBJECT_ID: '22222222-2222-4222-8222-222222222222' },
    verifyApprovalToken: async () => receipt
  }), /HFM_AUTHORITY_ADMIN_SUBJECT_NOT_CONFIGURED/);
  console.log('HFM_AUTHORITY_ISSUER_STABLE_ADMIN_SUBJECT_REQUIRED=PASS');

  await assert.rejects(() => issueMemoryReadAuthority({
    req: { ...req, role: 'user', session: { ...req.session, role: 'user' } },
    pool, purpose: receipt.purpose, approvalToken: 'token',
    env: { MIRA_ADMIN_SUBJECT_ID: subject },
    verifyApprovalToken: async () => receipt
  }), /HFM_AUTHORITY_ADMIN_PROJECT_CONTEXT_REQUIRED/);
  console.log('HFM_AUTHORITY_ISSUER_NON_ADMIN_BLOCK=PASS');

  const missingVerifier = { ...req, session: { ...req.session, hfmProjectBinding: req.session.hfmProjectBinding } };
  await assert.rejects(() => issueMemoryReadAuthority({
    req: missingVerifier, pool, purpose: receipt.purpose,
    approvalToken: 'token', env: { MIRA_ADMIN_SUBJECT_ID: subject }
  }), /HFM_AUTHORITY_APPROVAL_VERIFIER_REQUIRED/);
  console.log('HFM_AUTHORITY_ISSUER_MISSING_VERIFIER_BLOCK=PASS');

  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations/hfm/008_authority_issuer_role.sql'), 'utf8');
  assert.match(migration, /NOLOGIN NOINHERIT NOSUPERUSER/);
  assert.match(migration, /GRANT INSERT ON TABLE mira_hfm\.operation_authorities/);
  assert.match(migration, /event_type = 'AUTHORITY_ISSUED'/);
  assert.match(migration, /operation = 'memory\.read'/);
  assert.match(migration, /issued_by_actor_id = NULLIF\\(current_setting\\('mira\\.actor_id'/);
  assert.match(migration, /resource = 'memory:project:' \\|\\| NULLIF/);
  assert.match(migration, /expires_at <= clock_timestamp\(\) \+ interval '5 minutes'/);
  assert.doesNotMatch(migration, /GRANT[^;]+UPDATE/i);
  assert.doesNotMatch(migration, /GRANT[^;]+DELETE/i);
  console.log('HFM_AUTHORITY_ISSUER_ROLE_MIGRATION_LEAST_PRIVILEGE=PASS');

  const config = getAuthorityIssuerConfig({});
  assert.equal(config.enabled, false);
  const row = {};
  for (const key of REQUIRED_TRUE) row[key] = true;
  for (const key of REQUIRED_FALSE) row[key] = false;
  row.current_role = 'mira_hfm_issuer_login';
  row.database_name = 'mira_hfm_test';
  assert.equal(verifyAuthorityIssuerPreflight(row, {
    expectedRole: row.current_role, databaseName: row.database_name
  }).status, 'AUTHORITY_ISSUER_READY');
  assert.throws(() => verifyAuthorityIssuerPreflight({ ...row, authorities_update: true }, {
    expectedRole: row.current_role, databaseName: row.database_name
  }), /AUTHORITY_ISSUER_EXCESS_PRIVILEGE_DETECTED/);
  console.log('HFM_AUTHORITY_ISSUER_RUNTIME_FAIL_CLOSED_PREFLIGHT=PASS');
  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
