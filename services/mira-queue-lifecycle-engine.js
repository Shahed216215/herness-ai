'use strict';

const {
  createQueueLifecycleRecord,
  canTransition,
  validateQueueLifecycleRecord
} = require('../queue-lifecycle-schema');

function determineQueueStatus(item = {}) {
  if (!item || !item.taskId) {
    throw new TypeError('A valid queue item is required');
  }

  if (item.status === 'completed') {
    return 'completed';
  }

  if (item.status === 'cancelled') {
    return 'cancelled';
  }

  if (item.dependencyBlocked === true) {
    return 'blocked';
  }

  return 'ready';
}

function evaluateQueueItemReadiness(item = {}, now = new Date()) {
  const nextStatus = determineQueueStatus(item);

  const currentStatus =
    item.status || 'queued';

  let status = nextStatus;

  if (
    currentStatus !== nextStatus &&
    !canTransition(currentStatus, nextStatus)
  ) {
    if (
      currentStatus === 'blocked' &&
      nextStatus === 'ready'
    ) {
      status = 'ready';
    } else if (
      currentStatus === 'queued' &&
      nextStatus === 'blocked'
    ) {
      status = 'blocked';
    } else if (
      currentStatus === 'queued' &&
      nextStatus === 'ready'
    ) {
      status = 'ready';
    } else {
      status = currentStatus;
    }
  }

  const record = createQueueLifecycleRecord({
    taskId: item.taskId,
    projectId: item.projectId,
    planId: item.planId,
    previousStatus: currentStatus,
    status,
    dependencyBlocked: item.dependencyBlocked === true,
    dependencies: item.dependencies,
    reason:
      status === 'blocked'
        ? 'Dependency requirements are not satisfied.'
        : status === 'ready'
          ? 'Task has no blocking dependency.'
          : `Task remains ${status}.`,
    checkedAt: now instanceof Date
      ? now.toISOString()
      : new Date(now).toISOString()
  });

  if (!validateQueueLifecycleRecord(record)) {
    throw new Error(
      'Generated queue lifecycle record failed validation'
    );
  }

  return record;
}

function evaluateQueueLifecycle(queue = [], now = new Date()) {
  if (!Array.isArray(queue)) {
    throw new TypeError('queue must be an array');
  }

  const records = queue.map(item =>
    evaluateQueueItemReadiness(item, now)
  );

  return {
    records,
    total: records.length,
    queued: records.filter(
      item => item.status === 'queued'
    ).length,
    blocked: records.filter(
      item => item.status === 'blocked'
    ).length,
    ready: records.filter(
      item => item.status === 'ready'
    ).length,
    completed: records.filter(
      item => item.status === 'completed'
    ).length,
    cancelled: records.filter(
      item => item.status === 'cancelled'
    ).length,
    executionAllowed: false,
    planningOnly: true
  };
}

function transitionQueueItemStatus(
  item = {},
  toStatus
) {
  const fromStatus =
    item.status || 'queued';

  if (!canTransition(fromStatus, toStatus)) {
    return {
      ok: false,
      status: 'invalid_transition',
      fromStatus,
      toStatus
    };
  }

  const next = {
    ...item,
    status: toStatus,
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };

  return {
    ok: true,
    status: 'ok',
    item: next
  };
}

module.exports = {
  determineQueueStatus,
  evaluateQueueItemReadiness,
  evaluateQueueLifecycle,
  transitionQueueItemStatus
};
