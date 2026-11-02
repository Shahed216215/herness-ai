'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const orchestrator = require('../services/engineering/bug-hunter-orchestrator');
const source = fs.readFileSync('server.js', 'utf8');

assert.equal(orchestrator.safeRelativePath('services/example.js'), true);
for (const unsafe of [
  '../outside.js', '/etc/passwd', 'a/../b.js', 'node_modules/pkg.js',
  '.env', 'secrets/token.txt', 'private.key', 'folder\\file.js'
]) {
  assert.equal(orchestrator.safeRelativePath(unsafe), false, unsafe);
}

const plan = orchestrator.createRepairPlan({
  file: 'services/example.js',
  title: 'Regression test finding',
  id: 'dashboard-preview',
  testPaths: []
});
assert.equal(plan.status, 'PROPOSAL_ONLY');
assert.equal(plan.mode, 'PREVIEW_ONLY');
assert.equal(plan.mayApply, false);
assert.equal(plan.approvalRequired, true);
assert.equal(plan.evidence.file, 'services/example.js');

const routeStart = source.indexOf('app.post("/api/admin/bug-hunter/preview"');
const routeEnd = source.indexOf('\n});', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'preview route exists');
const route = source.slice(routeStart, routeEnd);
assert.match(route, /requireAdminPermission\(PERMISSIONS\.SYSTEM_ADMIN\)/);
assert.match(route, /safePath !== true/);
assert.match(route, /file: body\.path/);
assert.match(route, /mayApply:\s*false/);
assert.match(route, /approvalRequired:\s*true/);
assert.match(route, /proposedChangePreview:/);
console.log('BUG_HUNTER_PREVIEW_CONTRACT_TEST=PASS');
console.log('ASSERTIONS=24');
