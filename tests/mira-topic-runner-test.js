'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-topic-runner-'));
process.env.MIRA_TOPIC_RUNNER_HOME = temp;

const runner = require('../scripts/mira-topic-runner');

try {
  runner.createTopic('topic1', 'Read-only trial');
  assert.throws(
    () => runner.createTopic('topic1', 'Duplicate'),
    /TOPIC_DUPLICATE/
  );

  runner.createTask('topic1', 'task1', 'inspect', 'scripts/');
  assert.throws(
    () => runner.createTask('topic1', 'task2', 'shell', '*'),
    /ACTION_NOT_ALLOWED/
  );
  assert.throws(
    () => runner.approveTask('task1', false),
    /APPROVAL_REQUIRED/
  );

  const approved = runner.approveTask('task1', true);
  assert.equal(approved.status, 'APPROVED_FOR_REVIEW_ONLY');
  assert.equal(approved.execution, 'NOT_IMPLEMENTED');

  const report = runner.reportTask('task1');
  assert.equal(report.reportStatus, 'INCONCLUSIVE');
  assert.match(report.evidenceSha256, /^[a-f0-9]{64}$/);

  assert.throws(
    () => runner.approveTask('task1', true),
    /TASK_NOT_PENDING/
  );

  const stateFile = path.join(temp, 'state.json');
  assert.ok(fs.existsSync(stateFile));
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);

  // Gate 1: corrupted and inconsistent persisted state must fail closed.
  fs.writeFileSync(stateFile, '{broken-json', { mode: 0o600 });
  assert.throws(() => runner.readState(), /STATE_CORRUPT/);

  fs.writeFileSync(stateFile, JSON.stringify({
    version: 1, topics: [], tasks: {}
  }), { mode: 0o600 });
  assert.throws(() => runner.readState(), /STATE_INVALID/);

  fs.writeFileSync(stateFile, JSON.stringify({
    version: 1, topics: {},
    tasks: { orphan: {
      id: 'orphan', topicId: 'missing', action: 'inspect',
      scope: 'scripts/', status: 'PENDING_APPROVAL'
    } }
  }), { mode: 0o600 });
  assert.throws(() => runner.readState(), /STATE_INVALID/);

  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, topics: {}, tasks: {} }, null, 2) + '\n', { mode: 0o600 });

  console.log('TESTS=PASS');
  console.log('CASES=topic-create,duplicate-topic,action-allowlist,approval-required,explicit-approval,execution-disabled,evidence-hash,duplicate-approval,private-state-file');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
