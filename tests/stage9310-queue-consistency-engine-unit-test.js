'use strict';

const assert = require('assert');

const {
  checkQueueConsistency,
  rebuildConsistentQueue,
  checkAndRebuildQueue
} = require('../services/mira-queue-consistency-engine');

function makeItem({
  taskId,
  projectId = 'project-a',
  position,
  score,
  blocked = false
}) {
  return {
    taskId,
    projectId,
    planId: 'plan-1',
    globalQueuePosition: position,
    projectQueuePosition: position,
    priorityScore: score,
    priority: score >= 0.8
      ? 'critical'
      : score >= 0.6
        ? 'high'
        : score >= 0.4
          ? 'medium'
          : 'low',
    urgencyScore: score,
    effortScore: 0.25,
    dependencyScore: 0,
    riskScore: 0,
    deadline: '',
    difficulty: 'easy',
    risk: 'low',
    dependencies: [],
    dependencyBlocked: blocked,
    sequence: position,
    status: blocked ? 'blocked' : 'queued',
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };
}

const consistent = [
  makeItem({
    taskId: 'task-a',
    position: 1,
    score: 0.9
  }),
  makeItem({
    taskId: 'task-b',
    position: 2,
    score: 0.5
  }),
  makeItem({
    taskId: 'task-c',
    position: 3,
    score: 0.2,
    blocked: true
  })
];

const report =
  checkQueueConsistency({
    items: consistent,
    projectIds: ['project-a']
  });

assert.strictEqual(
  report.status,
  'consistent'
);

assert.strictEqual(
  report.issueCount,
  0
);

const broken = [
  makeItem({
    taskId: 'task-a',
    position: 2,
    score: 0.2
  }),
  makeItem({
    taskId: 'task-a',
    position: 2,
    score: 0.9
  })
];

const brokenReport =
  checkQueueConsistency({
    items: broken,
    projectIds: ['project-a']
  });

assert.strictEqual(
  brokenReport.status,
  'inconsistent'
);

assert.ok(
  brokenReport.issueCount >= 2
);

const rebuilt =
  rebuildConsistentQueue(broken);

assert.strictEqual(
  rebuilt.length,
  1
);

assert.strictEqual(
  rebuilt[0].globalQueuePosition,
  1
);

assert.strictEqual(
  rebuilt[0].executionAllowed,
  false
);

assert.strictEqual(
  rebuilt[0].planningOnly,
  true
);

const repaired =
  checkAndRebuildQueue({
    items: broken,
    projectIds: ['project-a']
  });

assert.strictEqual(
  repaired.ok,
  true
);

assert.strictEqual(
  repaired.status,
  'rebuilt'
);

assert.strictEqual(
  repaired.rebuilt,
  true
);

assert.strictEqual(
  repaired.queue.length,
  1
);

const blockedOrdering = [
  makeItem({
    taskId: 'task-blocked',
    position: 1,
    score: 0.9,
    blocked: true
  }),
  makeItem({
    taskId: 'task-ready',
    position: 2,
    score: 0.2,
    blocked: false
  })
];

const orderingReport =
  checkQueueConsistency({
    items: blockedOrdering,
    projectIds: ['project-a']
  });

assert.strictEqual(
  orderingReport.status,
  'inconsistent'
);

assert.ok(
  orderingReport.issues.some(
    issue =>
      issue.type === 'blocked_order_violation'
  )
);

const empty =
  checkAndRebuildQueue({
    items: [],
    projectIds: ['project-a']
  });

assert.strictEqual(
  empty.status,
  'empty'
);

assert.strictEqual(
  empty.rebuilt,
  false
);

console.log(
  'STAGE9310_QUEUE_CONSISTENCY_ENGINE_UNIT_TEST: PASS'
);
