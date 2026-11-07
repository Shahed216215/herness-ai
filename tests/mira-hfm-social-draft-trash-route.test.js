'use strict';

const assert = require('node:assert/strict');
const { registerMiraHfmSocialDraftTrashRoute } = require('../routes/mira-hfm-social-draft-trash');

let issued = 0;
let consumed = 0;
let trashed = 0;
const fakeIssue = async options => {
  issued += 1;
  assert.equal(options.operation, 'memory.trash');
  assert.equal(options.resource, 'memory:social-draft-001');
  assert.equal(options.approvalConfirmed, true);
  return {
    status: 'AUTHORITY_ISSUED',
    operation: 'memory.trash',
    resource: options.resource,
    projectId: 'project-alpha',
    grant: { authorityId: 'authority-trash-001', purpose: options.purpose, requestId: 'request-trash-001' }
  };
};
const fakeExecute = async options => {
  consumed += 1;
  assert.equal(options.request.operation, 'memory.trash');
  assert.equal(options.request.resource, 'memory:social-draft-001');
  const value = await options.perform({ query: async () => ({ rowCount: 1, rows: [] }) }, {
    actorId: 'mira:mira.admins:11111111-1111-4111-8111-111111111111',
    projectId: 'project-alpha',
    operation: 'memory.trash',
    resource: 'memory:social-draft-001',
    purpose: 'Facebook post manually published',
    requestId: 'request-trash-001',
    authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY'
  });
  return { status: 'AUTHORIZED_AND_COMMITTED', value };
};
const fakeTrash = async options => {
  trashed += 1;
  assert.equal(options.expectedRecordType, 'social_post_draft');
  assert.equal(options.allowPrivateLifecycle, true);
  assert.equal(options.allowRestrictedLifecycle, false);
  assert.equal(options.memoryId, 'social-draft-001');
  assert.equal(options.idempotencyKey, 'hfm-trash-idem-0001');
  return { status: 'TRASHED', memoryId: options.memoryId, revision: 2 };
};

function makeReq(overrides = {}) {
  return {
    role: 'admin',
    secure: true,
    get(name) {
      if (name === 'origin') return 'https://mira.example';
      if (name === 'host') return 'mira.example';
      return undefined;
    },
    session: {
      authenticated: true,
      role: 'admin',
      hfmPrincipal: { verified: true, issuer: 'mira.admins', subject: '11111111-1111-4111-8111-111111111111' },
      hfmProjectBinding: { verified: true, projectId: 'project-alpha' }
    },
    body: {
      confirm: true,
      memoryId: 'social-draft-001',
      purpose: 'Facebook post manually published',
      idempotencyKey: 'hfm-trash-idem-0001'
    },
    ...overrides
  };
}
function makeRes() {
  return {
    statusCode: 200, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
}
async function invoke(req, writer = async () => ({
  status: 'MEMORY_WRITER_READY', pool: { connect: async () => ({}) }
}), issuer = async () => ({
  status: 'AUTHORITY_ISSUER_READY', pool: { connect: async () => ({}) }
}), issue = fakeIssue) {
  let handler;
  const res = makeRes();
  const app = { post(path, middleware, callback) {
    assert.equal(path, '/api/hfm/social-drafts/trash');
    handler = { middleware, callback };
  } };
  registerMiraHfmSocialDraftTrashRoute(
    app, writer, issuer, (_req, _res, next) => next(), issue, fakeExecute, fakeTrash
  );
  await handler.middleware(req, res, () => {});
  if (res.payload) return res;
  await handler.callback(req, res);
  return res;
}

(async () => {
  const crossOrigin = await invoke(makeReq({
    get(name) { return name === 'origin' ? 'https://evil.example' : 'mira.example'; }
  }));
  assert.equal(crossOrigin.statusCode, 403);
  console.log('HFM_SOCIAL_DRAFT_TRASH_CROSS_ORIGIN_BLOCK=PASS');

  const noConfirm = await invoke(makeReq({ body: { confirm: false, memoryId: 'social-draft-001', purpose: 'published', idempotencyKey: 'hfm-trash-idem-0001' } }));
  assert.equal(noConfirm.statusCode, 400);
  console.log('HFM_SOCIAL_DRAFT_TRASH_EXPLICIT_CONFIRMATION_REQUIRED=PASS');

  const noIdempotency = await invoke(makeReq({ body: { confirm: true, memoryId: 'social-draft-001', purpose: 'published' } }));
  assert.equal(noIdempotency.statusCode, 400);
  console.log('HFM_SOCIAL_DRAFT_TRASH_STABLE_IDEMPOTENCY_REQUIRED=PASS');

  const noBinding = await invoke(makeReq({
    session: { authenticated: true, role: 'admin', hfmPrincipal: {}, hfmProjectBinding: null }
  }));
  assert.equal(noBinding.statusCode, 403);
  console.log('HFM_SOCIAL_DRAFT_TRASH_VERIFIED_PROJECT_REQUIRED=PASS');

  const disabledWriter = await invoke(makeReq(), async () => ({ status: 'DISABLED', pool: null }));
  assert.equal(disabledWriter.statusCode, 503);
  console.log('HFM_SOCIAL_DRAFT_TRASH_WRITER_DISABLED_FAIL_CLOSED=PASS');

  const success = await invoke(makeReq());
  assert.equal(success.statusCode, 200);
  assert.equal(success.payload.status, 'TRASHED');
  assert.equal(success.payload.lifecycle, 'TRASHED');
  assert.equal(success.payload.recoverable, true);
  assert.equal(success.payload.hardDelete, false);
  assert.equal(issued, 1);
  assert.equal(consumed, 1);
  assert.equal(trashed, 1);
  console.log('HFM_SOCIAL_DRAFT_TRASH_ONE_TIME_AUTHORITY_AND_RECOVERABLE_COMMIT=PASS');

  const badAuthority = await invoke(makeReq(), undefined, undefined, async () => ({
    status: 'AUTHORITY_ISSUED', operation: 'memory.write', resource: 'memory:other',
    projectId: 'project-alpha', grant: { authorityId: 'bad', purpose: 'published', requestId: 'bad' }
  }));
  assert.equal(badAuthority.statusCode, 503);
  console.log('HFM_SOCIAL_DRAFT_TRASH_MISMATCHED_AUTHORITY_BLOCK=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
