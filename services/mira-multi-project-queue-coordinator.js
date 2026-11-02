'use strict';

const {
  createCoordinatorItem,
  createCoordinatorResult
} = require('../multi-project-queue-coordinator-schema');

function compareGlobalQueueItems(a, b) {
  const blockedA = a.dependencyBlocked === true ? 1 : 0;
  const blockedB = b.dependencyBlocked === true ? 1 : 0;

  if (blockedA !== blockedB) {
    return blockedA - blockedB;
  }

  const priorityA = Number.isFinite(a.priorityScore)
    ? a.priorityScore
    : 0;

  const priorityB = Number.isFinite(b.priorityScore)
    ? b.priorityScore
    : 0;

  if (priorityA !== priorityB) {
    return priorityB - priorityA;
  }

  const deadlineA =
    typeof a.deadline === 'string' && a.deadline
      ? Date.parse(a.deadline)
      : Infinity;

  const deadlineB =
    typeof b.deadline === 'string' && b.deadline
      ? Date.parse(b.deadline)
      : Infinity;

  const normalizedDeadlineA =
    Number.isFinite(deadlineA) ? deadlineA : Infinity;

  const normalizedDeadlineB =
    Number.isFinite(deadlineB) ? deadlineB : Infinity;

  if (normalizedDeadlineA !== normalizedDeadlineB) {
    return normalizedDeadlineA - normalizedDeadlineB;
  }

  const sequenceA = Number.isFinite(a.sequence)
    ? a.sequence
    : Number.MAX_SAFE_INTEGER;

  const sequenceB = Number.isFinite(b.sequence)
    ? b.sequence
    : Number.MAX_SAFE_INTEGER;

  if (sequenceA !== sequenceB) {
    return sequenceA - sequenceB;
  }

  const projectCompare =
    String(a.projectId).localeCompare(String(b.projectId));

  if (projectCompare !== 0) {
    return projectCompare;
  }

  return String(a.taskId).localeCompare(String(b.taskId));
}

function collectProjectQueueItems(projectResults) {
  const collected = [];

  for (const result of projectResults) {
    if (!result || result.ok !== true) continue;

    const queue = Array.isArray(result.queue)
      ? result.queue
      : [];

    for (const item of queue) {
      collected.push(item);
    }
  }

  return collected;
}

function buildMultiProjectQueue(projectResults = []) {
  if (!Array.isArray(projectResults)) {
    throw new Error('projectResults must be an array');
  }

  const rawItems = collectProjectQueueItems(projectResults);

  const unique = new Map();

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.taskId !== 'string') continue;

    if (!unique.has(item.taskId)) {
      unique.set(item.taskId, item);
    }
  }

  const sorted = [...unique.values()]
    .sort(compareGlobalQueueItems);

  return sorted.map((item, index) =>
    createCoordinatorItem(item, index + 1)
  );
}

function coordinateProjectQueues(projectResults = []) {
  if (!Array.isArray(projectResults)) {
    throw new Error('projectResults must be an array');
  }

  const items = buildMultiProjectQueue(projectResults);

  const projectsWithItems =
    projectResults.filter(
      result =>
        result &&
        result.ok === true &&
        Array.isArray(result.queue) &&
        result.queue.length > 0
    ).length;

  let status = 'ready';

  if (items.length === 0) {
    status = 'empty';
  } else if (
    items.every(item => item.dependencyBlocked === true)
  ) {
    status = 'blocked';
  }

  return createCoordinatorResult({
    projectCount: projectResults.length,
    projectsWithItems,
    items,
    status
  });
}

module.exports = {
  compareGlobalQueueItems,
  collectProjectQueueItems,
  buildMultiProjectQueue,
  coordinateProjectQueues
};
