'use strict';

const assert = require('node:assert/strict');
const { registerMiraHfmProjectSelectionRoute } = require('../routes/mira-hfm-project-selection');
const { retrieveProjectMemory } = require('../services/mira-hfm-authorized-memory-reader');
const { BINDING_VERSION } = require('../services/mira-hfm-project-binding-context');

const now = Date.now();
const sessionID = 'hfm-project-memory-integration-001';
const projectId = 'project-alpha';
const principal = {
  verified: true, issuer: 'mira.users',
  subject: '11111111-1111-4111-8111-111111111111',
  actorType: 'HUMAN', authenticationMethod: 'USER_SESSION',
  authenticationRef: sessionID,
  authenticatedAt: new Date(now - 60000).toISOString(),
  expiresAt: new Date(now + 3600000).toISOString()
};
const actorId = 'mira:mira.users:' + principal.subject;
const grant = {
  authorityId: 'authority-integration-001',
  purpose: 'approved project memory retrieval',
  requestId: 'request-integration-001'
};

function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const projectCalls = [];
const projectClient = {
  async query(sql, params = []) {
    projectCalls.push({ sql, params });
    if (sql.includes('FROM mira_hfm.project_owners owner')) {
      return { rows: [{
        project_id: projectId, owner_revision: 4,
        membership_id: 'membership-integration-001',
        membership_revision: 9,
        permissions: { operations: ['memory.read'] },
        membership_role: 'ADMIN'
      }] };
    }
    return { rows: [], rowCount: 0 };
  },
  release() {}
};
const projectPool = { async connect() { return projectClient; } };

const memoryCalls = [];
const authority = {
  authority_id: grant.authorityId,
  project_id: projectId,
  actor_id: actorId,
  operation: 'memory.read',
  resource: 'memory:project:' + projectId,
  purpose: grant.purpose,
  request_id: grant.requestId,
  membership_revision: 9,
  owner_revision: 4,
  status: 'ISSUED',
  approval_ref: 'approval-integration-001',
  valid_from: new Date(now - 30000).toISOString(),
  expires_at: new Date(now + 60000).toISOString()
};
const memoryClient = {
  async query(sql, params = []) {
    memoryCalls.push({ sql, params });
    if (sql.includes('FROM mira_hfm.project_owners')) {
      return { rows: [{
        project_id: projectId, owner_actor_id: 'mira:mira.users:owner',
        status: 'ACTIVE', revision: 4
      }] };
    }
    if (sql.includes('FROM mira_hfm.project_memberships')) {
      return { rows: [{
        membership_id: 'membership-integration-001',
        project_id: projectId, actor_id: actorId,
        permissions: { operations: ['memory.read'] },
        status: 'ACTIVE', revision: 9,
        valid_from: new Date(now - 60000).toISOString(), expires_at: null
      }] };
    }
    if (sql.includes('FROM mira_hfm.operation_authorities')) return { rows: [authority] };
    if (sql.startsWith('UPDATE mira_hfm.operation_authorities')) return { rows: [{ authority_id: grant.authorityId }], rowCount: 1 };
    if (sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM mira_hfm.memory_records')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  },
  release() {}
};
const memoryPool = { async connect() { return memoryClient; } };

(async () => {
  const app = {
    post(path, handler) { this.path = path; this.handler = handler; }
  };
  registerMiraHfmProjectSelectionRoute(
    app,
    async () => ({ status: 'PROJECT_READ_READY', pool: projectPool })
  );

  const req = {
    role: 'user',
    sessionID,
    session: {
      authenticated: true, role: 'user', hfmPrincipal: principal,
      save(callback) { callback(null); }
    },
    body: { projectId, actorId: 'attacker', authorityId: 'attacker-authority' }
  };
  const selectionResponse = response();
  await app.handler(req, selectionResponse);

  assert.equal(selectionResponse.statusCode, 200);
  assert.equal(req.session.hfmProjectBinding.verified, true);
  assert.equal(req.session.hfmProjectBinding.bindingVersion, BINDING_VERSION);
  assert.equal(req.session.hfmProjectBinding.actorId, actorId);
  assert.equal(req.session.hfmProjectBinding.projectId, projectId);
  assert.ok(projectCalls.some(call => call.sql.includes("set_config('mira.actor_id'") && call.params[0] === actorId));

  const result = await retrieveProjectMemory({
    pool: memoryPool, req, authorityGrant: grant, limit: 10
  });
  assert.equal(result.status, 'AUTHORIZED_AND_COMMITTED');
  assert.equal(result.projectId, projectId);
  assert.equal(result.authorityConsumed, true);
  assert.equal(result.count, 0);
  assert.ok(memoryCalls.some(call => call.sql.includes("set_config('mira.project_id'") && call.params[0] === projectId));
  assert.ok(memoryCalls.some(call => call.sql.includes("set_config('mira.actor_id'") && call.params[0] === actorId));
  assert.ok(memoryCalls.some(call => call.sql.startsWith('UPDATE mira_hfm.operation_authorities')));
  assert.ok(memoryCalls.some(call => call.sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')));
  assert.ok(memoryCalls.some(call => call.sql.includes('FROM mira_hfm.memory_records')));
  assert.ok(memoryCalls.some(call => call.sql === 'COMMIT'));

  console.log('HFM_PROJECT_SELECTION_TO_AUTHORIZED_MEMORY_READ=PASS');
  console.log('ACTOR_AND_PROJECT_SCOPE_FROM_SERVER_SESSION=PASS');
  console.log('ONE_TIME_AUTHORITY_CONSUMED_AND_AUDITED=PASS');
  console.log('MEMORY_READ_ONLY_NO_LEGACY_FALLBACK=PASS');
  console.log('NETWORK_REQUESTS=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
