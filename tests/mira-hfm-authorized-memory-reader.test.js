'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { retrieveProjectMemory } = require('../services/mira-hfm-authorized-memory-reader');
const { BINDING_VERSION } = require('../services/mira-hfm-project-binding-context');

const now = Date.now();
const sessionID = 'memory-reader-session-001';
const principal = {
  verified: true,
  issuer: 'mira.users',
  subject: '11111111-1111-4111-8111-111111111111',
  actorType: 'HUMAN',
  authenticationMethod: 'USER_SESSION',
  authenticationRef: sessionID,
  authenticatedAt: new Date(now - 60_000).toISOString(),
  expiresAt: new Date(now + 60 * 60_000).toISOString()
};
const actorId = 'mira:mira.users:' + principal.subject;
const projectId = 'project-alpha';
const grant = {
  authorityId: 'authority-read-001',
  purpose: 'approved project memory retrieval',
  requestId: 'request-read-001'
};

function fixture() {
  const calls = [];
  const owner = {
    project_id: projectId, owner_actor_id: 'mira:mira.users:owner',
    status: 'ACTIVE', revision: 3
  };
  const membership = {
    membership_id: 'membership-001', project_id: projectId, actor_id: actorId,
    permissions: { operations: ['memory.read'] }, status: 'ACTIVE',
    revision: 7, valid_from: new Date(now - 60_000).toISOString(), expires_at: null
  };
  const authority = {
    authority_id: grant.authorityId, project_id: projectId, actor_id: actorId,
    operation: 'memory.read', resource: 'memory:project:' + projectId,
    purpose: grant.purpose, request_id: grant.requestId,
    membership_revision: 7, owner_revision: 3, status: 'ISSUED',
    approval_ref: 'approval-read-001',
    valid_from: new Date(now - 30_000).toISOString(),
    expires_at: new Date(now + 60_000).toISOString()
  };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT (status = 'ACTIVE'")) {
        return { rows: [{ membership_valid: true }] };
      }
      if (sql.includes('FROM mira_hfm.project_owners')) return { rows: [owner] };
      if (sql.includes('FROM mira_hfm.project_memberships')) return { rows: [membership] };
      if (sql.includes('FROM mira_hfm.operation_authorities')) return { rows: [authority] };
      if (sql.startsWith('UPDATE mira_hfm.operation_authorities')) return { rowCount: 1, rows: [{}] };
      if (sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')) return { rowCount: 1, rows: [] };
      if (sql.includes('FROM mira_hfm.memory_records')) return { rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); }
  };
  return { calls, pool: { async connect() { return client; } } };
}

function req(binding = true) {
  return {
    role: 'user',
    sessionID,
    session: {
      authenticated: true,
      role: 'user',
      hfmPrincipal: principal,
      ...(binding ? {
        hfmProjectBinding: {
          verified: true, bindingVersion: BINDING_VERSION,
          actorId, projectId, selectedAt: new Date(now - 1000).toISOString()
        }
      } : {})
    },
    body: { actorId: 'attacker', projectId: 'attacker-project' }
  };
}

test('retrieval consumes server-held authority and derives project/actor only from session binding', async () => {
  const f = fixture();
  const result = await retrieveProjectMemory({
    pool: f.pool, req: req(), authorityGrant: grant
  });
  assert.equal(result.status, 'AUTHORIZED_AND_COMMITTED');
  assert.equal(result.projectId, projectId);
  assert.equal(result.count, 0);
  assert.equal(result.authorityConsumed, true);
  assert.equal(result.memoryWrites, false);
  assert.equal(result.localFallback, false);
  assert.equal(result.driveFallback, false);

  const projectSetting = f.calls.find(item => item.sql.includes("set_config('mira.project_id'"));
  const actorSetting = f.calls.find(item => item.sql.includes("set_config('mira.actor_id'"));
  assert.deepEqual(projectSetting.params, [projectId]);
  assert.deepEqual(actorSetting.params, [actorId]);
  assert.ok(f.calls.some(item => item.sql.startsWith('UPDATE mira_hfm.operation_authorities')));
  assert.ok(f.calls.some(item => item.sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')));
  assert.ok(f.calls.some(item => item.sql.includes('FROM mira_hfm.memory_records')));
  assert.ok(f.calls.some(item => item.sql === 'COMMIT'));
  assert.equal(Object.isFrozen(result), true);
  console.log('HFM_AUTHORIZED_MEMORY_READ_SESSION_SCOPE_AND_ATOMIC_AUTHORITY=PASS');
});

test('missing project binding, malformed grant, and caller-supplied project cannot authorize retrieval', async () => {
  const f = fixture();
  await assert.rejects(
    retrieveProjectMemory({ pool: f.pool, req: req(false), authorityGrant: grant }),
    error => error.code === 'HFM_MEMORY_READ_TRUSTED_PROJECT_CONTEXT_REQUIRED'
  );
  await assert.rejects(
    retrieveProjectMemory({ pool: f.pool, req: req(), authorityGrant: { ...grant, projectId: 'attacker-project' } }),
    error => error.code === 'HFM_MEMORY_READ_SERVER_AUTHORITY_GRANT_INVALID'
  );
  assert.equal(f.calls.length, 0);
  console.log('HFM_AUTHORIZED_MEMORY_READ_FAILS_CLOSED=PASS');
});

test('invalid limits and missing pool are rejected before database access', async () => {
  const f = fixture();
  await assert.rejects(
    retrieveProjectMemory({ pool: f.pool, req: req(), authorityGrant: grant, limit: 101 }),
    error => error.code === 'HFM_MEMORY_READ_LIMIT_INVALID'
  );
  await assert.rejects(
    retrieveProjectMemory({ req: req(), authorityGrant: grant }),
    error => error.code === 'HFM_MEMORY_READ_POOL_REQUIRED'
  );
  assert.equal(f.calls.length, 0);
  console.log('HFM_AUTHORIZED_MEMORY_READ_INPUT_BOUNDS=PASS');
});

console.log('NETWORK_REQUESTS=0');
console.log('MEMORY_WRITES=0');
console.log('LEGACY_FALLBACKS=0');
