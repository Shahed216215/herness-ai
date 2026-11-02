'use strict';

const assert = require('assert');
const builder = require('../services/deliverable-builder');
const store = require('../deliverable-store');

const id = `stage101-revision-${Date.now()}`;

function cleanup() {
  try {
    const data = store.loadStore();
    data.deliveries = data.deliveries.filter(x => x.id !== id);
    store.saveStore(data);
  } catch (_) {}
}

try {
  cleanup();

  builder.register({
    id,
    workId: `revision-work-${Date.now()}`,
    title: 'Revision Flow',
    requiredFormat: 'PDF'
  });

  builder.build(id);
  builder.verify(id);
  builder.markPendingSubmission(id);
  builder.markSubmitted(id);

  const revision =
    builder.markRevisionRequested(id);

  assert.strictEqual(
    revision.status,
    'REVISION_REQUESTED'
  );

  assert.throws(
    () => builder.markAccepted(id),
    /INVALID_DELIVERY_TRANSITION/
  );

  console.log('STAGE10_1_REVISION_FLOW: PASS');
} finally {
  cleanup();
}
