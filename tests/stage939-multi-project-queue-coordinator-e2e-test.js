'use strict';

const assert = require('assert');

const {
  buildMultiProjectQueue
} = require('../services/mira-multi-project-queue-coordinator-service');

const {
  validateCoordinatorItem
} = require('../multi-project-queue-coordinator-schema');

const result =
  buildMultiProjectQueue({
    now: new Date('2026-10-08T12:00:00Z')
  });

assert.strictEqual(result.ok, true);
assert.strictEqual(result.executionAllowed, false);
assert.strictEqual(result.planningOnly, true);
assert.strictEqual(result.externalActionPerformed, false);
assert.strictEqual(result.paymentAllowed, false);
assert.strictEqual(result.paymentTransferAuthorized, false);
assert.strictEqual(result.contractSigningAllowed, false);

assert(Array.isArray(result.projectResults));
assert.strictEqual(
  result.projectResults.length,
  result.projectCount
);

assert(Array.isArray(result.items));

const positions = new Set();
const taskIds = new Set();

for (const item of result.items) {
  assert(
    validateCoordinatorItem(item),
    `INVALID_COORDINATOR_ITEM: ${item.taskId}`
  );

  assert(!taskIds.has(item.taskId));
  taskIds.add(item.taskId);

  assert(!positions.has(item.globalQueuePosition));
  positions.add(item.globalQueuePosition);

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

const expectedPositions =
  result.items.map(
    (_, index) => index + 1
  );

assert.deepStrictEqual(
  result.items.map(item => item.globalQueuePosition),
  expectedPositions
);

for (let i = 1; i < result.items.length; i++) {
  const previous = result.items[i - 1];
  const current = result.items[i];

  if (
    previous.dependencyBlocked === false &&
    current.dependencyBlocked === true
  ) {
    continue;
  }
}

console.log(
  'PROJECTS_CHECKED:',
  result.projectCount
);

console.log(
  'GLOBAL_QUEUE_ITEMS_CHECKED:',
  result.items.length
);

console.log(
  'STAGE939_MULTI_PROJECT_QUEUE_COORDINATOR_E2E_TEST: PASS'
);
