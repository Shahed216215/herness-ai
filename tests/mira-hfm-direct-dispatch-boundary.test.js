'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const seoDispatch = fs.readFileSync(path.join(root, 'services', 'mira-seo-review-dispatch.js'), 'utf8');
const verification = fs.readFileSync(path.join(root, 'services', 'mira-verification-engine.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'services', 'mira-tool-execution-policy.js'), 'utf8');

function section(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, label + ' start marker');
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, label + ' end marker');
  return source.slice(start, end);
}

// Direct administrative backup dispatch is protected by an authenticated
// admin role plus the explicit BACKUP_RESTORE permission.
const adminGuard = section(
  server,
  'function requireAdminPermission(permission) {',
  '\nfunction buildMemoryStats()',
  'admin permission middleware'
);
assert.match(adminGuard, /sessionIdentity\(req\)/);
assert.match(adminGuard, /req\.role\s*!==\s*ROLES\.ADMIN/);
assert.match(adminGuard, /req\.permissions\.includes\(\s*permission\s*\)/);
assert.match(adminGuard, /return authenticate\(/);
const backupRoute = section(
  server,
  'app.post(\n  "/api/admin/backup"',
  '\n/*\n * ADMIN RESTORE',
  'admin backup route'
);
assert.match(backupRoute, /requireAdminPermission\(\s*PERMISSIONS\.BACKUP_RESTORE\s*\)/);
assert.match(backupRoute, /await backupTool\.execute\(\)/);

// Restore additionally requires an explicit true confirmation before
// loading and invoking the restore wrapper.
const restoreRoute = section(
  server,
  'app.post(\n  "/api/admin/restore"',
  '\n/*\n * ADMIN LEARNING',
  'admin restore route'
);
assert.match(restoreRoute, /requireAdminPermission\(\s*PERMISSIONS\.BACKUP_RESTORE\s*\)/);
const confirmCheck = restoreRoute.indexOf('if (confirm !== true)');
const restoreInvoke = restoreRoute.indexOf('await restoreTool.execute');
assert.ok(confirmCheck >= 0 && restoreInvoke > confirmCheck,
  'restore confirmation must precede restore execution');

// SEO review decision is a distinct named-admin-session dispatch, not a
// generic model-generated tool call.
assert.match(seoDispatch, /requestRole === "admin"/);
assert.match(seoDispatch, /session\.authenticated === true/);
assert.match(seoDispatch, /session\.role === "admin"/);
assert.match(seoDispatch, /session\.username\.trim\(\)\.length > 0/);
assert.match(seoDispatch, /if \(!authorized\)/);
assert.match(seoDispatch, /await tool\.execute\(toolArguments/);

// The server's SEO history direct read is behind the named-admin-session
// authorization decision in the surrounding dispatch branch.
const historyDispatch = section(
  server,
  '} else if (toolName === "seo_workflow_history") {',
  '\n          } else {',
  'SEO history dispatch'
);
assert.match(historyDispatch, /historyTool\.execute/);
assert.match(server, /if \(!marketingContextAuthorized\)/);
assert.ok(server.indexOf('if (!marketingContextAuthorized)') <
  server.indexOf('} else if (toolName === "seo_workflow_history")'),
  'named-admin gate must precede SEO history dispatch');

// Verification engine directly invokes only the registered tool-health
// inspection; the shared policy keeps that operation read-only/inspect.
assert.match(verification, /const health\s*=\s*require\(healthPath\)/);
assert.match(verification, /await health\.execute\(\)/);
const healthPolicy = section(policy, '  tool_health: {', '\n  },', 'tool_health policy');
assert.match(healthPolicy, /operation: "inspect"/);
assert.match(healthPolicy, /autonomous: true/);
assert.match(healthPolicy, /humanApprovalRequired: false/);

function collectRuntimeFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRuntimeFiles(fullPath);
    return /\.(?:js|cjs|mjs)$/.test(entry.name) ? [fullPath] : [];
  });
}

const runtimeFiles = [
  path.join(root, 'server.js'),
  ...collectRuntimeFiles(path.join(root, 'routes')),
  ...collectRuntimeFiles(path.join(root, 'services'))
];
const observedDirectCalls = [];
const directCallPattern = /\b((?:tool|health|[A-Za-z_$][\w$]*(?:Tool|tool)))\.execute\s*\(|\btools\s*\[[^\]]+\]\s*\.execute\s*\(/g;

for (const file of runtimeFiles) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');
  for (const [index, line] of source.split('\n').entries()) {
    directCallPattern.lastIndex = 0;
    let match;
    while ((match = directCallPattern.exec(line)) !== null) {
      const target = match[1] ? match[1] + '.execute' : 'tools[...].execute';
      observedDirectCalls.push(relative + ':' + target);
    }
  }
}

const expectedDirectCalls = [
  'server.js:backupTool.execute',
  'server.js:historyTool.execute',
  'server.js:restoreTool.execute',
  'services/mira-seo-review-dispatch.js:tool.execute',
  'services/mira-verification-engine.js:health.execute'
].sort();
assert.deepEqual(
  observedDirectCalls.sort(),
  expectedDirectCalls,
  'new or removed direct tool invocation requires security review and allowlist update'
);

console.log('MIRA_HFM_ADMIN_BACKUP_PERMISSION_GATE=PASS');
console.log('MIRA_HFM_ADMIN_RESTORE_CONFIRMATION_ORDER=PASS');
console.log('MIRA_HFM_SEO_REVIEW_NAMED_ADMIN_GATE=PASS');
console.log('MIRA_HFM_SEO_HISTORY_NAMED_ADMIN_GATE=PASS');
console.log('MIRA_HFM_HEALTH_DIRECT_CALL_READ_ONLY_POLICY=PASS');
console.log('MIRA_HFM_REVIEWED_DIRECT_DISPATCH_BOUNDARIES=PASS');
console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
console.log('NETWORK_REQUESTS=0');
console.log('EXTERNAL_ACTIONS=0');
console.log('TESTS_FAILED=0');
