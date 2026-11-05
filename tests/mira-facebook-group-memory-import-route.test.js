'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');

const routes = {};
const routerUses = [];
const router = {
  use(...args) { routerUses.push(args); },
  get(path, handler) { routes['GET ' + path] = handler; },
  post(path, handler) { routes['POST ' + path] = handler; }
};
const expressMock = {
  Router: () => router,
  json: options => {
    assert.equal(options.limit, '1mb');
    return function jsonParser() {};
  }
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'express') return expressMock;
  return originalLoad.call(this, request, parent, isMain);
};
let register;
try {
  register = require('../routes/mira-facebook-group-memory-import');
} finally {
  Module._load = originalLoad;
}

const db = new Map();
const audits = [];
const store = {
  capabilities: {
    atomicCreateOnly: true,
    immutableVersions: true,
    projectIsolation: true,
    readAfterWrite: true
  },
  async listBatches({ projectId, groupId }) {
    return [...db.values()].filter(b => b.projectId === projectId && b.groupId === groupId)
      .map(b => JSON.parse(JSON.stringify(b)));
  },
  async stageBatch(batch) {
    const previous = db.get(batch.batchId);
    if (previous) {
      if (previous.batchDigest !== batch.batchDigest) throw new Error('immutable conflict');
      return { status: 'ALREADY_EXISTS', batchId: batch.batchId };
    }
    db.set(batch.batchId, JSON.parse(JSON.stringify(batch)));
    return { status: 'CREATED', batchId: batch.batchId };
  },
  async readBatch(id, projectId) {
    const batch = db.get(id);
    if (!batch || batch.projectId !== projectId) return null;
    return JSON.parse(JSON.stringify(batch));
  },
  async writeAuditEvent(event) {
    audits.push(event);
    return { status: 'AUDIT_WRITE_READBACK_VERIFIED' };
  }
};

let permissionRequested;
let mounted;
const app = { use(...args) { mounted = args; } };
register(app, permission => {
  permissionRequested = permission;
  return function systemAdminGuard() {};
}, { SYSTEM_ADMIN: 'SYSTEM_ADMIN' }, {
  createStore: () => store,
  auditWriter: async event => audits.push(event)
});

assert.equal(permissionRequested, 'SYSTEM_ADMIN');
assert.equal(mounted[0], '/api/admin/facebook-group');
assert.equal(typeof mounted[1], 'function');
assert.equal(mounted[2], router);
assert.equal(routerUses.length, 1);
assert.equal(typeof routerUses[0][0], 'function');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

(async () => {
  const base = {
    format: 'manual',
    content: 'A synthetic note supplied by the Group administrator.',
    groupId: '123456789',
    projectId: 'project-hfm-v02',
    sourceId: 'manual-route-fixture',
    observedAt: '2026-11-04T10:00:00.000Z'
  };
  let res = response();
  await routes['POST /import']({
    role: 'admin',
    session: { authenticated: true, role: 'admin', username: 'fixture-admin' },
    body: { ...base, authorizedAccess: false }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'FB_GROUP_IMPORT_AUTHORIZATION_REQUIRED');
  assert.equal(db.size, 0);

  res = response();
  await routes['POST /import']({
    role: 'admin',
    session: { authenticated: true, role: 'admin', username: 'fixture-admin' },
    body: { ...base, authorizedAccess: true }
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.result.status, 'IMPORT_STAGED_READBACK_VERIFIED');
  assert.equal(res.body.result.canonicalMemoryWrite, false);
  assert.equal(audits.length, 1);

  res = response();
  await routes['GET /retrieve']({
    query: { projectId: 'project-hfm-v02', groupId: '123456789', query: 'synthetic note', limit: '10' }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.resultCount, 1);
  assert.equal(res.body.result.results[0].retrievableAsTrustedMemory, false);

  res = response();
  await routes['POST /import']({ role: 'admin', session: null, body: { ...base, authorizedAccess: true } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'FB_GROUP_IMPORT_ACTOR_REQUIRED');

  console.log('GROUP_IMPORT_ADMIN_ROUTE_GUARD_AND_PARSER=PASS');
  console.log('GROUP_IMPORT_AUTHORIZATION_ATTESTATION=PASS');
  console.log('GROUP_IMPORT_ROUTE_STAGE_AND_RETRIEVAL=PASS');
  console.log('GROUP_IMPORT_NAMED_ADMIN_AUDIT=PASS');
  console.log('LIVE_FACEBOOK_REQUESTS=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
