'use strict';

const {
  createExecutionQueueItem,
  validateExecutionQueue,
  QUEUE_STATUSES
} = require('../execution-queue-schema');

function clonePriorityRecord(record) {
  return {
    ...record,
    dependencies: Array.isArray(record.dependencies)
      ? [...record.dependencies]
      : []
  };
}

function compareQueueItems(a, b) {
  if (a.dependencyBlocked !== b.dependencyBlocked) {
    return a.dependencyBlocked ? 1 : -1;
  }

  if (b.priorityScore !== a.priorityScore) {
    return b.priorityScore - a.priorityScore;
  }

  const aDeadline =
    a.deadline
      ? new Date(a.deadline).getTime()
      : Number.MAX_SAFE_INTEGER;

  const bDeadline =
    b.deadline
      ? new Date(b.deadline).getTime()
      : Number.MAX_SAFE_INTEGER;

  const aValidDeadline = Number.isFinite(aDeadline)
    ? aDeadline
    : Number.MAX_SAFE_INTEGER;

  const bValidDeadline = Number.isFinite(bDeadline)
    ? bDeadline
    : Number.MAX_SAFE_INTEGER;

  if (aValidDeadline !== bValidDeadline) {
    return aValidDeadline - bValidDeadline;
  }

  const aSequence = Number.isFinite(a.sequence)
    ? a.sequence
    : Number.MAX_SAFE_INTEGER;

  const bSequence = Number.isFinite(b.sequence)
    ? b.sequence
    : Number.MAX_SAFE_INTEGER;

  if (aSequence !== bSequence) {
    return aSequence - bSequence;
  }

  return String(a.taskId).localeCompare(String(b.taskId));
}

function buildExecutionQueue(priorityRecords = []) {
  if (!Array.isArray(priorityRecords)) {
    throw new TypeError('priorityRecords must be an array');
  }

  const seenTaskIds = new Set();

  const uniqueRecords = [];

  for (const record of priorityRecords) {
    if (!record || !record.taskId) continue;

    if (seenTaskIds.has(record.taskId)) {
      continue;
    }

    seenTaskIds.add(record.taskId);
    uniqueRecords.push(clonePriorityRecord(record));
  }

  uniqueRecords.sort(compareQueueItems);

  const queue = uniqueRecords.map((record, index) =>
    createExecutionQueueItem({
      ...record,
      queuePosition: index + 1,
      status:
        record.dependencyBlocked === true
          ? 'blocked'
          : 'queued'
    })
  );

  if (!validateExecutionQueue(queue)) {
    throw new Error('Generated execution queue failed validation');
  }

  return queue;
}

function rebuildExecutionQueue(priorityRecords = []) {
  return buildExecutionQueue(priorityRecords);
}

function getQueueSummary(queue = []) {
  const safeQueue = Array.isArray(queue) ? queue : [];

  return {
    total: safeQueue.length,
    queued: safeQueue.filter(
      item => item.status === 'queued'
    ).length,
    blocked: safeQueue.filter(
      item => item.status === 'blocked'
    ).length,
    ready: safeQueue.filter(
      item => item.status === 'ready'
    ).length,
    completed: safeQueue.filter(
      item => item.status === 'completed'
    ).length,
    cancelled: safeQueue.filter(
      item => item.status === 'cancelled'
    ).length,
    planningOnly: true,
    executionAllowed: false
  };
}

module.exports = {
  buildExecutionQueue,
  rebuildExecutionQueue,
  getQueueSummary,
  compareQueueItems,
  QUEUE_STATUSES
};
