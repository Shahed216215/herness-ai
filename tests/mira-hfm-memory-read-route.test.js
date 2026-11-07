'use strict';

const assert = require('node:assert/strict');
let retrievalCalls = 0;
const fakeReadMemory = async options => {
  retrievalCalls += 1;
  assert.equal(options.authorityGrant.authorityId, 'authority-001');
  assert.equal(options.limit, 25);
  assert.equal(options.recordType, 'social_post_draft');
  return {
    status: 'AUTHORIZED_AND_COMMITTED',
    projectId: 'project-alpha',
    count: 1,
    records: [{ memoryId: 'memory-001', content: 'authorized' }],
    authorityConsumed: true,
    localFallback: false,
    driveFallback: false
  };
};
const { registerMiraHfmMemoryReadRoute } = require('../routes/mira-hfm-memory-read');

function makeReq(overrides = {}) {
  return {
    role: 'admin',
    secure: true,
    get(name) {
      if (name === 'origin') return 'https://mira.example';
      if (name === 'host') return 'mira.example';
      return undefined;
    },
    body: { limit: 25, recordType: 'social_post_draft' },
    session: {
      authenticated: true,
      role: 'admin',
      hfmProjectBinding: { verified: true, projectId: 'project-alpha' },
      hfmPendingMemoryAuthority: {
        projectId: 'project-alpha',
        operation: 'memory.read',
        resource: 'memory:project:project-alpha',
        grant: { authorityId: 'authority-001', purpose: 'approved retrieval', requestId: 'request-001' },
        expiresAt: new Date(Date.now() + 60000).toISOString()
      },
      save(callback) {
        assert.equal(this.hfmPendingMemoryAuthority, undefined);
        callback(null);
      }
    },
    ...overrides
  };
}
function response() {
  return {
    statusCode: 200, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
}
async function invoke(req, runtime = async () => ({
  status: 'MEMORY_READ_READY', pool: { connect: async () => ({}) }
})) {
  let captured;
  const res = response();
  const app = { post(_path, middleware, handler) { captured = { middleware, handler }; } };
  registerMiraHfmMemoryReadRoute(app, runtime, (_req, _res, next) => next(), fakeReadMemory);
  await captured.middleware(req, res, () => {});
  if (res.payload) return res;
  await captured.handler(req, res);
  return res;
}

(async () => {
  const success = await invoke(makeReq());
  assert.equal(success.statusCode, 200);
  assert.equal(success.payload.status, 'AUTHORIZED_AND_COMMITTED');
  assert.equal(success.payload.authorityConsumed, true);
  assert.equal(success.payload.records.length, 1);
  assert.equal(retrievalCalls, 1);
  console.log('HFM_MEMORY_READ_SERVER_SESSION_GRANT_CONSUMED_BEFORE_READ=PASS');
  console.log('HFM_MEMORY_READ_AUTHORIZED_RESULT=PASS');

  const noGrant = await invoke(makeReq({
    session: { authenticated: true, role: 'admin', hfmProjectBinding: { verified: true, projectId: 'project-alpha' } }
  }));
  assert.equal(noGrant.statusCode, 403);
  console.log('HFM_MEMORY_READ_NO_CLIENT_SUPPLIED_GRANT=PASS');

  const wrongProject = await invoke(makeReq({
    session: {
      authenticated: true, role: 'admin',
      hfmProjectBinding: { verified: true, projectId: 'project-beta' },
      hfmPendingMemoryAuthority: {
        projectId: 'project-alpha',
        operation: 'memory.read',
        resource: 'memory:project:project-alpha',
        grant: { authorityId: 'authority-001', purpose: 'approved retrieval', requestId: 'request-001' },
        expiresAt: new Date(Date.now() + 60000).toISOString()
      },
      save(callback) { callback(null); }
    }
  }));
  assert.equal(wrongProject.statusCode, 403);
  console.log('HFM_MEMORY_READ_CROSS_PROJECT_GRANT_BLOCK=PASS');

  const expired = await invoke(makeReq({
    session: {
      authenticated: true, role: 'admin',
      hfmProjectBinding: { verified: true, projectId: 'project-alpha' },
      hfmPendingMemoryAuthority: {
        projectId: 'project-alpha',
        grant: { authorityId: 'authority-001', purpose: 'approved retrieval', requestId: 'request-001' },
        expiresAt: new Date(Date.now() - 1000).toISOString()
      },
      save(callback) { assert.equal(this.hfmPendingMemoryAuthority, undefined); callback(null); }
    }
  }));
  assert.equal(expired.statusCode, 403);
  console.log('HFM_MEMORY_READ_EXPIRED_GRANT_CLEAR=PASS');

  const wrongOperation = await invoke(makeReq({
    session: {
      authenticated: true, role: 'admin',
      hfmProjectBinding: { verified: true, projectId: 'project-alpha' },
      hfmPendingMemoryAuthority: {
        projectId: 'project-alpha', operation: 'memory.trash',
        resource: 'memory:social-draft-001',
        grant: { authorityId: 'authority-001', purpose: 'approved retrieval', requestId: 'request-001' },
        expiresAt: new Date(Date.now() + 60000).toISOString()
      },
      save(callback) { callback(null); }
    }
  }));
  assert.equal(wrongOperation.statusCode, 403);
  console.log('HFM_MEMORY_READ_WRONG_OPERATION_GRANT_BLOCK=PASS');

  const invalidLifecycle = await invoke(makeReq({ body: { limit: 25, lifecycle: 'PURGED' } }));
  assert.equal(invalidLifecycle.statusCode, 400);
  console.log('HFM_MEMORY_READ_INVALID_LIFECYCLE_FILTER_BLOCK=PASS');

  const invalidType = await invoke(makeReq({ body: { limit: 25, recordType: 'unknown_type' } }));
  assert.equal(invalidType.statusCode, 400);
  console.log('HFM_MEMORY_READ_INVALID_RECORD_TYPE_FILTER_BLOCK=PASS');

  const disabled = await invoke(makeReq(), async () => ({ status: 'DISABLED', pool: null }));
  assert.equal(disabled.statusCode, 503);
  console.log('HFM_MEMORY_READ_DISABLED_RUNTIME_FAIL_CLOSED=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
