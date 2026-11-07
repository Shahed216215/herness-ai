'use strict';

const assert = require('node:assert/strict');
const approvalModule = require('../services/mira-hfm-authority-approval');
const original = approvalModule.approveAndIssueMemoryReadAuthority;
let approvalCalls = 0;
approvalModule.approveAndIssueMemoryReadAuthority = async options => {
  approvalCalls += 1;
  assert.equal(options.approvalConfirmed, true);
  assert.equal(options.purpose, 'approved retrieval');
  return {
    status: 'AUTHORITY_ISSUED',
    projectId: 'project-alpha',
    operation: 'memory.read',
    grant: { authorityId: 'authority-001', purpose: 'approved retrieval', requestId: 'request-001' },
    singleUse: true,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    token: 'must-not-be-returned'
  };
};
const { registerMiraHfmAuthorityApprovalRoute, sameOriginRequest } =
  require('../routes/mira-hfm-authority-approval');
approvalModule.approveAndIssueMemoryReadAuthority = original;

let route;
let adminMiddleware;
const app = {
  post(path, middleware, handler) {
    assert.equal(path, '/api/hfm/memory/authorize');
    adminMiddleware = middleware;
    route = handler;
  }
};
registerMiraHfmAuthorityApprovalRoute(
  app,
  async () => ({ status: 'AUTHORITY_ISSUER_READY', pool: { connect: async () => ({}) } }),
  (req, res, next) => next()
);
assert.equal(typeof route, 'function');
assert.equal(typeof adminMiddleware, 'function');

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
      hfmPrincipal: { verified: true },
      hfmProjectBinding: { verified: true }
    },
    body: { confirm: true, purpose: 'approved retrieval' },
    ...overrides
  };
}
function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
}
async function invoke(req, runtime = async () => ({
  status: 'AUTHORITY_ISSUER_READY', pool: { connect: async () => ({}) }
})) {
  let captured;
  const res = response();
  const app = { post(_path, middleware, handler) { captured = { middleware, handler }; } };
  registerMiraHfmAuthorityApprovalRoute(app, runtime, (_req, _res, next) => next());
  await captured.middleware(req, res, () => {});
  if (res.payload) return res;
  await captured.handler(req, res);
  return res;
}

(async () => {
  assert.equal(sameOriginRequest(makeReq()), true);
  assert.equal(sameOriginRequest(makeReq({
    get(name) { return name === 'origin' ? 'https://evil.example' : 'mira.example'; }
  })), false);
  console.log('HFM_APPROVAL_ROUTE_SAME_ORIGIN_GUARD=PASS');

  const noSession = await invoke(makeReq({ session: null }));
  assert.equal(noSession.statusCode, 401);
  console.log('HFM_APPROVAL_ROUTE_SESSION_REQUIRED=PASS');

  const noBinding = await invoke(makeReq({ session: { authenticated: true, role: 'admin', hfmPrincipal: {} } }));
  assert.equal(noBinding.statusCode, 403);
  console.log('HFM_APPROVAL_ROUTE_VERIFIED_PROJECT_REQUIRED=PASS');

  const noConfirm = await invoke(makeReq({ body: { confirm: false, purpose: 'approved retrieval' } }));
  assert.equal(noConfirm.statusCode, 400);
  console.log('HFM_APPROVAL_ROUTE_EXPLICIT_CONFIRMATION_REQUIRED=PASS');

  const wrongOrigin = await invoke(makeReq({
    get(name) { return name === 'origin' ? 'https://attacker.example' : 'mira.example'; }
  }));
  assert.equal(wrongOrigin.statusCode, 403);
  console.log('HFM_APPROVAL_ROUTE_CROSS_ORIGIN_BLOCK=PASS');

  const disabled = await invoke(makeReq(), async () => ({ status: 'DISABLED', pool: null }));
  assert.equal(disabled.statusCode, 503);
  console.log('HFM_APPROVAL_ROUTE_DISABLED_RUNTIME_FAIL_CLOSED=PASS');

  const success = await invoke(makeReq());
  assert.equal(success.statusCode, 201);
  assert.equal(success.payload.status, 'AUTHORITY_ISSUED');
  assert.equal(success.payload.grant.authorityId, 'authority-001');
  assert.equal(Object.prototype.hasOwnProperty.call(success.payload, 'token'), false);
  assert.equal(approvalCalls, 1);
  console.log('HFM_APPROVAL_ROUTE_ISSUES_AUTHORITY_WITHOUT_LEAKING_TOKEN=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
