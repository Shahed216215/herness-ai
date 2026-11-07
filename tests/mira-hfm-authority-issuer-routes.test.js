'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const routes = require('../routes/mira-hfm-authorities');

test('only supported HFM operation and purpose pairs can be issued', () => {
  assert.deepEqual(routes.validateIssueRequest({
    projectId: 'project-001', operation: 'memory.write',
    resource: 'memory:fbk_12345678', purpose: 'facebook-knowledge-import'
  }), {
    projectId: 'project-001', operation: 'memory.write',
    resource: 'memory:fbk_12345678', purpose: 'facebook-knowledge-import'
  });
  assert.throws(() => routes.validateIssueRequest({
    projectId: 'project-001', operation: 'memory.write',
    resource: 'memory:project:project-001', purpose: 'facebook-knowledge-import'
  }), /HFM_AUTHORITY_ISSUE_RESOURCE_INVALID/);
  assert.deepEqual(routes.validateIssueRequest({
    projectId: 'project-001', operation: 'memory.write',
    resource: 'memory:mem_12345678', purpose: 'memory-core-write'
  }), {
    projectId: 'project-001', operation: 'memory.write',
    resource: 'memory:mem_12345678', purpose: 'memory-core-write'
  });
  assert.throws(() => routes.validateIssueRequest({
    projectId: 'project-001', operation: 'facebook.publish',
    resource: 'memory:fbk_12345678', purpose: 'facebook-knowledge-import'
  }), /HFM_AUTHORITY_ISSUE_SCOPE_NOT_ALLOWED/);
});

test('project permission must explicitly include the exact operation', () => {
  assert.equal(routes.hasPermission({ operations: ['memory.read', 'memory.write'] }, 'memory.write'), true);
  assert.equal(routes.hasPermission({ operations: ['memory.read'] }, 'memory.write'), false);
  assert.equal(routes.hasPermission({ operations: 'memory.write' }, 'memory.write'), false);
});

test('authority issue route is authenticated and fails closed without issuer pool', () => {
  const registrations = [];
  const app = { post: (path, ...handlers) => registrations.push({ path, handlers }) };
  const auth = (_req, _res, next) => next();
  routes.registerHfmAuthorityRoutes(app, auth, { getPool: async () => null });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].path, '/api/hfm/authorities/issue');
  assert.equal(registrations[0].handlers[0], auth);
});

test('authority route never accepts an actor ID from the request body', () => {
  const source = require('node:fs').readFileSync(require.resolve('../routes/mira-hfm-authorities'), 'utf8');
  assert.doesNotMatch(source, /body\.actorId|body\.userId|body\.ownerActorId/);
  assert.match(source, /buildTrustedActorContext\(req\)/);
  assert.match(source, /owner\.owner_actor_id !== actor\.actorId/);
});
