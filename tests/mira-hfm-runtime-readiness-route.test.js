'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const contextPath = require.resolve('../services/mira-hfm-runtime-identity-context');
require.cache[contextPath] = {
  id: contextPath,
  filename: contextPath,
  loaded: true,
  exports: {
    buildTrustedActorContext(req) {
      return req && req.role === 'admin'
        ? { status: 'ACTOR_RESOLVED', actor: { role: 'admin' } }
        : { status: 'ACTOR_RESOLVED', actor: { role: 'user' } };
    }
  }
};

const register = require('../routes/mira-hfm-runtime-readiness');

function setup(inspect = () => ({ status: 'NOT_CONFIGURED', productionReadiness: 'NOT_CERTIFIED' })) {
  const routes = [];
  const auth = (_req, _res, next) => next();
  register({ get: (route, ...handlers) => routes.push({ route, handlers }) }, auth, { inspect });
  return { routes, auth };
}
function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('runtime readiness endpoint is registered behind authentication', () => {
  const { routes, auth } = setup();
  assert.equal(routes.length, 1);
  assert.equal(routes[0].route, '/api/hfm/runtime/readiness');
  assert.equal(routes[0].handlers[0], auth);
});

test('runtime readiness endpoint denies non-admin identities before inspection', () => {
  let inspections = 0;
  const { routes } = setup(() => { inspections++; return { status: 'CONFIGURED_NOT_CONNECTED' }; });
  const res = response();
  routes[0].handlers[1]({ role: 'user' }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'HFM_ADMIN_IDENTITY_REQUIRED');
  assert.equal(inspections, 0);
});

test('runtime readiness endpoint labels configuration-only result and does not claim readiness', () => {
  const { routes } = setup(() => ({
    status: 'CONFIGURED_NOT_CONNECTED',
    databaseConnectivity: 'NOT_TESTED',
    productionReadiness: 'NOT_CERTIFIED'
  }));
  const res = response();
  routes[0].handlers[1]({ role: 'admin' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.diagnostic, 'CONFIGURATION_ONLY');
  assert.equal(res.body.runtimeReady, false);
  assert.equal(res.body.databaseConnectivity, 'NOT_TESTED');
  assert.equal(res.body.productionReadiness, 'NOT_CERTIFIED');
});

test('runtime readiness endpoint fails closed when diagnostic throws', () => {
  const { routes } = setup(() => { throw new Error('private detail'); });
  const res = response();
  routes[0].handlers[1]({ role: 'admin' }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'HFM_RUNTIME_DIAGNOSTIC_FAILED');
  assert.equal(JSON.stringify(res.body).includes('private detail'), false);
});
