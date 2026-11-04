'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'services/mira-work-execution-engine.js'), 'utf8');
const expected = ['memory_save', 'knowledge_save', 'learning_save'];

for (const name of expected) {
  const start = engine.indexOf(`  ${name}: {`);
  assert.notEqual(start, -1, `${name} must have an explicit engine policy`);
  const end = engine.indexOf('\\n  },', start);
  assert.notEqual(end, -1, `${name} policy block must be complete`);
  const policy = engine.slice(start, end);
  assert.match(policy, /operation:\\s*"file_modify"/);
  assert.match(policy, /autonomous:\\s*false/);
  assert.match(policy, /humanApprovalRequired:\\s*true/);
  assert.match(policy, /explicitConfirmation:\\s*true/);
  console.log(`MIRA_HFM_${name.toUpperCase()}_HUMAN_ONLY=PASS`);
}

assert.match(
  engine,
  /if\\s*\\(policy\\.humanApprovalRequired\\)\\s*\\{[\\s\\S]*?passed:\\s*false[\\s\\S]*?explicit human approval/i,
  'humanApprovalRequired must fail the autonomous tool-safety gate'
);
assert.match(
  engine,
  /if\\s*\\(!policy\\.autonomous\\)\\s*\\{[\\s\\S]*?passed:\\s*false/,
  'autonomous=false must fail the autonomous tool-safety gate'
);

console.log('MIRA_HFM_PERSISTENT_WRITE_AUTONOMOUS_EXECUTION=DENIED');
console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
console.log('NETWORK_REQUESTS=0');
console.log('EXTERNAL_ACTIONS=0');
console.log('TESTS_FAILED=0');
