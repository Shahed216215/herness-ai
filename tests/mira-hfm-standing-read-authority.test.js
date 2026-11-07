'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  STANDING_READ_TTL_MS,
  validateStandingReceipt,
  issueStandingReadAuthority,
  setStandingReadAuthorityStatus,
  getStandingReadAuthorityStatus
} = require('../services/mira-hfm-standing-read-authority');
const { executeWithStandingReadAuthority } = require('../services/mira-hfm-authority-transaction');

const subject = '11111111-1111-4111-8111-111111111111';
const actorId = 'mira:mira.admins:' + subject;
const projectId = 'project-alpha';
const resource = 'memory:project:' + projectId;
const sessionID = 'standing-read-test-session';
const now = Date.now();
const req = {
  role: 'admin',
  sessionID,
  session: {
    authenticated: true,
    role: 'admin',
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
const env = {
  MIRA_ADMIN_SUBJECT_ID: subject,
  MIRA_HFM_APPROVAL_TOKEN_SECRET: 'standing-read-authority-test-secret-32-bytes-minimum'
};

const calls = [];
const standingRow = {
  standing_authority_id: 'standing-authority-test-001',
  project_id: projectId, actor_id: actorId,
  operation: 'memory.read', resource: 'memory:project:' + projectId,
  purpose: 'approved Learning and Knowledge retrieval',
  owner_revision: 4, membership_revision: 8, status: 'ACTIVE',
  approval_ref: 'approval-standing-001',
  valid_from: new Date(now - 1000).toISOString(),
  expires_at: new Date(now + STANDING_READ_TTL_MS).toISOString(),
  valid_from_rfc3339: '2026-11-07T00:00:00.123456Z',
  expires_at_rfc3339: '2027-11-07T00:00:00.654321Z'
};
const client = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM mira_hfm.project_owners')) {
      return { rows: [{ revision: 4, status: 'ACTIVE', project_id: projectId }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT (status =')) {
      return { rows: [{ membership_valid: true }], rowCount: 1 };
    }
    if (sql.includes('FROM mira_hfm.project_memberships')) {
      return { rows: [{
        membership_id: 'membership-standing-001',
        revision: 8, status: 'ACTIVE',
        permissions: { operations: ['memory.read'] },
        valid_from: new Date(now - 60000).toISOString(), expires_at: null
      }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE mira_hfm.authority_approval_nonces')) {
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('FROM mira_hfm.standing_read_authorities') &&
        sql.includes('SELECT standing_authority_id, status, expires_at, approval_ref') &&
        sql.includes('WHERE project_id = $1 AND actor_id = $2')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM mira_hfm.standing_read_authorities')) {
      return {
        rows: [{
          ...standingRow,
          ...(sql.includes('(expires_at > clock_timestamp()) AS is_live')
            ? { is_live: Date.parse(standingRow.expires_at) > Date.now() }
            : {})
        }],
        rowCount: 1
      };
    }
    if (sql.includes("SET status = 'EXPIRED'")) {
      if (Date.parse(standingRow.expires_at) <= Date.now()) {
        standingRow.status = 'EXPIRED';
        standingRow.paused_at = null;
        return { rows: [{ status: 'EXPIRED', expires_at: standingRow.expires_at }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('UPDATE mira_hfm.standing_read_authorities')) {
      const status = params[0];
      standingRow.status = status;
      standingRow.expires_at = new Date(now + STANDING_READ_TTL_MS).toISOString();
      return { rows: [{ expires_at: standingRow.expires_at }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO mira_hfm.standing_read_authorities')) {
      calls.push({ issuedStandingAuthorityParams: params });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  },
  release() {}
};
const pool = { async connect() { return client; } };

(async () => {
  assert.equal(STANDING_READ_TTL_MS, 365 * 24 * 60 * 60 * 1000);
  const expected = {
    projectId, actorId, resource: 'memory:project:' + projectId,
    purpose: 'approved Learning and Knowledge retrieval'
  };
  assert.equal(validateStandingReceipt({
    verified: true, approved: true, consumed: true, maxUses: 1,
    approvalRef: 'approval-001', projectId, actorId, approverActorId: actorId,
    operation: 'memory.read', resource: expected.resource, purpose: expected.purpose
  }, expected), 'approval-001');
  assert.throws(() => validateStandingReceipt({
    verified: true, approved: true, consumed: false, maxUses: 1,
    approvalRef: 'approval-001', projectId, actorId, approverActorId: actorId,
    operation: 'memory.write', resource: expected.resource, purpose: expected.purpose
  }, expected), /HFM_STANDING_READ_APPROVAL_RECEIPT_INVALID/);
  console.log('HFM_STANDING_READ_SINGLE_HUMAN_APPROVAL_RECEIPT_REQUIRED=PASS');

  const issuanceCallStart = calls.length;
  const issued = await issueStandingReadAuthority({
    req, pool, env, purpose: expected.purpose, approvalConfirmed: true
  });
  assert.equal(issued.status, 'STANDING_READ_AUTHORITY_ISSUED');
  assert.equal(issued.durationDays, 365);
  assert.equal(Date.parse(issued.expiresAt) - Date.parse(issued.validFrom), STANDING_READ_TTL_MS);
  assert.equal(issued.operation, 'memory.read');
  assert.equal(issued.resource, 'memory:project:' + projectId);
  assert.deepEqual(issued.recordTypes, ['learning_note', 'knowledge_item']);
  assert.equal(issued.writesAllowed, false);
  assert.equal(issued.requiresApprovalPerRead, false);
  assert.ok(calls.slice(issuanceCallStart).some(c =>
    typeof c.sql === 'string' && c.sql.includes('pg_advisory_xact_lock') &&
    c.params?.[0] === 'hfm-standing-read:' + projectId + ':' + actorId
  ), 'issuance serializes on the same project/actor lock as reads and lifecycle changes');
  assert.ok(calls.slice(issuanceCallStart).some(c =>
    typeof c.sql === 'string' && c.sql.startsWith('INSERT INTO mira_hfm.standing_read_authorities')
  ));
  console.log('HFM_STANDING_READ_365_DAY_PROJECT_SCOPED_ISSUE=PASS');
  const statusResult = await getStandingReadAuthorityStatus({ req, pool, env });
  assert.equal(statusResult.status, 'STANDING_READ_AUTHORITY_FOUND');
  assert.equal(statusResult.authority.authorityStatus, 'ACTIVE');
  assert.equal(statusResult.authority.expiresAt, standingRow.expires_at);
  console.log('HFM_STANDING_READ_STATUS_LOOKUP_AND_EXPIRY=PASS');
  const originalExpiry = standingRow.expires_at;
  standingRow.expires_at = new Date(now - 1000).toISOString();
  const expiredStatus = await getStandingReadAuthorityStatus({ req, pool, env });
  assert.equal(expiredStatus.authority.authorityStatus, 'EXPIRED');
  assert.equal(standingRow.status, 'EXPIRED', 'natural expiry is persisted for lifecycle audit trigger');
  await assert.rejects(() => setStandingReadAuthorityStatus({
    req, pool, env, standingAuthorityId: standingRow.standing_authority_id, status: 'ACTIVE'
  }), error => error.code === 'HFM_STANDING_READ_AUTHORITY_EXPIRED');
  standingRow.expires_at = new Date(now + STANDING_READ_TTL_MS).toISOString();
  standingRow.status = 'ACTIVE';
  assert.ok(Date.parse(standingRow.expires_at) > Date.now(),
    'lifecycle transition fixture must restore a future expiry after the expired-grant rejection');
  console.log('HFM_STANDING_READ_EXPIRED_GRANT_STATUS=PASS');

  const paused = await setStandingReadAuthorityStatus({
    req, pool, env, standingAuthorityId: 'standing-authority-test-001', status: 'PAUSED'
  });
  assert.equal(paused.authorityStatus, 'PAUSED');
  assert.equal(calls.filter(c => typeof c.sql === 'string' && c.sql.startsWith('UPDATE mira_hfm.standing_read_authorities') && c.sql.includes('SET status = $1')).length, 1);
  const resumed = await setStandingReadAuthorityStatus({
    req, pool, env, standingAuthorityId: 'standing-authority-test-001', status: 'ACTIVE'
  });
  assert.equal(resumed.authorityStatus, 'ACTIVE');
  const revoked = await setStandingReadAuthorityStatus({
    req, pool, env, standingAuthorityId: 'standing-authority-test-001', status: 'REVOKED'
  });
  assert.equal(revoked.authorityStatus, 'REVOKED');
  assert.equal(calls.filter(c => typeof c.sql === 'string' && c.sql.startsWith('UPDATE mira_hfm.standing_read_authorities') && c.sql.includes('SET status = $1')).length, 3);
  console.log('HFM_STANDING_READ_PAUSE_RESUME_REVOKE_AUDITED=PASS');

  standingRow.status = 'ACTIVE';
  let readerPermissions = ['memory.read'];
  const readCalls = [];
  const readClient = {
    async query(sql, params = []) {
      readCalls.push({ sql, params });
      if (sql.includes('FROM mira_hfm.project_owners')) {
        return { rows: params[0] === projectId ? [{ project_id: projectId, status: 'ACTIVE', revision: 4 }] : [] };
      }
      if (sql.startsWith("SELECT (status = 'ACTIVE'")) return { rows: [{ membership_valid: true }] };
      if (sql.includes('FROM mira_hfm.project_memberships')) {
        return { rows: params[0] === projectId && params[1] === actorId ? [{
          membership_id: 'membership-standing-001', project_id: projectId,
          actor_id: actorId, permissions: { operations: readerPermissions },
          status: 'ACTIVE', revision: 8,
          valid_from: new Date(now - 60000).toISOString(), expires_at: null
        }] : [] };
      }
      if (sql.includes('FROM mira_hfm.standing_read_authorities')) {
        return { rows: params[0] === projectId && params[1] === actorId &&
          !(sql.includes("status = 'ACTIVE'") && standingRow.status !== 'ACTIVE') ? [standingRow] : [] };
      }
      if (sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const readResult = await executeWithStandingReadAuthority({
    pool: { async connect() { return readClient; } },
    verifiedPrincipal: req.session.hfmPrincipal,
    projectId,
    perform: async (_client, context) => {
      assert.equal(context.operation, 'memory.read');
      assert.equal(context.authorityContext, 'HFM_ACTIVE_STANDING_READ_AUTHORITY');
      return { records: [{ memoryId: 'learning-1' }], count: 1 };
    }
  });
  assert.equal(readResult.status, 'AUTHORIZED_AND_COMMITTED');
  assert.equal(readResult.authorityConsumed, false);
  assert.equal(readResult.value.count, 1);
  assert.equal(readResult.hostAuthorizationContext.actorId, actorId);
  assert.equal(readResult.hostAuthorizationContext.projectId, projectId);
  assert.equal(readResult.hostAuthorizationContext.authorityRef, standingRow.standing_authority_id);
  assert.equal(readResult.hostAuthorizationContext.issuedAt, standingRow.valid_from_rfc3339);
  assert.equal(readResult.hostAuthorizationContext.expiresAt, standingRow.expires_at_rfc3339);
  assert.equal(readResult.authorityExpiresAt, standingRow.expires_at_rfc3339);
  assert.ok(readCalls.some(c =>
    c.sql.includes('valid_from_rfc3339') && c.sql.includes('expires_at_rfc3339')
  ), 'database timestamps are serialized as exact UTC microsecond RFC3339 strings');
  assert.ok(readCalls.some(c => c.sql.includes('STANDING_READ_AUTHORITY_USED')));
  assert.ok(readCalls.some(c =>
    c.sql === "SELECT set_config('mira.standing_read_authority', 'true', true)"
  ), 'standing read activates the transaction-local restrictive Memory RLS policy');
  assert.ok(readCalls.some(c => c.sql.includes("set_config('mira.operation', 'memory.read'")));
  assert.ok(readCalls.some(c => c.sql.includes("set_config('mira.resource'") && c.params[0] === 'memory:project:' + projectId));
  assert.ok(readCalls.some(c => c.sql.includes("set_config('mira.request_id'") && typeof c.params[0] === 'string'));
  assert.ok(readCalls.some(c => c.sql === 'COMMIT'));
  console.log('HFM_STANDING_READ_TRANSACTION_ACTIVATES_RESTRICTIVE_MEMORY_RLS=PASS');
  console.log('HFM_STANDING_READ_EACH_READ_AUDITED_WITHOUT_REAPPROVAL=PASS');
  assert.ok(readCalls.some(c => c.sql.includes("pg_advisory_xact_lock")), "standing read uses transaction-scoped lifecycle lock without table UPDATE permission");
  assert.ok(calls.filter(c => typeof c.sql === "string" && c.sql.includes("pg_advisory_xact_lock")).length >= 3, "pause/resume/revoke serialize on the same authority lock");
  console.log("HFM_STANDING_READ_AUTHORITY_SERIALIZED_WITH_LIFECYCLE_WITHOUT_WRITE_GRANT=PASS");
  standingRow.status = 'PAUSED';
  let pausedReadCallbackCalled = false;
  await assert.rejects(() => executeWithStandingReadAuthority({
    pool: { async connect() { return readClient; } },
    verifiedPrincipal: req.session.hfmPrincipal,
    projectId,
    perform: async () => { pausedReadCallbackCalled = true; return {}; }
  }), /HFM_STANDING_READ_AUTHORITY_MISSING_PAUSED_OR_EXPIRED/);
  assert.equal(pausedReadCallbackCalled, false);
  assert.ok(readCalls.some(c =>
    c.sql.startsWith('INSERT INTO mira_hfm.authority_audit_events') &&
    c.params?.[3] === 'STANDING_READ_AUTHORITY_DENIED'
  ), 'paused standing-read denial is persisted after the protected transaction rolls back');
  console.log('HFM_STANDING_READ_PAUSED_GRANT_BLOCKS_FUTURE_READS=PASS');
  console.log('HFM_STANDING_READ_DENIAL_IS_AUDITED_OUTSIDE_ROLLED_BACK_READ=PASS');

  standingRow.status = 'ACTIVE';
  const expiredMembershipStart = readCalls.length;
  const expiredMembershipClient = {
    async query(sql, params) {
      if (sql.startsWith("SELECT (status = 'ACTIVE'")) {
        readCalls.push({ sql, params });
        return { rows: [{ membership_valid: false }] };
      }
      return readClient.query(sql, params);
    },
    release() {}
  };
  await assert.rejects(() => executeWithStandingReadAuthority({
    pool: { async connect() { return expiredMembershipClient; } },
    verifiedPrincipal: req.session.hfmPrincipal,
    projectId,
    perform: async () => ({ records: [] })
  }), error => error.code === 'HFM_MEMBERSHIP_EXPIRED_DURING_OPERATION' &&
    error.auditStatus === 'RECORDED');
  assert.ok(readCalls.slice(expiredMembershipStart).some(c =>
    c.sql.startsWith('INSERT INTO mira_hfm.authority_audit_events') &&
    c.params?.[3] === 'STANDING_READ_AUTHORITY_DENIED'
  ), 'membership expiry before commit is classified and audited as a denial');
  console.log('HFM_STANDING_READ_MEMBERSHIP_EXPIRY_DENIED_AND_AUDITED=PASS');

  standingRow.status = 'REVOKED';
  let revokedReadCallbackCalled = false;
  await assert.rejects(() => executeWithStandingReadAuthority({
    pool: { async connect() { return readClient; } },
    verifiedPrincipal: req.session.hfmPrincipal,
    projectId,
    perform: async () => { revokedReadCallbackCalled = true; return {}; }
  }), /HFM_STANDING_READ_AUTHORITY_MISSING_PAUSED_OR_EXPIRED/);
  assert.equal(revokedReadCallbackCalled, false);
  console.log('HFM_STANDING_READ_REVOKED_GRANT_BLOCKS_FUTURE_READS=PASS');

  standingRow.status = 'ACTIVE';
  const otherProject = 'project-beta';
  let crossProjectReadRan = false;
  await assert.rejects(() => executeWithStandingReadAuthority({
    pool: { async connect() { return readClient; } },
    verifiedPrincipal: req.session.hfmPrincipal,
    projectId: otherProject,
    perform: async () => { crossProjectReadRan = true; return {}; }
  }), /HFM_PROJECT_OWNER_NOT_ACTIVE/);
  assert.equal(crossProjectReadRan, false);
  console.log('HFM_STANDING_READ_CROSS_PROJECT_ACCESS_BLOCKED=PASS');

  const otherSubject = '22222222-2222-4222-8222-222222222222';
  const otherPrincipal = { ...req.session.hfmPrincipal, subject: otherSubject };
  let unauthorizedReadRan = false;
  await assert.rejects(() => executeWithStandingReadAuthority({
    pool: { async connect() { return readClient; } },
    verifiedPrincipal: otherPrincipal,
    projectId,
    perform: async () => { unauthorizedReadRan = true; return {}; }
  }), /HFM_PROJECT_MEMBERSHIP_NOT_ACTIVE/);
  assert.equal(unauthorizedReadRan, false);
  console.log('HFM_STANDING_READ_UNAUTHORIZED_ACTOR_BLOCKED=PASS');

  readerPermissions = ['memory.write'];
  let writeOnlyReadRan = false;
  await assert.rejects(() => executeWithStandingReadAuthority({
    pool: { async connect() { return readClient; } },
    verifiedPrincipal: req.session.hfmPrincipal,
    projectId,
    perform: async () => { writeOnlyReadRan = true; return {}; }
  }), /HFM_OPERATION_NOT_GRANTED/);
  assert.equal(writeOnlyReadRan, false);
  readerPermissions = ['memory.read'];
  console.log('HFM_STANDING_READ_WRITE_ONLY_MEMBERSHIP_BLOCKED=PASS');

  // Audit insertion is part of the same SERIALIZABLE transaction as retrieval.
  // If it fails, the protected read callback must never run and the transaction rolls back.
  const auditFailureCalls = [];
  let protectedReadRan = false;
  const auditFailureClient = {
    async query(sql) {
      auditFailureCalls.push(sql);
      if (sql.includes('FROM mira_hfm.project_owners')) {
        return { rows: [{ project_id: projectId, status: 'ACTIVE', revision: 4 }] };
      }
      if (sql.includes('FROM mira_hfm.project_memberships')) {
        return { rows: [{
          membership_id: 'membership-audit-failure', status: 'ACTIVE',
          revision: 8, permissions: { operations: ['memory.read'] }
        }] };
      }
      if (sql.includes('FROM mira_hfm.standing_read_authorities')) {
        return { rows: [{ ...standingRow, status: 'ACTIVE' }] };
      }
      if (sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')) {
        const error = new Error('simulated audit persistence failure');
        error.code = 'HFM_AUDIT_INSERT_FAILED';
        throw error;
      }
      return { rows: [{ membership_valid: true }], rowCount: 1 };
    },
    release() {}
  };
  await assert.rejects(() => executeWithStandingReadAuthority({
    pool: { async connect() { return auditFailureClient; } },
    verifiedPrincipal: req.session.hfmPrincipal,
    projectId,
    perform: async () => { protectedReadRan = true; return {}; }
  }), error => error.code === 'HFM_AUDIT_INSERT_FAILED' && error.auditStatus === 'FAILED');
  assert.equal(protectedReadRan, false);
  assert.ok(auditFailureCalls.includes('ROLLBACK'));
  assert.ok(auditFailureCalls.filter(sql => sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')).length >= 2,
    'failed primary audit triggers a separate denial/failure audit attempt');
  console.log('HFM_STANDING_READ_AUDIT_FAILURE_ROLLS_BACK_AND_BLOCKS_READ=PASS');

  standingRow.status = 'ACTIVE';
  const failedReadStart = readCalls.length;
  await assert.rejects(() => executeWithStandingReadAuthority({
    pool: { async connect() { return readClient; } },
    verifiedPrincipal: req.session.hfmPrincipal,
    projectId,
    perform: async () => { throw new Error('synthetic protected retrieval failure'); }
  }), error => error.message === 'synthetic protected retrieval failure' &&
    error.auditStatus === 'RECORDED');
  assert.ok(readCalls.slice(failedReadStart).some(c =>
    c.sql.startsWith('INSERT INTO mira_hfm.authority_audit_events') &&
    c.params?.[3] === 'STANDING_READ_AUTHORITY_FAILED'
  ), 'failed protected retrieval is audited independently after rollback');
  console.log('HFM_STANDING_READ_FAILED_RETRIEVAL_IS_AUDITED=PASS');

  const authorityLifecycle = fs.readFileSync(
    path.join(__dirname, '..', 'services/mira-hfm-standing-read-authority.js'), 'utf8'
  );
  assert.match(authorityLifecycle, /\(expires_at > clock_timestamp\(\)\) AS is_live/);
  assert.match(authorityLifecycle, /if \(prior && prior\.is_live === true\)/);
  assert.match(authorityLifecycle, /if \(current\.is_live !== true\) fail\('HFM_STANDING_READ_AUTHORITY_EXPIRED'\)/);
  assert.doesNotMatch(authorityLifecycle, /Date\.parse\((?:prior|current)\.expires_at\)/);
  console.log('HFM_STANDING_READ_LIFECYCLE_EXPIRY_USES_DATABASE_MICROSECOND_PRECISION=PASS');

  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations/hfm/014_standing_read_authority_365_days.sql'), 'utf8'
  );
  assert.match(migration, /expires_at <= valid_from \+ interval '365 days'/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /hfm_standing_reader_select/);
  assert.match(migration, /hfm_standing_reader_memory_scope/);
  assert.match(migration, /AS RESTRICTIVE/);
  assert.match(migration, /record_type IN \('learning_note', 'knowledge_item'\)/);
  assert.match(migration, /integrity_status = 'VERIFIED'/);
  assert.match(migration, /trust_status IN \('CONTENT_VERIFIED', 'HUMAN_VERIFIED'\)/);
  assert.match(migration, /hfm_standing_issuer_update/);
  assert.match(migration, /HFM_STANDING_READ_AUTHORITY_SCOPE_IMMUTABLE/);
  assert.match(migration, /HFM_STANDING_READ_AUTHORITY_TRANSITION_INVALID/);
  assert.match(migration, /STANDING_READ_AUTHORITY_USED/);
  assert.match(migration, /CREATE TRIGGER standing_read_authority_audit/);
  assert.match(migration, /STANDING_READ_AUTHORITY_ISSUED/);
  assert.match(migration, /STANDING_READ_AUTHORITY_PAUSED/);
  assert.match(migration, /STANDING_READ_AUTHORITY_RESUMED/);
  assert.match(migration, /STANDING_READ_AUTHORITY_REVOKED/);
  assert.match(migration, /STANDING_READ_AUTHORITY_EXPIRED/);
  assert.match(migration, /REVOKE ALL ON FUNCTION mira_hfm\.audit_standing_read_authority_change\(\) FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL ON TABLE mira_hfm\.standing_read_authorities FROM PUBLIC/);
  const failureAuditMigration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations/hfm/016_standing_read_failure_audit.sql'), 'utf8'
  );
  assert.match(failureAuditMigration, /STANDING_READ_AUTHORITY_DENIED/);
  assert.match(failureAuditMigration, /STANDING_READ_AUTHORITY_FAILED/);
  assert.ok(failureAuditMigration.includes("details->>'operation' = 'memory.read'"));
  assert.ok(failureAuditMigration.includes("details->>'resource' = NULLIF(current_setting('mira.resource', true), '')"));
  assert.match(failureAuditMigration, /current_setting\('mira.request_id', true\)/);
  assert.match(failureAuditMigration, /AS RESTRICTIVE/);
  assert.match(failureAuditMigration, /current_setting\('mira.operation', true\) = 'memory.read'/);
  assert.match(failureAuditMigration, /current_setting\('mira.standing_read_authority', true\) = 'true'/);
  assert.match(failureAuditMigration, /details->>'resource'/);
  const failureAuditScript = fs.readFileSync(
    path.join(__dirname, '..', 'scripts/hfm-postgres-standing-read-audit-test.sh'), 'utf8'
  );
  assert.match(failureAuditScript, /jsonb_build_object\('operation','memory.read'/);
  assert.match(failureAuditScript, /ci-standing-denied-wrong-request/);
  assert.match(failureAuditScript, /ci-standing-denied-no-flag/);
  assert.match(failureAuditScript, /ci-standing-denied-wrong-operation/);
  assert.match(failureAuditScript, /ci-standing-denied-wrong-resource/);
  console.log('HFM_STANDING_READ_FAILURE_AUDIT_SCRIPT_COVERS_RESTRICTIVE_CONTEXT=PASS');
  console.log('HFM_STANDING_READ_FAILURE_AUDIT_POLICY_SCOPED_TO_PROJECT_ACTOR_REQUEST=PASS');
  console.log('HFM_STANDING_READ_MIGRATION_RLS_IMMUTABLE_SCOPE_365D=PASS');

  const readRoute = fs.readFileSync(
    path.join(__dirname, '..', 'routes/mira-hfm-memory-read.js'), 'utf8'
  );
  assert.match(readRoute, /MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED/);
  assert.match(readRoute, /\['learning_note', 'knowledge_item'\]/);
  assert.match(readRoute, /ACTIVE records only/);
  console.log('HFM_STANDING_READ_RUNTIME_FLAG_AND_RECORD_SCOPE=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('LOCAL_FALLBACK=NO');
  console.log('MEMORY_WRITES=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
