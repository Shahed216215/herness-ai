'use strict';

const assert = require('assert');

const {
  listProjects
} = require('../project-store');

const {
  buildAllProjectPriorityQueues
} = require('../services/mira-project-priority-service');

const {
  validatePriorityRecord
} = require('../priority-schema');

const NOW = new Date('2026-10-08T12:00:00Z');

const projects = listProjects();

const results =
  buildAllProjectPriorityQueues({
    now: NOW
  });

assert.strictEqual(
  results.length,
  projects.length
);

let queueCount = 0;

for (const result of results) {
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.executionAllowed, false);
  assert.strictEqual(result.planningOnly, true);
  assert.strictEqual(result.externalActionPerformed, false);
  assert.strictEqual(result.paymentAllowed, false);
  assert.strictEqual(result.paymentTransferAuthorized, false);
  assert.strictEqual(result.contractSigningAllowed, false);

  assert.strictEqual(
    result.queue.length,
    result.taskCount
  );

  for (const item of result.queue) {
    assert.strictEqual(
      validatePriorityRecord(item),
      true
    );

    assert.ok(
      Number.isInteger(item.queuePosition)
    );

    queueCount++;
  }
}

console.log(
  `PROJECTS_CHECKED: ${results.length}`
);

console.log(
  `QUEUE_ITEMS_CHECKED: ${queueCount}`
);

console.log(
  'STAGE936_PRIORITY_ENGINE_E2E_TEST: PASS'
);
