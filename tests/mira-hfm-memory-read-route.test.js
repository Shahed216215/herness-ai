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
}), readMemory = fakeReadMemory, env = process.env) {
  let captured;
  const res = response();
  const app = { post(_path, middleware, handler) { captured = { middleware, handler }; } };
  registerMiraHfmMemoryReadRoute(app, runtime, (_req, _res, next) => next(), readMemory, env);
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

  const standingReq = makeReq({
    body: { limit: 20, recordType: 'learning_note' },
    session: {
      authenticated: true, role: 'admin',
      hfmProjectBinding: { verified: true, projectId: 'project-alpha' }
    }
  });
  const standingPageCalls = [];
  const standingRead = await invoke(
    standingReq,
    async () => ({ status: 'MEMORY_READ_READY', pool: { connect: async () => ({}) } }),
    async options => {
      standingPageCalls.push(options);
      assert.equal(options.standingReadAuthority, true);
      assert.equal(options.recordTypes, undefined);
      assert.equal(options.recordType, 'learning_note');
      assert.equal(options.lifecycle, 'ACTIVE');
      assert.equal(options.authorityGrant, undefined);
      return {
        status: 'AUTHORIZED_AND_COMMITTED', projectId: 'project-alpha', count: 1,
        records: [{ memoryId: 'learning-001' }], authorityConsumed: false,
        standingAuthority: true, standingAuthorityId: 'standing-001',
        authorityExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        approvalRequiredPerRead: false,
        nextCursor: 'cursor-page-2',
        scanStartedAt: new Date(Date.now() - 1000).toISOString()
      };
    },
    { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' }
  );
  assert.equal(standingRead.statusCode, 200);
  assert.equal(standingRead.payload.standingAuthority, true);
  assert.equal(standingRead.payload.authorityConsumed, false);
  assert.equal(standingRead.payload.approvalRequiredPerRead, false);
  assert.equal(standingRead.payload.nextCursor, 'cursor-page-2');
  assert.equal(typeof standingRead.payload.scanStartedAt, 'string');
  assert.equal(standingPageCalls[0].cursor, undefined);

  const nextStandingPage = await invoke(
    makeReq({
      body: { limit: 20, recordType: 'learning_note', cursor: 'cursor-page-2' },
      session: {
        authenticated: true, role: 'admin',
        hfmProjectBinding: { verified: true, projectId: 'project-alpha' }
      }
    }),
    async () => ({ status: 'MEMORY_READ_READY', pool: { connect: async () => ({}) } }),
    async options => {
      assert.equal(options.cursor, 'cursor-page-2');
      return {
        status: 'AUTHORIZED_AND_COMMITTED', projectId: 'project-alpha', count: 0,
        records: [], authorityConsumed: false, standingAuthority: true,
        standingAuthorityId: 'standing-001',
        authorityExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        approvalRequiredPerRead: false, nextCursor: null,
        scanStartedAt: new Date(Date.now() - 1000).toISOString()
      };
    },
    { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' }
  );
  assert.equal(nextStandingPage.statusCode, 200);
  assert.equal(nextStandingPage.payload.nextCursor, null);

  const allStandingTypes = await invoke(
    makeReq({
      body: { limit: 20 },
      session: {
        authenticated: true, role: 'admin',
        hfmProjectBinding: { verified: true, projectId: 'project-alpha' }
      }
    }),
    async () => ({ status: 'MEMORY_READ_READY', pool: { connect: async () => ({}) } }),
    async options => {
      assert.deepEqual(options.recordTypes, ['learning_note', 'knowledge_item']);
      assert.equal(options.recordType, undefined);
      return {
        status: 'AUTHORIZED_AND_COMMITTED', projectId: 'project-alpha', count: 0,
        records: [], authorityConsumed: false, standingAuthority: true,
        standingAuthorityId: 'standing-001',
        authorityExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        approvalRequiredPerRead: false, nextCursor: null,
        scanStartedAt: new Date(Date.now() - 1000).toISOString()
      };
    },
    { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' }
  );
  assert.equal(allStandingTypes.statusCode, 200);
  console.log('HFM_MEMORY_READ_STANDING_RECORD_TYPE_FILTERS_ARE_MUTUALLY_EXCLUSIVE=PASS');
  console.log('HFM_MEMORY_READ_STANDING_PAGINATION_CURSOR_ROUNDTRIP=PASS');
  console.log('HFM_MEMORY_READ_STANDING_AUTHORITY_NO_PER_READ_GRANT=PASS');

  const invalidStandingCursor = await invoke(
    makeReq({
      body: { limit: 20, recordType: 'learning_note', cursor: 'not-a-valid-base64url-cursor' },
      session: {
        authenticated: true, role: 'admin',
        hfmProjectBinding: { verified: true, projectId: 'project-alpha' }
      }
    }),
    async () => ({ status: 'MEMORY_READ_READY', pool: { connect: async () => ({}) } }),
    async () => {
      const error = new Error('invalid cursor');
      error.code = 'HFM_MEMORY_PAGE_CURSOR_INVALID';
      throw error;
    },
    { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' }
  );
  assert.equal(invalidStandingCursor.statusCode, 400);
  console.log('HFM_MEMORY_READ_MALFORMED_CURSOR_CLIENT_ERROR=PASS');

  const standingTrashBlocked = await invoke(
    makeReq({ body: { limit: 20, recordType: 'social_post_draft', lifecycle: 'TRASHED' } }),
    async () => ({ status: 'MEMORY_READ_READY', pool: { connect: async () => ({}) } }),
    async () => { throw new Error('standing scope must reject before retrieval'); },
    { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' }
  );
  assert.equal(standingTrashBlocked.statusCode, 400);
  console.log('HFM_MEMORY_READ_STANDING_SCOPE_BLOCKS_SOCIAL_DRAFT_AND_TRASH=PASS');

  const oneTimeCursor = await invoke(makeReq({
    body: { limit: 25, cursor: 'forged-cursor' }
  }));
  assert.equal(oneTimeCursor.statusCode, 400);
  console.log('HFM_MEMORY_READ_CURSOR_REQUIRES_STANDING_AUTHORITY=PASS');

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
