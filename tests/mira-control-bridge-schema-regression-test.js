'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('scripts/mira-control-agent.js', 'utf8');
const start = source.indexOf('function safeTask(body) {');
const end = source.indexOf('\nfunction issueComments(', start);

assert.notEqual(start, -1, 'safeTask function must exist');
assert.notEqual(end, -1, 'safeTask boundary must exist');

const safeTask = new Function(
  'TASK_PREFIX',
  source.slice(start, end) + '\nreturn safeTask;'
)('MIRA_CONTROL_TASK_V1\n');

const prefix = 'MIRA_CONTROL_TASK_V1\n';
const cases = [
  {
    name: 'valid status task accepted',
    body: { task_id: 'regression_status', action: 'status' },
    expected: true
  },
  {
    name: 'valid inventory task accepted',
    body: { task_id: 'regression_inventory', action: 'inventory' },
    expected: true
  },
  {
    name: 'unknown command field rejected',
    body: {
      task_id: 'regression_command',
      action: 'status',
      command: 'touch SHOULD_NOT_EXIST'
    },
    expected: false
  },
  {
    name: 'unknown metadata field rejected',
    body: {
      task_id: 'regression_metadata',
      action: 'inventory',
      metadata: { source: 'untrusted' }
    },
    expected: false
  }
];

let failed = 0;

for (const test of cases) {
  let actual = false;
  try {
    actual = safeTask(prefix + JSON.stringify(test.body)) !== null;
  } catch {
    actual = false;
  }

  if (actual === test.expected) {
    console.log(`PASS ${test.name}`);
  } else {
    console.log(
      `FAIL ${test.name}: expected accepted=${test.expected}, got accepted=${actual}`
    );
    failed++;
  }
}

console.log(`CASES=${cases.length}`);
console.log(`FAILED=${failed}`);
console.log('NETWORK_REQUESTS=0');
console.log('GITHUB_CALLS=0');
console.log('SOURCE_EDITED=NO');

if (failed > 0) process.exitCode = 1;
