'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const registerRoutes = require('../routes/mira-hfm-social-posts');

function fakeApp() {
  const routes = [];
  const app = {};
  for (const method of ['get', 'post', 'delete']) {
    app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
  }
  return { app, routes };
}

test('registers only authenticated project-authority routes for list, status, copy, confirmation and exact delete', () => {
  const { app, routes } = fakeApp();
  const auth = (_req, _res, next) => next();
  registerRoutes(app, auth, { getPool: async () => null });
  assert.deepEqual(routes.map(x => [x.method, x.path]), [
    ['get', '/api/hfm/social-posts'],
    ['get', '/api/hfm/social-posts/:memoryId'],
    ['post', '/api/hfm/social-posts/:memoryId/copy'],
    ['post', '/api/hfm/social-posts/:memoryId/published'],
    ['delete', '/api/hfm/social-posts/:memoryId']
  ]);
  assert.equal(routes.every(x => x.handlers[0] === auth), true);
});

test('route registration fails closed without auth middleware or writer-pool resolver', () => {
  const { app } = fakeApp();
  assert.throws(() => registerRoutes(app, null, { getPool: async () => null }), /requireAgentAuth/);
  assert.throws(() => registerRoutes(app, () => {}, {}), /writer pool resolver/);
});

test('HTTP route source contains no Facebook login, API publishing or external Facebook calls', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync('routes/mira-hfm-social-posts.js', 'utf8');
  assert.doesNotMatch(source, /graph\.facebook\.com|facebook\.com\/.*\/feed|access_token|publish_to_facebook/i);
  assert.match(source, /workflow\.OPERATIONS\.PUBLISH/);
  assert.match(source, /clipboardCopySucceeded !== true/);
  assert.match(source, /value\.status === 'NOT_FOUND'/);
  assert.match(source, /userConfirmedDelete === true/);
  assert.match(source, /executeWithConsumedAuthority/);
});

test('unverified browser identity is rejected before writer-pool access', async () => {
  const { app, routes } = fakeApp();
  let poolCalls = 0;
  const auth = (_req, _res, next) => next();
  registerRoutes(app, auth, { getPool: async () => { poolCalls += 1; return null; } });
  const route = routes.find(x => x.method === 'get' && x.path === '/api/hfm/social-posts');
  const handler = route.handlers[route.handlers.length - 1];
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
  await handler({
    query: { projectId: 'project-001', authorityId: 'authority-001', requestId: 'request-001' },
    session: null,
    role: 'user',
    sessionID: null
  }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, 'HFM_TRUSTED_ACTOR_REQUIRED');
  assert.equal(poolCalls, 0);
});


test('copy acknowledgement requires explicit successful clipboard result before pool access', async () => {
  const { app, routes } = fakeApp();
  let poolCalls = 0;
  const auth = (_req, _res, next) => next();
  registerRoutes(app, auth, { getPool: async () => { poolCalls += 1; return null; } });
  const route = routes.find(x => x.method === 'post' && x.path === '/api/hfm/social-posts/:memoryId/copy');
  const handler = route.handlers[route.handlers.length - 1];
  const response = {
    statusCode: 200, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
  await handler({
    params: { memoryId: 'post-0001' },
    body: { projectId: 'project-001', authorityId: 'authority-001', requestId: 'request-001', idempotencyKey: 'copy-001', clipboardCopySucceeded: false },
    session: null, role: 'user', sessionID: null
  }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, 'HFM_SOCIAL_POST_CLIPBOARD_CONFIRMATION_REQUIRED');
  assert.equal(poolCalls, 0);
});
