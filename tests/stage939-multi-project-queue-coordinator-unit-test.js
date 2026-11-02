'use strict';

const assert = require('assert');

const {
  compareGlobalQueueItems,
  buildMultiProjectQueue,
  coordinateProjectQueues
} = require('../services/mira-multi-project-queue-coordinator');

const {
  validateCoordinatorItem
} = require('../multi-project-queue-coordinator-schema');

function item(overrides = {}) {
  return {
    taskId: 'task-default',
    projectId: 'project-default',
    planId: '',
    queuePosition: 1,
    priorityScore: 0.2,
    priority: 'low',
    urgencyScore: 0,
    effortScore: 0,
    dependencyScore: 1,
    riskScore: 0,
    deadline: '',
    difficulty: 'unknown',
    risk: 'low',
    dependencies: [],
    dependencyBlocked: false,
    sequence: 1,
    status: 'queued',
    ...overrides
  };
}

const blocked = item({
  taskId: 'blocked',
  projectId: 'project-a',
  priorityScore: 0.99,
  dependencyBlocked: true
});

const ready = item({
  taskId: 'ready',
  projectId: 'project-b',
  priorityScore: 0.10,
  dependencyBlocked: false
});

assert(
  compareGlobalQueueItems(blocked, ready) > 0,
  'blocked item must rank after non-blocked item'
);

const high = item({
  taskId: 'high',
  projectId: 'project-a',
  priorityScore: 0.90
});

const low = item({
  taskId: 'low',
  projectId: 'project-b',
  priorityScore: 0.20
});

assert(
  compareGlobalQueueItems(high, low) < 0,
  'higher priority must rank first'
);

const duplicate = item({
  taskId: 'high',
  projectId: 'project-c',
  priorityScore: 0.80
});

const queue = buildMultiProjectQueue([
  {
    ok: true,
    queue: [high, low]
  },
  {
    ok: true,
    queue: [duplicate]
  }
]);

assert.strictEqual(queue.length, 2);
assert.strictEqual(queue[0].taskId, 'high');
assert.strictEqual(queue[0].globalQueuePosition, 1);
assert.strictEqual(queue[1].globalQueuePosition, 2);

for (const record of queue) {
  assert(
    validateCoordinatorItem(record),
    `invalid coordinator item: ${record.taskId}`
  );
}

const empty = coordinateProjectQueues([
  {
    ok: true,
    queue: []
  }
]);

assert.strictEqual(empty.status, 'empty');
assert.strictEqual(empty.totalItems, 0);
assert.strictEqual(empty.planningOnly, true);
assert.strictEqual(empty.executionAllowed, false);

const blockedResult = coordinateProjectQueues([
  {
    ok: true,
    queue: [
      blocked
    ]
  }
]);

assert.strictEqual(blockedResult.status, 'blocked');

console.log(
  'STAGE939_MULTI_PROJECT_QUEUE_COORDINATOR_UNIT_TEST: PASS'
);
