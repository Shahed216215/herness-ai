'use strict';

const assert = require('node:assert/strict');
const { registerMiraHfmDailySocialDraftRoute, localDateInTimeZone } = require('../routes/mira-hfm-daily-social-draft');

let issueCalls = [];
let executeCalls = 0;
let readCalls = 0;
let saveCalls = 0;
const draft = { memoryId: 'daily-post-abcdef1234567890abcdef1234567890' };
const fakeIssue = async options => {
  issueCalls.push({ operation: options.operation, resource: options.resource });
  return {
    status: 'AUTHORITY_ISSUED',
    operation: options.operation,
    resource: options.resource,
    projectId: 'project-alpha',
    grant: {
      authorityId: 'authority-' + issueCalls.length,
      purpose: options.purpose,
      requestId: 'request-' + issueCalls.length
    }
  };
};
const fakeRead = async options => {
  readCalls += 1;
  assert.equal(options.limit, 100);
  assert.equal(options.lifecycle, 'ACTIVE');
  return { status: 'AUTHORIZED_AND_COMMITTED', records: [{ recordType: 'daily_activity' }, { recordType: 'learning_note' }] };
};
const fakeBuild = options => {
  assert.equal(options.projectId, 'project-alpha');
  assert.equal(options.timeZone, 'Asia/Dhaka');
  assert.equal(options.records.length, 2);
  return {
    status: 'DRAFT_READY',
    draft,
    sourceCounts: { activities: 1, learnings: 1 },
    sourceRecordIds: ['activity-001', 'learning-001']
  };
};
const fakeSave = async options => {
  saveCalls += 1;
  assert.equal(options.projectId, 'project-alpha');
  assert.equal(options.localDate.length, 10);
  assert.equal(options.allowPrivateWrite, true);
  assert.equal(options.records.length, 2);
  return {
    status: 'DRAFT_READY',
    draft,
    sourceCounts: { activities: 1, learnings: 1 },
    saved: { status: 'CREATED', memoryId: draft.memoryId }
  };
};
const fakeExecute = async options => {
  executeCalls += 1;
  assert.equal(options.request.operation, 'memory.write');
  assert.equal(options.request.resource, 'memory:' + draft.memoryId);
  const value = await options.perform({}, {
    actorId: 'mira:mira.admins:11111111-1111-4111-8111-111111111111',
    projectId: 'project-alpha', operation: 'memory.write',
    resource: 'memory:' + draft.memoryId,
    purpose: 'approved draft write', requestId: options.request.requestId,
    authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY'
  });
  return { status: 'AUTHORIZED_AND_COMMITTED', value };
};
function makeReq(overrides = {}) {
  return {
    role: 'admin', secure: true,
    get(name) { return name === 'origin' ? 'https://mira.example' : name === 'host' ? 'mira.example' : undefined; },
    session: {
      authenticated: true, role: 'admin',
      hfmPrincipal: { verified: true, issuer: 'mira.admins', subject: '11111111-1111-4111-8111-111111111111' },
      hfmProjectBinding: { verified: true, projectId: 'project-alpha' }
    },
    body: { confirm: true, timeZone: 'Asia/Dhaka' },
    ...overrides
  };
}
function makeRes() {
  return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
}
async function invoke(req, reader = async () => ({ status: 'MEMORY_READ_READY', pool: { connect: async () => ({}) }), builder = fakeBuild) {
  let handler;
  const res = makeRes();
  const app = { post(path, middleware, callback) { assert.equal(path, '/api/hfm/social-drafts/generate-daily'); handler = { middleware, callback }; } };
  registerMiraHfmDailySocialDraftRoute(
    app,
    reader,
    async () => ({ status: 'MEMORY_WRITER_READY', pool: { connect: async () => ({}) } }),
    async () => ({ status: 'AUTHORITY_ISSUER_READY', pool: { connect: async () => ({}) } }),
    (_req, _res, next) => next(),
    fakeIssue, fakeRead, fakeExecute, builder, fakeSave
  );
  await handler.middleware(req, res, () => {});
  if (res.payload) return res;
  await handler.callback(req, res);
  return res;
}

(async () => {
  assert.match(localDateInTimeZone(new Date('2026-11-07T00:30:00.000Z'), 'Asia/Dhaka'), /^2026-11-07$/);
  console.log('HFM_DAILY_SOCIAL_DRAFT_DHAKA_LOCAL_DATE=PASS');

  const noConfirm = await invoke(makeReq({ body: { confirm: false, timeZone: 'Asia/Dhaka' } }));
  assert.equal(noConfirm.statusCode, 400);
  console.log('HFM_DAILY_SOCIAL_DRAFT_EXPLICIT_CONFIRMATION_REQUIRED=PASS');

  const invalidZone = await invoke(makeReq({ body: { confirm: true, timeZone: 'UTC' } }));
  assert.equal(invalidZone.statusCode, 400);
  console.log('HFM_DAILY_SOCIAL_DRAFT_TIMEZONE_FIXED=PASS');

  const success = await invoke(makeReq());
  assert.equal(success.statusCode, 201);
  assert.equal(success.payload.draftSaved, true);
  assert.equal(success.payload.memoryId, draft.memoryId);
  assert.equal(success.payload.classification, 'PROJECT_PRIVATE');
  assert.equal(success.payload.autoPublish, false);
  assert.equal(issueCalls.length, 2);
  assert.deepEqual(issueCalls[0], { operation: 'memory.read', resource: 'memory:project:project-alpha' });
  assert.deepEqual(issueCalls[1], { operation: 'memory.write', resource: 'memory:' + draft.memoryId });
  assert.equal(readCalls, 1);
  assert.equal(executeCalls, 1);
  assert.equal(saveCalls, 1);
  console.log('HFM_DAILY_SOCIAL_DRAFT_READ_WRITE_AUTHORITY_AND_PRIVATE_SAVE=PASS');
  console.log('HFM_DAILY_SOCIAL_DRAFT_NO_FACEBOOK_PUBLISH=PASS');

  issueCalls = [];
  readCalls = 0;
  executeCalls = 0;
  saveCalls = 0;
  const noSources = await invoke(makeReq(), async options => {
    readCalls += 1;
    return { status: 'AUTHORIZED_AND_COMMITTED', records: [] };
  }, () => ({ status: 'NO_DAILY_SOURCE_RECORDS', draft: null, sourceCounts: { activities: 0, learnings: 0 } }));
  assert.equal(noSources.statusCode, 200);
  assert.equal(noSources.payload.draftSaved, false);
  assert.equal(issueCalls.length, 1);
  assert.equal(executeCalls, 0);
  assert.equal(saveCalls, 0);
  console.log('HFM_DAILY_SOCIAL_DRAFT_NO_SOURCE_NO_WRITE=PASS');

  const disabled = await invoke(makeReq(), async () => ({ status: 'DISABLED', pool: null }));
  assert.equal(disabled.statusCode, 503);
  console.log('HFM_DAILY_SOCIAL_DRAFT_DISABLED_RUNTIME_FAIL_CLOSED=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => { console.error(error); process.exitCode = 1; });
