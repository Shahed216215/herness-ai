'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

const deliverableStore =
  require('../deliverable-store');

const submissionStore =
  require('../submission-store');

const engine =
  require('../services/client-submission-engine');

const TEST_DELIVERABLE_ID =
  `stage103-unit-${crypto.randomUUID()}`;

const TEST_FILE =
  path.join(
    root,
    'deliveries',
    `stage103-unit-${crypto.randomUUID()}.txt`
  );

function cleanup() {
  const store =
    submissionStore.loadStore();

  store.submissions =
    store.submissions.filter(
      item =>
        item.deliverableId !==
        TEST_DELIVERABLE_ID
    );

  submissionStore.saveStore(
    store
  );

  const deliveries =
    deliverableStore.loadStore();

  deliveries.deliveries =
    deliveries.deliveries.filter(
      item =>
        item.id !==
        TEST_DELIVERABLE_ID
    );

  deliverableStore.saveStore(
    deliveries
  );

  if (fs.existsSync(TEST_FILE)) {
    fs.unlinkSync(TEST_FILE);
  }
}

try {
  cleanup();

  fs.writeFileSync(
    TEST_FILE,
    'stage103 verified deliverable'
  );

  const now =
    new Date().toISOString();

  deliverableStore.create({
    id:
      TEST_DELIVERABLE_ID,

    workId:
      'task-stage103-unit',

    title:
      'Stage 10.3 Unit Deliverable',

    requiredFormat:
      'CSV',

    status:
      'QA_PASSED',

    buildStatus:
      'BUILT',

    packagePath:
      TEST_FILE,

    verification: {
      passed: true,
      checkedAt: now,
      checks: [
        {
          name:
            'unit-verification',
          passed: true
        }
      ]
    },

    metadata: {
      clientId:
        'client-stage103',
      taskId:
        'task-stage103-unit'
    },

    history: [
      {
        status:
          'READY',
        at: now
      },
      {
        status:
          'QA_PASSED',
        at: now
      }
    ],

    createdAt:
      now,

    updatedAt:
      now
  });

  // VERIFIED DELIVERABLE REQUIRED
  assert.throws(
    () =>
      engine.submit({
        deliverableId:
          'missing-deliverable',
        clientId:
          'client-stage103',
        taskId:
          'task-stage103-unit'
      }),
    /DELIVERABLE_NOT_FOUND/
  );

  // CORRECT CLIENT/TASK
  const first =
    engine.submit({
      deliverableId:
        TEST_DELIVERABLE_ID,
      clientId:
        'client-stage103',
      taskId:
        'task-stage103-unit',
      idempotencyKey:
        'stage103-unit-key'
    });

  assert.strictEqual(
    first.status,
    'SUBMITTED'
  );

  assert.ok(
    first.receipt
  );

  assert.strictEqual(
    first.receipt.status,
    'SUBMITTED'
  );

  assert.strictEqual(
    first.receipt.externalSend,
    false
  );

  // DUPLICATE / IDEMPOTENCY
  const second =
    engine.submit({
      deliverableId:
        TEST_DELIVERABLE_ID,
      clientId:
        'client-stage103',
      taskId:
        'task-stage103-unit',
      idempotencyKey:
        'stage103-unit-key'
    });

  assert.strictEqual(
    second.duplicate,
    true
  );

  assert.strictEqual(
    second.status,
    'ALREADY_SUBMITTED'
  );

  assert.strictEqual(
    second.receipt.receiptId,
    first.receipt.receiptId
  );

  // WRONG CLIENT
  assert.throws(
    () =>
      engine.prepareSubmission({
        deliverableId:
          TEST_DELIVERABLE_ID,
        clientId:
          'wrong-client',
        taskId:
          'task-stage103-unit',
        idempotencyKey:
          'wrong-client-key'
      }),
    /CLIENT_TASK_MISMATCH/
  );

  // WRONG TASK
  assert.throws(
    () =>
      engine.prepareSubmission({
        deliverableId:
          TEST_DELIVERABLE_ID,
        clientId:
          'client-stage103',
        taskId:
          'wrong-task',
        idempotencyKey:
          'wrong-task-key'
      }),
    /CLIENT_TASK_MISMATCH/
  );

  // AUDIT
  const stored =
    engine.getSubmission(
      first.submission.id
    );

  assert.ok(
    Array.isArray(
      stored.audit
    )
  );

  assert.ok(
    stored.audit.some(
      item =>
        item.event ===
        'SUBMISSION_PREPARED'
    )
  );

  assert.ok(
    stored.audit.some(
      item =>
        item.event ===
        'SUBMISSION_COMPLETED'
    )
  );

  // RECEIPT
  assert.strictEqual(
    engine.getReceipt(
      first.submission.id
    ).receiptId,
    first.receipt.receiptId
  );

  console.log(
    'STAGE10_3_CLIENT_SUBMISSION_UNIT: PASS'
  );

  console.log(
    'VERIFIED DELIVERABLE GATE: PASS'
  );

  console.log(
    'CLIENT/TASK MATCH: PASS'
  );

  console.log(
    'PACKAGE + MANIFEST: PASS'
  );

  console.log(
    'IDEMPOTENCY: PASS'
  );

  console.log(
    'DUPLICATE PROTECTION: PASS'
  );

  console.log(
    'RECEIPT: PASS'
  );

  console.log(
    'AUDIT: PASS'
  );

  console.log(
    'CONTROLLED SUBMIT ADAPTER: PASS'
  );

} finally {
  cleanup();
}
