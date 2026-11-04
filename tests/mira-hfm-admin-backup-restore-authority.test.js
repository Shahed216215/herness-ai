'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const helperMatch = server.match(/function requireAdminPermission\(permission\) \{[\s\S]*?\n\}\n(?=\nfunction buildMemoryStats)/);
assert.ok(helperMatch, 'requireAdminPermission source not found');

function routeBlock(method, routePath) {
  const marker = server.indexOf('"' + routePath + '"');
  assert.notEqual(marker, -1, routePath + ' route marker exists');
  const start = server.lastIndexOf('app.' + method + '(', marker);
  const end = server.indexOf('\napp.', marker);
  assert.ok(start >= 0 && end > start, routePath + ' route block exists');
  return server.slice(start, end);
}

const routeSource = [
  routeBlock('post', '/api/admin/backup'),
  routeBlock('post', '/api/admin/restore'),
  routeBlock('delete', '/api/admin/knowledge/:id'),
  routeBlock('post', '/api/admin/knowledge/:id/edit')
].join('\n');

let backupCalls = 0;
let restoreCalls = 0;
let deleteCalls = 0;
let learningUpdateCalls = 0;
let knowledgeUpdateCalls = 0;
let currentType = 'learning';
const routes = {};
const context = {
  module: { exports: {} },
  ROLES: { ADMIN: 'admin' },
  PERMISSIONS: {
    BACKUP_RESTORE: 'BACKUP_RESTORE',
    SYSTEM_ADMIN: 'SYSTEM_ADMIN'
  },
  sessionIdentity: req => req.testSession || null,
  authenticate: (req, res, next) => next(),
  getPermissions: role => role === 'admin' ? ['BACKUP_RESTORE', 'SYSTEM_ADMIN'] : [],
  getKnowledge: () => [{
    id: 'kb-1',
    type: currentType,
    title: 'Existing',
    topic: 'fixture-topic',
    content: 'existing fixture content'
  }],
  deleteKnowledge: async id => {
    deleteCalls++;
    assert.equal(id, 'kb-1');
    return { deleted: true };
  },
  updateLearning: async (id, learning) => {
    learningUpdateCalls++;
    assert.equal(id, 'kb-1');
    return { status: 'updated', entry: { ...learning } };
  },
  updateKnowledge: async (id, input) => {
    knowledgeUpdateCalls++;
    assert.equal(id, 'kb-1');
    return { status: 'updated', entry: { ...input } };
  },
  recordAudit: () => {},
  app: {
    post(route, ...handlers) {
      routes[route] = handlers;
    },
    delete(route, ...handlers) {
      routes[route] = handlers;
    }
  },
  require(modulePath) {
    if (modulePath === './tools/knowledge-backup') {
      return { execute: async () => {
        backupCalls++;
        return JSON.stringify({ success: true, action: 'backup' });
      } };
    }
    if (modulePath === './tools/knowledge-restore') {
      return { execute: async args => {
        restoreCalls++;
        assert.equal(args.confirm, true);
        return JSON.stringify({ success: true, restored: true });
      } };
    }
    throw new Error('Unexpected module request: ' + modulePath);
  }
};

vm.runInNewContext(helperMatch[0] + '\n' + routeSource, context, {
  filename: 'isolated-server-admin-write-routes.js'
});

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
}

async function invoke(routePath, req) {
  const handlers = routes[routePath];
  assert.ok(Array.isArray(handlers) && handlers.length === 2, routePath + ' handlers registered');
  const res = response();
  let nextCalled = false;
  handlers[0](req, res, () => { nextCalled = true; });
  if (nextCalled) await handlers[1](req, res, () => {});
  return res;
}

(async () => {
  const deniedBackup = await invoke('/api/admin/backup', {
    testSession: { role: 'admin', permissions: [] }
  });
  assert.equal(deniedBackup.statusCode, 403);
  assert.equal(backupCalls, 0);

  const backup = await invoke('/api/admin/backup', {
    testSession: { role: 'admin', permissions: ['BACKUP_RESTORE'] }
  });
  assert.equal(backup.payload.success, true);
  assert.equal(backupCalls, 1);
  console.log('MIRA_HFM_ADMIN_BACKUP_PERMISSION_RUNTIME=PASS');

  const noConfirm = await invoke('/api/admin/restore', {
    testSession: { role: 'admin', permissions: ['BACKUP_RESTORE'] },
    body: {}
  });
  assert.equal(noConfirm.statusCode, 400);
  assert.equal(noConfirm.payload.dataModified, false);
  assert.equal(restoreCalls, 0);

  const restore = await invoke('/api/admin/restore', {
    testSession: { role: 'admin', permissions: ['BACKUP_RESTORE'] },
    body: { confirm: true }
  });
  assert.equal(restore.payload.success, true);
  assert.equal(restoreCalls, 1);
  console.log('MIRA_HFM_ADMIN_RESTORE_CONFIRMATION_RUNTIME=PASS');

  const deniedDelete = await invoke('/api/admin/knowledge/:id', {
    testSession: { role: 'admin', permissions: [] },
    params: { id: 'kb-1' }
  });
  assert.equal(deniedDelete.statusCode, 403);
  assert.equal(deleteCalls, 0);

  const deleted = await invoke('/api/admin/knowledge/:id', {
    testSession: { role: 'admin', permissions: ['SYSTEM_ADMIN'] },
    params: { id: 'kb-1' }
  });
  assert.equal(deleted.payload.status, 'deleted');
  assert.equal(deleteCalls, 1);

  const deniedEdit = await invoke('/api/admin/knowledge/:id/edit', {
    testSession: { role: 'admin', permissions: [] },
    params: { id: 'kb-1' },
    body: { title: 'Changed' }
  });
  assert.equal(deniedEdit.statusCode, 403);
  assert.equal(learningUpdateCalls, 0);
  assert.equal(knowledgeUpdateCalls, 0);

  currentType = 'learning';
  const learningEdit = await invoke('/api/admin/knowledge/:id/edit', {
    testSession: { role: 'admin', permissions: ['SYSTEM_ADMIN'] },
    params: { id: 'kb-1' },
    body: { title: 'Changed learning', content: 'changed fixture' }
  });
  assert.equal(learningEdit.payload.status, 'updated');
  assert.equal(learningUpdateCalls, 1);

  currentType = 'knowledge';
  const knowledgeEdit = await invoke('/api/admin/knowledge/:id/edit', {
    testSession: { role: 'admin', permissions: ['SYSTEM_ADMIN'] },
    params: { id: 'kb-1' },
    body: { title: 'Changed knowledge', content: 'changed fixture' }
  });
  assert.equal(knowledgeEdit.payload.status, 'updated');
  assert.equal(knowledgeUpdateCalls, 1);
  console.log('MIRA_HFM_ADMIN_KNOWLEDGE_EDIT_DELETE_PERMISSION_RUNTIME=PASS');
  console.log('MIRA_HFM_UNAUTHORIZED_ADMIN_WRITE_CALLS=0');
  console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('EXTERNAL_ACTIONS=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
