'use strict';

const assert = require('assert');

const {
  buildAllProjectQueueLifecycles
} = require('../services/mira-project-queue-lifecycle-service');

const {
  validateQueueLifecycleRecord
} = require('../queue-lifecycle-schema');

const NOW = new Date('2026-10-08T12:00:00Z');

const results =
  buildAllProjectQueueLifecycles({
    now: NOW
  });

let queueItems = 0;
let failures = 0;

for (const result of results) {
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.executionAllowed, false);
  assert.strictEqual(result.planningOnly, true);
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

  assert.ok(Array.isArray(result.queue));
  assert.ok(result.lifecycle);
  assert.ok(Array.isArray(result.lifecycle.records));

  assert.strictEqual(
    result.lifecycle.records.length,
    result.queue.length
  );

  for (const record of result.lifecycle.records) {
    queueItems++;

    if (!validateQueueLifecycleRecord(record)) {
      failures++;
    }

    if (record.executionAllowed !== false) {
      failures++;
    }

    if (record.planningOnly !== true) {
      failures++;
    }
  }

  assert.strictEqual(
    result.lifecycle.total,
    result.queue.length
  );

  assert.strictEqual(
    result.lifecycle.executionAllowed,
    false
  );

  assert.strictEqual(
    result.lifecycle.planningOnly,
    true
  );
}

assert.strictEqual(failures, 0);

console.log(
  'PROJECTS_CHECKED:',
  results.length
);

console.log(
  'QUEUE_ITEMS_CHECKED:',
  queueItems
);

console.log(
  'STAGE938_QUEUE_LIFECYCLE_ENGINE_E2E_TEST: PASS'
);
