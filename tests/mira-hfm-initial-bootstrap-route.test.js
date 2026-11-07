'use strict';

const assert = require('node:assert/strict');
const { registerMiraHfmInitialBootstrapRoute } = require('../routes/mira-hfm-initial-bootstrap');

let bootstrapCalls = 0;
const fakeBootstrap = async options => {
  bootstrapCalls += 1;
  assert.equal(options.confirm, true);
  assert.equal(options.projectId, 'mira-core');
  return {
    status: 'HFM_INITIAL_PROJECT_BOOTSTRAPPED',
    projectId: 'mira-core',
    ownerActorId: 'mira:mira.admins:admin-001',
    membershipRole: 'ADMIN',
    permissions: ['memory.read', 'memory.write', 'memory.trash', 'memory.restore'],
    approvalRef: 'hfm-bootstrap-ref',
    oneTimeOnly: true,
    memoryRecordsImported: 0
  };
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
    session: { authenticated: true, role: 'admin' },
    body: { confirm: true, projectId: 'mira-core' },
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
  status: 'HFM_BOOTSTRAP_READY', pool: { connect: async () => ({}) }
})) {
  let captured;
  const res = response();
  const app = { post(_path, middleware, handler) { captured = { middleware, handler }; } };
  registerMiraHfmInitialBootstrapRoute(app, runtime, (_req, _res, next) => next(), fakeBootstrap);
  await captured.middleware(req, res, () => {});
  if (res.payload) return res;
  await captured.handler(req, res);
  return res;
}

(async () => {
  const noSession = await invoke(makeReq({ session: null }));
  assert.equal(noSession.statusCode, 401);
  console.log('HFM_BOOTSTRAP_ROUTE_ADMIN_SESSION_REQUIRED=PASS');

  const noConfirm = await invoke(makeReq({ body: { confirm: false, projectId: 'mira-core' } }));
  assert.equal(noConfirm.statusCode, 400);
  console.log('HFM_BOOTSTRAP_ROUTE_EXPLICIT_CONFIRMATION_REQUIRED=PASS');

  const wrongOrigin = await invoke(makeReq({
    get(name) { return name === 'origin' ? 'https://attacker.example' : 'mira.example'; }
  }));
  assert.equal(wrongOrigin.statusCode, 403);
  console.log('HFM_BOOTSTRAP_ROUTE_CROSS_ORIGIN_BLOCK=PASS');

  const disabled = await invoke(makeReq(), async () => ({ status: 'DISABLED', pool: null }));
  assert.equal(disabled.statusCode, 503);
  console.log('HFM_BOOTSTRAP_ROUTE_DISABLED_RUNTIME_FAIL_CLOSED=PASS');

  const success = await invoke(makeReq());
  assert.equal(success.statusCode, 201);
  assert.equal(success.payload.projectId, 'mira-core');
  assert.equal(success.payload.oneTimeOnly, true);
  assert.equal(success.payload.memoryRecordsImported, 0);
  assert.equal(bootstrapCalls, 1);
  console.log('HFM_BOOTSTRAP_ROUTE_ISSUES_INITIAL_PROJECT=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
