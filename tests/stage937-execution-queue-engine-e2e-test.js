'use strict';

const assert = require('assert');

const {
  buildAllProjectExecutionQueues
} = require('../services/mira-project-execution-queue-service');

const {
  validateExecutionQueue
} = require('../execution-queue-schema');

const results =
  buildAllProjectExecutionQueues({
    now: new Date('2026-10-08T12:00:00Z')
  });

assert.ok(Array.isArray(results));

let queueItems = 0;

for (const result of results) {
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.executionAllowed, false);
  assert.strictEqual(result.planningOnly, true);
  assert.strictEqual(result.externalActionPerformed, false);
  assert.strictEqual(result.paymentAllowed, false);
  assert.strictEqual(result.paymentTransferAuthorized, false);
  assert.strictEqual(result.contractSigningAllowed, false);

  assert.ok(Array.isArray(result.queue));

  assert.strictEqual(
    validateExecutionQueue(result.queue),
    true
  );

  assert.strictEqual(
    result.summary.total,
    result.queue.length
  );

  let previousPosition = 0;
  let blockedSeen = false;
  const taskIds = new Set();

  for (const item of result.queue) {
    queueItems++;

    assert.strictEqual(
      item.queuePosition,
      previousPosition + 1
    );

    assert.strictEqual(
      taskIds.has(item.taskId),
      false
    );

    taskIds.add(item.taskId);

    if (item.dependencyBlocked) {
      blockedSeen = true;
    } else {
      assert.strictEqual(
        blockedSeen,
        false
      );
    }

    assert.strictEqual(
      item.executionAllowed,
      false
    );

    assert.strictEqual(
      item.planningOnly,
      true
    );

    previousPosition =
      item.queuePosition;
  }
}

console.log('PROJECTS_CHECKED:', results.length);
console.log('QUEUE_ITEMS_CHECKED:', queueItems);
console.log(
  'STAGE937_EXECUTION_QUEUE_ENGINE_E2E_TEST: PASS'
);
