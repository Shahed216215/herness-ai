'use strict';

const assert = require('assert');

const {
  auditQueueItems
} = require('../services/mira-queue-health-planning-audit-engine');

const safeItem = {
  taskId: 'task-1',
  globalQueuePosition: 1,
  dependencyBlocked: false,
  status: 'ready',
  priorityScore: 0.8,
  executionAllowed: false,
  planningOnly: true,
  externalActionPerformed: false,
  paymentAllowed: false,
  paymentTransferAuthorized: false,
  contractSigningAllowed: false
};

const clean = auditQueueItems([safeItem]);

assert.strictEqual(clean.issues.length, 0);
assert.strictEqual(clean.metrics.totalItems, 1);
assert.strictEqual(clean.metrics.uniqueTaskIds, 1);
assert.strictEqual(clean.metrics.uniqueQueuePositions, 1);
assert.strictEqual(clean.metrics.ready, 1);

const duplicate = auditQueueItems([
  safeItem,
  { ...safeItem }
]);

assert(
  duplicate.issues.includes('DUPLICATE_TASK_ID:task-1')
);

assert(
  duplicate.issues.includes('DUPLICATE_QUEUE_POSITION:1')
);

const unsafe = auditQueueItems([
  {
    ...safeItem,
    executionAllowed: true
  }
]);

assert(
  unsafe.issues.includes('SAFETY_BOUNDARY:task-1')
);

const invalidPriority = auditQueueItems([
  {
    ...safeItem,
    priorityScore: 2
  }
]);

assert(
  invalidPriority.issues.includes(
    'INVALID_PRIORITY_SCORE:task-1'
  )
);

console.log(
  'STAGE9314_QUEUE_HEALTH_PLANNING_AUDIT_UNIT_TEST: PASS'
);
