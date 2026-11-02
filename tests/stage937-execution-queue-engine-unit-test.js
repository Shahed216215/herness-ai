'use strict';

const assert = require('assert');

const {
  buildExecutionQueue,
  rebuildExecutionQueue,
  getQueueSummary
} = require('../services/mira-execution-queue-engine');

const {
  validateExecutionQueue,
  validateExecutionQueueItem
} = require('../execution-queue-schema');

const records = [
  {
    taskId: 'task-low',
    projectId: 'project-1',
    priorityScore: 0.20,
    priority: 'low',
    urgencyScore: 0,
    effortScore: 0.25,
    dependencyScore: 1,
    riskScore: 0,
    deadline: '',
    difficulty: 'easy',
    risk: 'low',
    dependencies: [],
    dependencyBlocked: false,
    sequence: 3
  },
  {
    taskId: 'task-critical',
    projectId: 'project-1',
    priorityScore: 0.90,
    priority: 'critical',
    urgencyScore: 1,
    effortScore: 0.75,
    dependencyScore: 1,
    riskScore: 0.5,
    deadline: '2026-10-09T00:00:00Z',
    difficulty: 'hard',
    risk: 'medium',
    dependencies: [],
    dependencyBlocked: false,
    sequence: 2
  },
  {
    taskId: 'task-blocked',
    projectId: 'project-1',
    priorityScore: 1.00,
    priority: 'critical',
    urgencyScore: 1,
    effortScore: 1,
    dependencyScore: 0,
    riskScore: 1,
    deadline: '2026-10-08T00:00:00Z',
    difficulty: 'expert',
    risk: 'critical',
    dependencies: ['missing-task'],
    dependencyBlocked: true,
    sequence: 1
  }
];

const queue = buildExecutionQueue(records);

assert.strictEqual(queue.length, 3);

assert.strictEqual(queue[0].taskId, 'task-critical');
assert.strictEqual(queue[1].taskId, 'task-low');
assert.strictEqual(queue[2].taskId, 'task-blocked');

assert.deepStrictEqual(
  queue.map(item => item.queuePosition),
  [1, 2, 3]
);

assert.strictEqual(
  validateExecutionQueue(queue),
  true
);

for (const item of queue) {
  assert.strictEqual(
    validateExecutionQueueItem(item),
    true
  );

  assert.strictEqual(
    item.executionAllowed,
    false
  );

  assert.strictEqual(
    item.planningOnly,
    true
  );

  assert.strictEqual(
    item.externalActionPerformed,
    false
  );

  assert.strictEqual(
    item.paymentAllowed,
    false
  );

  assert.strictEqual(
    item.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    item.contractSigningAllowed,
    false
  );
}

const duplicateQueue =
  buildExecutionQueue([
    records[0],
    records[0],
    records[1]
  ]);

assert.strictEqual(
  duplicateQueue.length,
  2
);

const rebuilt =
  rebuildExecutionQueue(records);

assert.deepStrictEqual(
  rebuilt.map(item => item.taskId),
  queue.map(item => item.taskId)
);

const summary =
  getQueueSummary(queue);

assert.strictEqual(summary.total, 3);
assert.strictEqual(summary.queued, 2);
assert.strictEqual(summary.blocked, 1);
assert.strictEqual(summary.planningOnly, true);
assert.strictEqual(summary.executionAllowed, false);

assert.strictEqual(
  validateExecutionQueue([]),
  true
);

console.log(
  'STAGE937_EXECUTION_QUEUE_ENGINE_UNIT_TEST: PASS'
);
