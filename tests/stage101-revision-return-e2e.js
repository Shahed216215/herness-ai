'use strict';

const assert = require('assert');
const revision = require('../services/deliverable-revision-service');

const store = require('../deliverable-store');

function create() {
  if (typeof store.createDeliverable === 'function') {
    return store.createDeliverable({
      id: `stage101-revision-${Date.now()}`,
      workId: 'stage101-revision-work',
      title: 'Revision Return Test',
      requiredFormat: 'CSV',
      status: 'SUBMITTED'
    });
  }

  if (typeof store.create === 'function') {
    return store.create({
      id: `stage101-revision-${Date.now()}`,
      workId: 'stage101-revision-work',
      title: 'Revision Return Test',
      requiredFormat: 'CSV',
      status: 'SUBMITTED'
    });
  }

  throw new Error('DELIVERABLE_STORE_CREATE_API_MISSING');
}

const created = create();
const id = created.id;

const requested = revision.requestRevision(id, 'Please revise the requested section.');

assert.strictEqual(requested.status, 'REVISION_REQUESTED');

const ready = revision.returnToReady(
  id,
  'Revision work accepted back into the build queue.'
);

assert.strictEqual(ready.status, 'READY');
assert.strictEqual(Number(ready.revisionCount), 1);
assert(ready.revisionReturnedAt);

console.log('STAGE10_1_REVISION_RETURN_E2E: PASS');
console.log('SUBMITTED -> REVISION_REQUESTED: PASS');
console.log('REVISION_REQUESTED -> READY: PASS');
console.log('REVISION COUNT: PASS');
