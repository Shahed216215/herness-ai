'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root =
  path.join(__dirname, '..');

const deliverableStore =
  require('../deliverable-store');

const submissionStore =
  require('../submission-store');

const engine =
  require('../services/client-submission-engine');

const ID =
  `stage103-e2e-${crypto.randomUUID()}`;

const FILE =
  path.join(
    root,
    `stage103-e2e-${crypto.randomUUID()}.csv`
  );

function cleanup() {
  try {
    const submissions =
      submissionStore.loadStore();

    submissions.submissions =
      submissions.submissions.filter(
        item =>
          item.deliverableId !== ID
      );

    submissionStore.saveStore(
      submissions
    );
  } catch (_) {}

  try {
    const deliveries =
      deliverableStore.loadStore();

    deliveries.deliveries =
      deliveries.deliveries.filter(
        item =>
          item.id !== ID
      );

    deliverableStore.saveStore(
      deliveries
    );
  } catch (_) {}

  if (fs.existsSync(FILE)) {
    fs.unlinkSync(FILE);
  }
}

try {
  cleanup();

  fs.writeFileSync(
    FILE,
    'id,name\n1,Mira\n'
  );

  const now =
    new Date().toISOString();

  // ----------------------------------------------------------
  // VERIFIED DELIVERABLE
  // ----------------------------------------------------------
  deliverableStore.create({
    id: ID,

    workId:
      'task-stage103-e2e',

    title:
      'Stage 10.3 E2E CSV',

    requiredFormat:
      'CSV',

    status:
      'QA_PASSED',

    buildStatus:
      'BUILT',

    packagePath:
      FILE,

    verification: {
      passed: true,
      checkedAt: now,
      checks: [
        {
          name:
            'file-integrity',
          passed: true
        },
        {
          name:
            'requirements',
          passed: true
        },
        {
          name:
            'security',
          passed: true
        }
      ]
    },

    metadata: {
      clientId:
        'client-e2e',
      taskId:
        'task-stage103-e2e'
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

  // ----------------------------------------------------------
  // NORMAL SUBMISSION
  // ----------------------------------------------------------
  const first =
    engine.submit({
      deliverableId:
        ID,

      clientId:
        'client-e2e',

      taskId:
        'task-stage103-e2e',

      idempotencyKey:
        'stage103-e2e-idempotency'
    });

  assert.strictEqual(
    first.status,
    'SUBMITTED'
  );

  assert.strictEqual(
    first.submission.status,
    'SUBMITTED'
  );

  assert.ok(
    first.receipt.receiptId
  );

  console.log(
    'NORMAL SUBMISSION: PASS'
  );

  // ----------------------------------------------------------
  // REPEATED REQUEST
  // ----------------------------------------------------------
  const repeated =
    engine.submit({
      deliverableId:
        ID,

      clientId:
        'client-e2e',

      taskId:
        'task-stage103-e2e',

      idempotencyKey:
        'stage103-e2e-idempotency'
    });

  assert.strictEqual(
    repeated.duplicate,
    true
  );

  assert.strictEqual(
    repeated.status,
    'ALREADY_SUBMITTED'
  );

  assert.strictEqual(
    repeated.receipt.receiptId,
    first.receipt.receiptId
  );

  console.log(
    'REPEATED REQUEST / IDEMPOTENCY: PASS'
  );

  // ----------------------------------------------------------
  // DIFFERENT KEY, SAME PACKAGE
  // ----------------------------------------------------------
  const fingerprintDuplicate =
    engine.submit({
      deliverableId:
        ID,

      clientId:
        'client-e2e',

      taskId:
        'task-stage103-e2e',

      idempotencyKey:
        'different-key-but-same-package'
    });

  assert.strictEqual(
    fingerprintDuplicate.duplicate,
    true
  );

  assert.strictEqual(
    fingerprintDuplicate.status,
    'ALREADY_SUBMITTED'
  );

  console.log(
    'FINGERPRINT DUPLICATE PROTECTION: PASS'
  );

  // ----------------------------------------------------------
  // WRONG CLIENT
  // ----------------------------------------------------------
  assert.throws(
    () =>
      engine.submit({
        deliverableId:
          ID,

        clientId:
          'client-WRONG',

        taskId:
          'task-stage103-e2e',

        idempotencyKey:
          'wrong-client'
      }),
    /CLIENT_TASK_MISMATCH/
  );

  console.log(
    'WRONG CLIENT REJECTION: PASS'
  );

  // ----------------------------------------------------------
  // WRONG TASK
  // ----------------------------------------------------------
  assert.throws(
    () =>
      engine.submit({
        deliverableId:
          ID,

        clientId:
          'client-e2e',

        taskId:
          'task-WRONG',

        idempotencyKey:
          'wrong-task'
      }),
    /CLIENT_TASK_MISMATCH/
  );

  console.log(
    'WRONG TASK REJECTION: PASS'
  );

  // ----------------------------------------------------------
  // FAILED ADAPTER
  // ----------------------------------------------------------
  const failureId =
    `stage103-failure-${crypto.randomUUID()}`;

  const failureFile =
    path.join(
      root,
      `${failureId}.csv`
    );

  fs.writeFileSync(
    failureFile,
    'failure,test\n1,true\n'
  );

  deliverableStore.create({
    id:
      failureId,

    workId:
      'task-stage103-failure',

    title:
      'Stage 10.3 Failure',

    requiredFormat:
      'CSV',

    status:
      'QA_PASSED',

    buildStatus:
      'BUILT',

    packagePath:
      failureFile,

    verification: {
      passed: true,
      checkedAt: now,
      checks: [
        {
          name:
            'verification',
          passed: true
        }
      ]
    },

    metadata: {
      clientId:
        'client-failure',
      taskId:
        'task-stage103-failure'
    },

    history: [
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

  assert.throws(
    () =>
      engine.submit(
        {
          deliverableId:
            failureId,

          clientId:
            'client-failure',

          taskId:
            'task-stage103-failure',

          idempotencyKey:
            'failure-adapter'
        },
        {
          adapter: () => {
            throw new Error(
              'CONTROLLED_ADAPTER_FAILURE'
            );
          }
        }
      ),
    /SUBMISSION_FAILED:CONTROLLED_ADAPTER_FAILURE/
  );

  const failed =
    submissionStore
      .list()
      .find(
        item =>
          item.deliverableId ===
          failureId
      );

  assert.ok(failed);

  assert.strictEqual(
    failed.status,
    'FAILED'
  );

  assert.ok(
    failed.failure
  );

  assert.ok(
    failed.audit.some(
      item =>
        item.event ===
        'SUBMISSION_FAILED'
    )
  );

  console.log(
    'SUBMISSION FAILURE STATE: PASS'
  );

  // ----------------------------------------------------------
  // CORRUPTED STORE PROTECTION
  // ----------------------------------------------------------
  const storeFile =
    submissionStore.STORE_FILE;

  const original =
    fs.readFileSync(
      storeFile,
      'utf8'
    );

  fs.writeFileSync(
    storeFile,
    '{corrupted'
  );

  assert.throws(
    () =>
      submissionStore.list(),
    /SUBMISSION_STORE_CORRUPTED/
  );

  fs.writeFileSync(
    storeFile,
    original
  );

  console.log(
    'CORRUPTED STORE DETECTION: PASS'
  );

  const finalSubmissions =
    submissionStore.list();

  assert.ok(
    finalSubmissions.some(
      item =>
        item.id ===
        first.submission.id
    )
  );

  console.log(
    'RECEIPT PERSISTENCE: PASS'
  );

  console.log(
    'STAGE10_3_CLIENT_SUBMISSION_E2E: PASS'
  );

  console.log(
    'FLOW: VERIFIED DELIVERABLE -> PACKAGE -> MATCH -> VALIDATE -> SUBMIT -> RECEIPT -> AUDIT'
  );

} finally {
  try {
    const submissions =
      submissionStore.loadStore();

    submissions.submissions =
      submissions.submissions.filter(
        item =>
          item.deliverableId !== ID &&
          !String(
            item.deliverableId
          ).startsWith(
            'stage103-failure-'
          )
      );

    submissionStore.saveStore(
      submissions
    );
  } catch (_) {}

  try {
    const deliveries =
      deliverableStore.loadStore();

    deliveries.deliveries =
      deliveries.deliveries.filter(
        item =>
          item.id !== ID &&
          !String(
            item.id
          ).startsWith(
            'stage103-failure-'
          )
      );

    deliverableStore.saveStore(
      deliveries
    );
  } catch (_) {}

  for (const file of fs.readdirSync(root)) {
    if (
      file.startsWith('stage103-e2e-') ||
      file.startsWith('stage103-failure-')
    ) {
      try {
        fs.unlinkSync(
          path.join(root, file)
        );
      } catch (_) {}
    }
  }
}
