'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const routesDir = path.join(root, 'routes');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const taskExecutionRoute = fs.readFileSync(path.join(routesDir, 'task-execution.js'), 'utf8');

const routeFiles = fs.readdirSync(routesDir).filter(file => file.endsWith('.js')).sort();
const directRouteCalls = [];
for (const file of routeFiles) {
  const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/\b(?:runTool|executeTool)\s*\(|\.execute\s*\(/.test(line)) {
      directRouteCalls.push(file + ':' + (index + 1) + ':' + line.trim());
    }
  });
}
assert.deepEqual(directRouteCalls, [], 'route modules must not directly execute tool wrappers');
assert.match(taskExecutionRoute, /executeWork\s*\(/, 'admin task execution route must use the governed work engine');

function routeBlock(source, routePath) {
  const marker = source.indexOf('"' + routePath + '"');
  assert.notEqual(marker, -1, routePath + ' route exists');
  const start = source.lastIndexOf('app.post(', marker);
  assert.notEqual(start, -1, routePath + ' route registration exists');
  const next = source.indexOf('\napp.post(', marker);
  return source.slice(start, next === -1 ? source.length : next);
}

const backup = routeBlock(server, '/api/admin/backup');
assert.match(backup, /requireAdminPermission\s*\(\s*PERMISSIONS\.BACKUP_RESTORE\s*\)/);
assert.match(backup, /await\s+backupTool\.execute\s*\(/);

const restore = routeBlock(server, '/api/admin/restore');
assert.match(restore, /requireAdminPermission\s*\(\s*PERMISSIONS\.BACKUP_RESTORE\s*\)/);
assert.match(restore, /confirm\s*!==\s*true/);
assert.match(restore, /await\s+restoreTool\.execute\s*\(/);

assert.match(server, /const requiresNamedAdminSession\s*=\s*\[/);
assert.match(server, /"seo_workflow_history"/);
assert.match(server, /req\.session\.authenticated\s*===\s*true/);
assert.match(server, /toolResult\s*=\s*await\s+historyTool\.execute\s*\(/);
assert.match(server, /executeSeoWorkflowReviewDecision\s*\(/);
assert.match(server, /await\s+executeWork\s*\(/);

for (const wrapper of ['memory-save', 'knowledge-save', 'learning-save']) {
  assert.equal(
    server.includes('require("./tools/' + wrapper + '")') ||
      server.includes("require('./tools/" + wrapper + "')"),
    false,
    server + ' must not directly import persistent save wrapper ' + wrapper
  );
}

console.log('MIRA_HFM_ROUTE_DIRECT_TOOL_CALLS=0');
console.log('MIRA_HFM_ADMIN_BACKUP_PERMISSION_GATE=PASS');
console.log('MIRA_HFM_ADMIN_RESTORE_PERMISSION_AND_CONFIRMATION=PASS');
console.log('MIRA_HFM_SEO_HISTORY_NAMED_ADMIN_GATE=PASS');
console.log('MIRA_HFM_SEO_REVIEW_DEDICATED_DISPATCH=PASS');
console.log('MIRA_HFM_TASK_EXECUTION_USES_GOVERNED_ENGINE=PASS');
console.log('MIRA_HFM_PERSISTENT_SAVE_WRAPPER_DIRECT_SERVER_IMPORTS=0');
console.log('MIRA_HFM_DIRECT_DISPATCH_BOUNDARY_TESTS_FAILED=0');
