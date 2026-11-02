'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const builder =
  require('../services/deliverable-builder');

const orchestrator =
  require('../services/deliverable-orchestrator');

const manifest =
  require('../services/deliverable-package-manifest');

const store =
  require('../deliverable-store');

const workId =
  `stage101-completed-${Date.now()}`;

let deliveryId = null;
let packagePath = null;

function cleanup() {
  try {
    if (packagePath && fs.existsSync(packagePath)) {
      fs.unlinkSync(packagePath);
    }
  } catch (_) {}

  try {
    const data = store.loadStore();

    data.deliveries =
      data.deliveries.filter(
        item => item.workId !== workId
      );

    store.saveStore(data);
  } catch (_) {}

  try {
    const dir =
      path.join(
        process.cwd(),
        'deliveries',
        workId
      );

    if (fs.existsSync(dir)) {
      fs.rmSync(dir, {
        recursive: true,
        force: true
      });
    }
  } catch (_) {}
}

try {
  cleanup();

  // ----------------------------------------------------------
  // COMPLETED WORK
  // ----------------------------------------------------------
  const work = {
    id: workId,
    title: 'Completed Research Work',
    status: 'COMPLETED',
    requiredFormat: 'CSV'
  };

  const prepared =
    orchestrator.prepareFromCompletedWork(work);

  assert.strictEqual(prepared.created, true);
  assert.strictEqual(prepared.duplicate, false);
  assert.ok(prepared.deliverable);

  deliveryId =
    prepared.deliverable.id;

  assert.strictEqual(
    prepared.deliverable.status,
    'READY'
  );

  // ----------------------------------------------------------
  // DUPLICATE PROTECTION
  // ----------------------------------------------------------
  const duplicate =
    orchestrator.prepareFromCompletedWork(work);

  assert.strictEqual(
    duplicate.created,
    false
  );

  assert.strictEqual(
    duplicate.duplicate,
    true
  );

  // ----------------------------------------------------------
  // BUILD + VERIFY
  // ----------------------------------------------------------
  const built =
    orchestrator.buildAndVerify(
      deliveryId
    );

  assert.strictEqual(
    built.deliverable.buildStatus,
    'BUILT'
  );

  assert.strictEqual(
    built.deliverable.status,
    'QA_PASSED'
  );

  assert.strictEqual(
    built.deliverable.verification.passed,
    true
  );

  assert.ok(
    built.manifest.manifestPath
  );

  packagePath =
    built.deliverable.packagePath;

  assert.ok(
    fs.existsSync(packagePath)
  );

  // ----------------------------------------------------------
  // MANIFEST INTEGRITY
  // ----------------------------------------------------------
  assert.strictEqual(
    manifest.verifyManifest(
      built.deliverable,
      built.manifest
    ),
    true
  );

  // ----------------------------------------------------------
  // PREPARE SUBMISSION
  // ----------------------------------------------------------
  const pending =
    orchestrator.prepareSubmission(
      deliveryId
    );

  assert.strictEqual(
    pending.deliverable.status,
    'PENDING_SUBMISSION'
  );

  // ----------------------------------------------------------
  // SUBMIT
  // ----------------------------------------------------------
  const submitted =
    orchestrator.submit(
      deliveryId
    );

  assert.strictEqual(
    submitted.status,
    'SUBMITTED'
  );

  // ----------------------------------------------------------
  // ACCEPT
  // ----------------------------------------------------------
  const accepted =
    orchestrator.accept(
      deliveryId
    );

  assert.strictEqual(
    accepted.status,
    'ACCEPTED'
  );

  // ----------------------------------------------------------
  // HISTORY
  // ----------------------------------------------------------
  const statuses =
    accepted.history.map(
      item => item.status
    );

  assert.ok(
    statuses.includes('READY')
  );

  assert.ok(
    statuses.includes('QA_PASSED')
  );

  assert.ok(
    statuses.includes('PENDING_SUBMISSION')
  );

  assert.ok(
    statuses.includes('SUBMITTED')
  );

  assert.ok(
    statuses.includes('ACCEPTED')
  );

  console.log(
    'STAGE10_1_FULL_INTEGRATION_E2E: PASS'
  );

  console.log(
    'COMPLETED WORK -> DELIVERABLE: PASS'
  );

  console.log(
    'DUPLICATE PROTECTION: PASS'
  );

  console.log(
    'BUILD -> QA -> PACKAGE: PASS'
  );

  console.log(
    'MANIFEST INTEGRITY: PASS'
  );

  console.log(
    'SUBMISSION LIFECYCLE: PASS'
  );

  console.log(
    'DELIVERY HISTORY: PASS'
  );
} finally {
  cleanup();
}
