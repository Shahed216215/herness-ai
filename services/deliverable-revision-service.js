'use strict';

const store = require('../deliverable-store');

function getDeliverable(id) {
  const store = require('../deliverable-store');

  if (typeof store.get !== 'function') {
    throw new Error('DELIVERABLE_STORE_READ_API_MISSING');
  }

  return store.get(id);
}

function update(id, patch) {
  if (typeof store.updateDeliverable === 'function') {
    return store.updateDeliverable(id, patch);
  }

  if (typeof store.update === 'function') {
    return store.update(id, patch);
  }

  throw new Error('DELIVERABLE_STORE_UPDATE_API_MISSING');
}

function requestRevision(id, reason) {
  const d = getDeliverable(id);

  if (!d) throw new Error('DELIVERABLE_NOT_FOUND');

  if (!['SUBMITTED', 'ACCEPTED'].includes(d.status)) {
    throw new Error(`REVISION_NOT_ALLOWED_FROM:${d.status}`);
  }

  return update(id, {
    status: 'REVISION_REQUESTED',
    revisionReason: reason || 'Revision requested',
    revisionRequestedAt: new Date().toISOString()
  });
}

function returnToReady(id, notes) {
  const d = getDeliverable(id);

  if (!d) throw new Error('DELIVERABLE_NOT_FOUND');

  if (d.status !== 'REVISION_REQUESTED') {
    throw new Error(`REVISION_RETURN_NOT_ALLOWED_FROM:${d.status}`);
  }

  return update(id, {
    status: 'READY',
    revisionReturnedAt: new Date().toISOString(),
    revisionNotes: notes || null,
    revisionCount: Number(d.revisionCount || 0) + 1
  });
}

module.exports = {
  requestRevision,
  returnToReady
};
