'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const sourcePath = path.resolve('scripts/mira-control-agent.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractSafeTask(src) {
  const start = src.indexOf('function safeTask(body) {');
  assert.notEqual(start, -1, 'safeTask function must exist');
  const next = src.indexOf('\nfunction issueComments(', start);
  assert.notEqual(next, -1, 'safeTask boundary must exist');

  const fnSource = src.slice(start, next);
  return new Function(
    'TASK_PREFIX',
    `${fnSource}\nreturn safeTask;`
  )('MIRA_CONTROL_TASK_V1\n');
}

const safeTask = extractSafeTask(source);
const prefix = 'MIRA_CONTROL_TASK_V1\n';

const validStatus = prefix + JSON.stringify({
  task_id: 'mock_task_01',
  action: 'status'
});
const validInventory = prefix + JSON.stringify({
  task_id: 'mock-task-02',
  action: 'inventory'
});

const cases = [
  ['valid status accepted', () => assert.equal(safeTask(validStatus).action, 'status')],
  ['valid inventory accepted', () => assert.equal(safeTask(validInventory).action, 'inventory')],
  ['wrong prefix rejected', () => assert.equal(safeTask('WRONG\n' + JSON.stringify({task_id:'x',action:'status'})), null)],
  ['non-string rejected', () => assert.equal(safeTask(null), null)],
  ['malformed JSON rejected', () => assert.equal(safeTask(prefix + '{broken'), null)],
  ['array payload rejected', () => assert.equal(safeTask(prefix + '[]'), null)],
  ['missing task ID rejected', () => assert.equal(safeTask(prefix + '{"action":"status"}'), null)],
  ['invalid task ID rejected', () => assert.equal(safeTask(prefix + '{"task_id":"bad id","action":"status"}'), null)],
  ['overlong task ID rejected', () => assert.equal(safeTask(prefix + JSON.stringify({task_id:'x'.repeat(81),action:'status'})), null)],
  ['unknown action rejected', () => assert.equal(safeTask(prefix + '{"task_id":"x","action":"shell"}'), null)],
  ['unknown command field rejected', () => {
    assert.equal(safeTask(prefix + JSON.stringify({task_id:'x',action:'status',command:'touch SHOULD_NOT_EXIST'})), null);
  }],
  ['unknown metadata field rejected', () => {
    assert.equal(safeTask(prefix + JSON.stringify({task_id:'x',action:'status',metadata:{source:'untrusted'}})), null);
  }]
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

console.log(`MOCK_CASES=${cases.length}`);
console.log(`MOCK_FAILED=${failed}`);
console.log('NETWORK_REQUESTS=0');
console.log('GITHUB_CALLS=0');
console.log('BRIDGE_EXECUTED=NO');
console.log('REMOTE_SUBMITTER_AUTHORIZATION=NOT_TESTED');
console.log('COMMENT_DISCLOSURE=NOT_TESTED');

if (failed) process.exitCode = 1;
