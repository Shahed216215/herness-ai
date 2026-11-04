'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const toolSource = fs.readFileSync(path.join(root, 'tools/memory-version-recovery.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(root, 'services/mira-work-execution-engine.js'), 'utf8');
const policySource = fs.readFileSync(path.join(root, 'services/mira-tool-execution-policy.js'), 'utf8');
assert.match(engineSource, /require\(["']\.\/mira-tool-execution-policy["']\)/);

assert.match(toolSource, /name:\s*['"]memory_version_recovery['"]/);
assert.match(toolSource, /declaration:\s*\{/);
assert.match(toolSource, /execute:\s*async/);

const policyStart = policySource.indexOf('  memory_version_recovery: {');
assert.notEqual(policyStart, -1, 'memory_version_recovery must have an explicit engine policy');
const policyEnd = policySource.indexOf('\n  },', policyStart);
assert.notEqual(policyEnd, -1, 'memory_version_recovery policy block must be complete');
const policy = policySource.slice(policyStart, policyEnd);
assert.match(policy, /operation:\s*"file_modify"/);
assert.match(policy, /autonomous:\s*false/);
assert.match(policy, /humanApprovalRequired:\s*true/);
assert.match(policy, /explicitConfirmation:\s*true/);

assert.match(engineSource, /if\s*\(!policy\)\s*\{/);
assert.match(engineSource, /status:\s*"unknown_tool"/);

console.log('MIRA_HFM_MEMORY_VERSION_RECOVERY_WRAPPER=PASS');
console.log('MIRA_HFM_MEMORY_VERSION_RECOVERY_EXPLICIT_POLICY=PASS');
console.log('MIRA_HFM_MEMORY_VERSION_RECOVERY_AUTONOMOUS=DENIED');
console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
console.log('NETWORK_REQUESTS=0');
console.log('EXTERNAL_ACTIONS=0');
console.log('TESTS_FAILED=0');
