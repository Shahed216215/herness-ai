'use strict';

const assert = require('assert');

const {
  evaluateQueueItemReadiness,
  evaluateQueueLifecycle,
  transitionQueueItemStatus
} = require('../services/mira-queue-lifecycle-engine');

const {
  canTransition,
  validateQueueLifecycleRecord
} = require('../queue-lifecycle-schema');

const NOW = new Date('2026-10-08T12:00:00Z');

const readyItem = {
  taskId: 'task-ready',
  projectId: 'project-1',
  planId: 'plan-1',
  status: 'queued',
  dependencyBlocked: false,
  dependencies: []
};

const blockedItem = {
  taskId: 'task-blocked',
  projectId: 'project-1',
  planId: 'plan-1',
  status: 'queued',
  dependencyBlocked: true,
  dependencies: ['task-dependency']
};

const readyRecord =
  evaluateQueueItemReadiness(
    readyItem,
    NOW
  );

assert.strictEqual(
  readyRecord.status,
  'ready'
);

assert.strictEqual(
  readyRecord.executionAllowed,
  false
);

assert.strictEqual(
  readyRecord.planningOnly,
  true
);

assert.strictEqual(
  validateQueueLifecycleRecord(readyRecord),
  true
);

const blockedRecord =
  evaluateQueueItemReadiness(
    blockedItem,
    NOW
  );

assert.strictEqual(
  blockedRecord.status,
  'blocked'
);

assert.strictEqual(
  blockedRecord.dependencyBlocked,
  true
);

assert.strictEqual(
  validateQueueLifecycleRecord(blockedRecord),
  true
);

assert.strictEqual(
  canTransition('queued', 'ready'),
  true
);

assert.strictEqual(
  canTransition('queued', 'blocked'),
  true
);

assert.strictEqual(
  canTransition('ready', 'completed'),
  true
);

assert.strictEqual(
  canTransition('completed', 'ready'),
  false
);

const lifecycle =
  evaluateQueueLifecycle(
    [
      readyItem,
      blockedItem
    ],
    NOW
  );

assert.strictEqual(
  lifecycle.total,
  2
);

assert.strictEqual(
  lifecycle.ready,
  1
);

assert.strictEqual(
  lifecycle.blocked,
  1
);

assert.strictEqual(
  lifecycle.executionAllowed,
  false
);

assert.strictEqual(
  lifecycle.planningOnly,
  true
);

const transition =
  transitionQueueItemStatus(
    {
      ...readyItem,
      status: 'ready'
    },
    'completed'
  );

assert.strictEqual(
  transition.ok,
  true
);

assert.strictEqual(
  transition.item.status,
  'completed'
);

assert.strictEqual(
  transition.item.executionAllowed,
  false
);

const invalidTransition =
  transitionQueueItemStatus(
    {
      ...readyItem,
      status: 'completed'
    },
    'ready'
  );

assert.strictEqual(
  invalidTransition.ok,
  false
);

console.log(
  'STAGE938_QUEUE_LIFECYCLE_ENGINE_UNIT_TEST: PASS'
);
