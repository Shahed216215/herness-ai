'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const helperMatch = server.match(/function requireAdminPermission\(permission\) \{[\s\S]*?\n\}\n(?=\nfunction buildMemoryStats)/);
assert.ok(helperMatch, 'requireAdminPermission source not found');

const backupMarker = server.indexOf('"/api/admin/backup"');
const restoreMarker = server.indexOf('"/api/admin/restore"');
assert.notEqual(backupMarker, -1);
assert.notEqual(restoreMarker, -1);
const backupStart = server.lastIndexOf('app.post(', backupMarker);
const backupEnd = server.indexOf('\napp.post(', backupMarker);
const restoreStart = server.lastIndexOf('app.post(', restoreMarker);
const restoreEnd = server.indexOf('\napp.post(', restoreMarker);
assert.ok(backupStart >= 0 && backupEnd > backupStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
const routeSource = server.slice(backupStart, backupEnd) + '\n' + server.slice(restoreStart, restoreEnd);

let backupCalls = 0;
let restoreCalls = 0;
const routes = {};
const context = {
  module: { exports: {} },
  ROLES: { ADMIN: 'admin' },
  PERMISSIONS: { BACKUP_RESTORE: 'BACKUP_RESTORE' },
  sessionIdentity: req => req.testSession || null,
  authenticate: (req, res, next) => next(),
  getPermissions: role => role === 'admin' ? ['BACKUP_RESTORE'] : [],
  app: {
    post(route, ...handlers) {
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
  filename: 'isolated-server-admin-backup-restore.js'
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
  const denied = await invoke('/api/admin/backup', {
    testSession: { role: 'admin', permissions: [] }
  });
  assert.equal(denied.statusCode, 403);
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
  console.log('MIRA_HFM_UNAUTHORIZED_ADMIN_WRITE_CALLS=0');
  console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('EXTERNAL_ACTIONS=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
