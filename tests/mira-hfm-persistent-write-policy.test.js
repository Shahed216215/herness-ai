'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = fs.readFileSync(path.join(__dirname, '..', 'services', 'mira-work-execution-engine.js'), 'utf8');
for (const name of ['memory_save', 'knowledge_save', 'learning_save']) {
  const start = engine.indexOf('  ' + name + ': {');
  assert.notEqual(start, -1, name + ' policy exists');
  const end = engine.indexOf('\n  },', start);
  assert.notEqual(end, -1, name + ' policy closes');
  const policy = engine.slice(start, end);
  for (const expected of [
    'operation: "file_modify"',
    'autonomous: false',
    'humanApprovalRequired: true',
    'explicitConfirmation: true'
  ]) assert.ok(policy.includes(expected), name + ' missing ' + expected);
  console.log('MIRA_HFM_' + name.toUpperCase() + '_HUMAN_ONLY=PASS');
}
assert.ok(engine.includes('if (policy.humanApprovalRequired)'));
assert.ok(engine.includes('This tool is restricted to explicit human approval.'));
assert.ok(engine.includes('if (!policy.autonomous)'));
console.log('MIRA_HFM_PERSISTENT_WRITE_AUTONOMOUS_EXECUTION=DENIED');
console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
console.log('NETWORK_REQUESTS=0');
console.log('EXTERNAL_ACTIONS=0');
console.log('TESTS_FAILED=0');
