'use strict';

const assert = require('node:assert/strict');
const { registerMiraHfmSocialDraftRestoreRoute } = require('../routes/mira-hfm-social-draft-restore');

let restoreCalls = 0;
const fakeIssue = async options => ({
  status: 'AUTHORITY_ISSUED', operation: 'memory.restore',
  resource: options.resource, projectId: 'project-alpha',
  grant: { authorityId: 'restore-authority', purpose: options.purpose, requestId: 'restore-request' }
});
const fakeExecute = async options => {
  const value = await options.perform({}, {
    actorId: 'mira:mira.admins:11111111-1111-4111-8111-111111111111',
    projectId: 'project-alpha', operation: 'memory.restore',
    resource: 'memory:social-draft-001', purpose: 'restore after review',
    requestId: 'restore-request', authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY'
  });
  return { status: 'AUTHORIZED_AND_COMMITTED', value };
};
const fakeRestore = async options => {
  restoreCalls += 1;
  assert.equal(options.expectedRecordType, 'social_post_draft');
  assert.equal(options.allowPrivateLifecycle, true);
  assert.equal(options.allowRestrictedLifecycle, false);
  return { status: 'RESTORED', memoryId: options.memoryId, revision: 3 };
};
function req(overrides = {}) {
  return {
    role: 'admin', secure: true,
    get(name) { return name === 'origin' ? 'https://mira.example' : name === 'host' ? 'mira.example' : undefined; },
    session: {
      authenticated: true, role: 'admin', hfmPrincipal: { verified: true },
      hfmProjectBinding: { verified: true, projectId: 'project-alpha' }
    },
    body: { confirm: true, memoryId: 'social-draft-001', purpose: 'restore after review', idempotencyKey: 'restore-idempotency-001' },
    ...overrides
  };
}
function res() {
  return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
}
async function invoke(
  input,
  writer = async () => ({ status: 'MEMORY_WRITER_READY', pool: { connect: async () => ({}) } }),
  issuer = async () => ({ status: 'AUTHORITY_ISSUER_READY', pool: { connect: async () => ({}) } })
) {
  let handler;
  const response = res();
  const app = { post(path, middleware, callback) { assert.equal(path, '/api/hfm/social-drafts/restore'); handler = { middleware, callback }; } };
  registerMiraHfmSocialDraftRestoreRoute(app, writer, issuer, (_req, _res, next) => next(), fakeIssue, fakeExecute, fakeRestore);
  await handler.middleware(input, response, () => {});
  if (response.payload) return response;
  await handler.callback(input, response);
  return response;
}
(async () => {
  const noConfirm = await invoke(req({ body: { confirm: false } }));
  assert.equal(noConfirm.statusCode, 400);
  console.log('HFM_SOCIAL_DRAFT_RESTORE_EXPLICIT_CONFIRMATION_REQUIRED=PASS');
  const disabled = await invoke(req(), async () => ({ status: 'DISABLED', pool: null }));
  assert.equal(disabled.statusCode, 503);
  console.log('HFM_SOCIAL_DRAFT_RESTORE_WRITER_DISABLED_FAIL_CLOSED=PASS');
  const success = await invoke(req());
  assert.equal(success.statusCode, 200);
  assert.equal(success.payload.lifecycle, 'ACTIVE');
  assert.equal(success.payload.restored, true);
  assert.equal(restoreCalls, 1);
  console.log('HFM_SOCIAL_DRAFT_RESTORE_ONE_TIME_AUTHORITY_AND_RECOVERY=PASS');
  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => { console.error(error); process.exitCode = 1; });
