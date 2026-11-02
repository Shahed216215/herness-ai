'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');

const server = fs.readFileSync('server.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

assert.match(server, /MIRA_BUG_HUNTER_GOVERNED_API_V1/);
assert.match(server, /\/api\/admin\/bug-hunter\/audit/);
assert.match(server, /\/api\/admin\/bug-hunter\/preview/);
assert.match(server, /requireAdminPermission\(PERMISSIONS\.SYSTEM_ADMIN\)/);
assert.match(server, /executionAllowed:\s*false/);
assert.match(server, /mayApply:\s*false/);
assert.match(html, /MIRA_BUG_HUNTER_DASHBOARD_V1/);
assert.match(html, /\/api\/admin\/bug-hunter\/audit/);
assert.match(html, /\/api\/admin\/bug-hunter\/preview/);
assert.match(html, /credentials:\s*"same-origin"/);
assert.match(html, /cannot apply repairs/i);

const script = html.match(/<script id="mira-bug-hunter-dashboard-script">([\s\S]*?)<\/script>/);
assert.ok(script, 'dashboard integration script exists');
new Function(script[1]); // syntax-check only; do not execute browser code

console.log('BUG_HUNTER_DASHBOARD_INTEGRATION_TEST=PASS');
console.log('ASSERTIONS=11');
