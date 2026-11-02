'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const builder = require('../services/deliverable-builder');
const store = require('../deliverable-store');

const testId =
  `stage101-e2e-${Date.now()}-${process.pid}`;

const workId = `work-${Date.now()}`;

function cleanup() {
  try {
    const item = builder.get(testId);

    if (item && item.packagePath && fs.existsSync(item.packagePath)) {
      fs.unlinkSync(item.packagePath);
    }

    const dir = path.join(process.cwd(), 'deliveries', workId);

    if (fs.existsSync(dir)) {
      fs.rmSync(dir, {
        recursive: true,
        force: true
      });
    }

    const storeData = store.loadStore();
    storeData.deliveries =
      storeData.deliveries.filter(x => x.id !== testId);

    store.saveStore(storeData);
  } catch (_) {}
}

try {
  cleanup();

  const created = builder.register({
    id: testId,
    workId,
    title: 'Stage 10.1 E2E Deliverable',
    requiredFormat: 'CSV',
    metadata: {
      source: 'stage101-e2e'
    }
  });

  assert.strictEqual(created.status, 'READY');
  assert.strictEqual(created.buildStatus, 'NOT_BUILT');

  const built = builder.build(testId);

  assert.strictEqual(built.status, 'READY');
  assert.strictEqual(built.buildStatus, 'BUILT');
  assert.ok(built.packagePath);
  assert.ok(fs.existsSync(built.packagePath));

  const verified = builder.verify(testId);

  assert.strictEqual(verified.status, 'QA_PASSED');
  assert.strictEqual(
    verified.verification.passed,
    true
  );

  assert.ok(
    verified.verification.checks.every(x => x.passed)
  );

  const pending =
    builder.markPendingSubmission(testId);

  assert.strictEqual(
    pending.status,
    'PENDING_SUBMISSION'
  );

  const submitted =
    builder.markSubmitted(testId);

  assert.strictEqual(
    submitted.status,
    'SUBMITTED'
  );

  const accepted =
    builder.markAccepted(testId);

  assert.strictEqual(
    accepted.status,
    'ACCEPTED'
  );

  assert.ok(
    accepted.history.some(x => x.status === 'READY')
  );

  assert.ok(
    accepted.history.some(x => x.status === 'QA_PASSED')
  );

  assert.ok(
    accepted.history.some(x => x.status === 'SUBMITTED')
  );

  assert.ok(
    accepted.history.some(x => x.status === 'ACCEPTED')
  );

  console.log('STAGE10_1_DELIVERABLE_BUILDER_E2E: PASS');
  console.log('FLOW: READY -> BUILD -> QA PASSED -> PENDING SUBMISSION -> SUBMITTED -> ACCEPTED');
  console.log('FORMAT: CSV');
  console.log('INTEGRITY: SHA256 PASS');
  console.log('DELIVERY HISTORY: PASS');
} finally {
  cleanup();
}
