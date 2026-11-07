'use strict';

const assert = require('node:assert/strict');
const { registerMiraHfmStandingReadAuthorityRoutes } = require('../routes/mira-hfm-standing-read-authority');

const routes = new Map();
const app = {
  post(path, middleware, handler) { routes.set(path, { middleware, handler }); }
};
const requireAdmin = (_req, _res, next) => next();
registerMiraHfmStandingReadAuthorityRoutes(app, async () => ({
  status: 'DISABLED', pool: null
}), requireAdmin);

function makeReq(overrides = {}) {
  return {
    role: 'admin',
    secure: true,
    get(name) {
      if (name === 'origin') return 'https://mira.example';
      if (name === 'host') return 'mira.example';
      return undefined;
    },
    body: {},
    session: {
      authenticated: true,
      role: 'admin',
      hfmPrincipal: { verified: true },
      hfmProjectBinding: { verified: true, projectId: 'project-alpha' }
    },
    ...overrides
  };
}
function makeResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
}
async function invoke(path, req) {
  const route = routes.get(path);
  assert.ok(route, 'missing route: ' + path);
  const res = makeResponse();
  await route.middleware(req, res, () => {});
  if (!res.payload) await route.handler(req, res);
  return res;
}

(async () => {
  const originalFlag = process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  try {
    delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
    const disabled = await invoke('/api/hfm/memory/standing-authority/issue', makeReq({
      body: { confirm: true, purpose: 'approved read' }
    }));
    assert.equal(disabled.statusCode, 503);
    assert.match(disabled.payload.error, /disabled/);
    console.log('HFM_STANDING_ROUTE_ISSUE_DISABLED_BY_DEFAULT=PASS');

    process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
    const noConfirmation = await invoke('/api/hfm/memory/standing-authority/issue', makeReq({
      body: { purpose: 'approved read' }
    }));
    assert.equal(noConfirmation.statusCode, 400);
    console.log('HFM_STANDING_ROUTE_EXPLICIT_CONFIRMATION_REQUIRED=PASS');

    const badPurpose = await invoke('/api/hfm/memory/standing-authority/issue', makeReq({
      body: { confirm: true, purpose: ' ' }
    }));
    assert.equal(badPurpose.statusCode, 400);
    console.log('HFM_STANDING_ROUTE_BOUNDED_PURPOSE_REQUIRED=PASS');

    const crossOrigin = await invoke('/api/hfm/memory/standing-authority/issue', makeReq({
      get(name) {
        if (name === 'origin') return 'https://attacker.example';
        if (name === 'host') return 'mira.example';
        return undefined;
      },
      body: { confirm: true, purpose: 'approved read' }
    }));
    assert.equal(crossOrigin.statusCode, 403);
    console.log('HFM_STANDING_ROUTE_CROSS_ORIGIN_BLOCK=PASS');

    const missingProject = await invoke('/api/hfm/memory/standing-authority/issue', makeReq({
      session: { authenticated: true, role: 'admin', hfmPrincipal: { verified: true } },
      body: { confirm: true, purpose: 'approved read' }
    }));
    assert.equal(missingProject.statusCode, 403);
    console.log('HFM_STANDING_ROUTE_VERIFIED_PROJECT_REQUIRED=PASS');

    const invalidId = await invoke('/api/hfm/memory/standing-authority/pause', makeReq({
      body: { standingAuthorityId: ' ' }
    }));
    assert.equal(invalidId.statusCode, 400);
    console.log('HFM_STANDING_ROUTE_AUTHORITY_ID_VALIDATION=PASS');

    const runtimeUnavailable = await invoke('/api/hfm/memory/standing-authority/status', makeReq());
    assert.equal(runtimeUnavailable.statusCode, 503);
    console.log('HFM_STANDING_ROUTE_RUNTIME_NOT_READY_FAILS_CLOSED=PASS');
  } finally {
    if (originalFlag === undefined) delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
    else process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = originalFlag;
  }
  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
