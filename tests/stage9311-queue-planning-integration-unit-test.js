'use strict';

const assert = require('assert');

const {
  createPlanningIntegrationResult,
  validatePlanningIntegrationResult
} = require('../queue-planning-integration-schema');

const {
  buildQueuePlanningIntegration
} = require('../services/mira-queue-planning-integration');

function run() {
  const empty = createPlanningIntegrationResult();

  assert.strictEqual(empty.ok, true);
  assert.strictEqual(empty.status, 'empty');
  assert.strictEqual(empty.executionAllowed, false);
  assert.strictEqual(empty.planningOnly, true);
  assert.strictEqual(empty.externalActionPerformed, false);
  assert.strictEqual(empty.paymentAllowed, false);
  assert.strictEqual(empty.paymentTransferAuthorized, false);
  assert.strictEqual(empty.contractSigningAllowed, false);
  assert.strictEqual(
    validatePlanningIntegrationResult(empty),
    true
  );

  const result = buildQueuePlanningIntegration({
    now: new Date('2026-10-08T12:00:00Z')
  });

  assert.strictEqual(result.ok, true);
  assert.ok(
    ['ready', 'empty', 'inconsistent'].includes(
      result.status
    )
  );

  assert.strictEqual(
    validatePlanningIntegrationResult(result),
    true
  );

  assert.strictEqual(
    result.executionAllowed,
    false
  );

  assert.strictEqual(
    result.planningOnly,
    true
  );

  assert.strictEqual(
    result.externalActionPerformed,
    false
  );

  assert.strictEqual(
    result.paymentAllowed,
    false
  );

  assert.strictEqual(
    result.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    result.contractSigningAllowed,
    false
  );

  assert.strictEqual(
    result.queue.length,
    result.taskCount
  );

  const taskIds = new Set(
    result.queue.map(item => item.taskId)
  );

  assert.strictEqual(
    taskIds.size,
    result.queue.length
  );

  console.log(
    'STAGE9311_QUEUE_PLANNING_INTEGRATION_UNIT_TEST: PASS'
  );
}

run();
