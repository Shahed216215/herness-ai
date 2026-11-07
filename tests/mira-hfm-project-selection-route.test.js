'use strict';

const assert = require('node:assert/strict');
const { registerMiraHfmProjectSelectionRoute } = require('../routes/mira-hfm-project-selection');
const { BINDING_VERSION } = require('../services/mira-hfm-project-binding-context');

const now = Date.now();
const sessionID = 'project-selection-session-001';
const principal = {
  verified: true, issuer: 'mira.users',
  subject: '11111111-1111-4111-8111-111111111111',
  actorType: 'HUMAN', authenticationMethod: 'USER_SESSION',
  authenticationRef: sessionID,
  authenticatedAt: new Date(now - 60_000).toISOString(),
  expiresAt: new Date(now + 60 * 60_000).toISOString()
};
const actorId = 'mira:mira.users:' + principal.subject;
const projectId = 'project-alpha';

function appFixture(runtimeProvider) {
  const app = {
    post(path, handler) { this.path = path; this.handler = handler; }
  };
  registerMiraHfmProjectSelectionRoute(app, runtimeProvider);
  return app;
}
function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}
function request(overrides = {}) {
  return {
    sessionID,
    secure: true,
    get: overrides.get || function(name) { return name === 'origin' ? 'https://mira.example' : name === 'host' ? 'mira.example' : undefined; },
    session: {
      authenticated: true, role: 'user', hfmPrincipal: principal,
      save(callback) { callback(null); },
      ...(overrides.session || {})
    },
    body: { projectId, actorId: 'attacker', ...(overrides.body || {}) }
  };
}
function fakePool({ noMembership = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM mira_hfm.project_owners owner')) {
        return { rows: noMembership ? [] : [{
          project_id: projectId, owner_revision: 3,
          membership_id: 'membership-001', membership_revision: 7,
          permissions: { operations: ['memory.read'] },
          membership_role: 'ADMIN'
        }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  return { calls, pool: { async connect() { return client; } } };
}

(async () => {
  assert.equal(typeof registerMiraHfmProjectSelectionRoute, 'function');
  const f = fakePool();
  const app = appFixture(async () => ({ status: 'PROJECT_READ_READY', pool: f.pool }));
  assert.equal(app.path, '/api/hfm/projects/select');
  const req = request();
  req.role = 'user';
  const res = response();
  await app.handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(req.session.hfmProjectBinding.verified, true);
  assert.equal(req.session.hfmProjectBinding.bindingVersion, BINDING_VERSION);
  assert.equal(req.session.hfmProjectBinding.actorId, actorId);
  assert.equal(req.session.hfmProjectBinding.projectId, projectId);
  assert.ok(f.calls.some(item => item.sql.includes("set_config('mira.actor_id'") &&
    item.params[0] === actorId));
  assert.equal(res.body.project.membershipRole, 'ADMIN');
  console.log('HFM_PROJECT_SELECTION_REQUIRES_ACTIVE_SESSION_MEMBERSHIP=PASS');

  const crossOriginReq = request({
    get(name) { return name === 'origin' ? 'https://evil.example' : name === 'host' ? 'mira.example' : undefined; }
  });
  crossOriginReq.role = 'user';
  const crossOriginRes = response();
  await app.handler(crossOriginReq, crossOriginRes);
  assert.equal(crossOriginRes.statusCode, 403);
  console.log('HFM_PROJECT_SELECTION_CROSS_ORIGIN_BLOCK=PASS');

  const disabledApp = appFixture(async () => ({ status: 'DISABLED', pool: null }));
  const disabledRes = response();
  await disabledApp.handler(request(), disabledRes);
  assert.equal(disabledRes.statusCode, 503);
  console.log('HFM_PROJECT_SELECTION_DISABLED_BY_DEFAULT=PASS');

  const denied = fakePool({ noMembership: true });
  const deniedApp = appFixture(async () => ({ status: 'PROJECT_READ_READY', pool: denied.pool }));
  const deniedRes = response();
  await deniedApp.handler(request(), deniedRes);
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(deniedRes.body.success, false);
  console.log('HFM_PROJECT_SELECTION_NO_MEMBERSHIP_FAILS_CLOSED=PASS');

  const unauthenticatedApp = appFixture(async () => ({ status: 'PROJECT_READ_READY', pool: f.pool }));
  const unauthenticatedRes = response();
  await unauthenticatedApp.handler(request({ session: { authenticated: false } }), unauthenticatedRes);
  assert.equal(unauthenticatedRes.statusCode, 401);
  console.log('HFM_PROJECT_SELECTION_UNAUTHENTICATED_SESSION_BLOCK=PASS');

  const previous = { verified: true, bindingVersion: BINDING_VERSION, actorId, projectId: 'old-project', selectedAt: new Date(now - 5000).toISOString() };
  const saveFailureReq = request({ session: { hfmProjectBinding: previous, save(callback) { callback(new Error('synthetic')); } } });
  const saveFailureRes = response();
  await app.handler(saveFailureReq, saveFailureRes);
  assert.equal(saveFailureRes.statusCode, 503);
  assert.deepEqual(saveFailureReq.session.hfmProjectBinding, previous);
  console.log('HFM_PROJECT_SELECTION_SESSION_SAVE_FAILURE_RESTORES_PRIOR_BINDING=PASS');
  console.log('REQUEST_BODY_ACTOR_ID_IGNORED=PASS');
  console.log('NETWORK_REQUESTS=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
