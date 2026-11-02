'use strict';

const {
  createPlanningIntegrationResult,
  validatePlanningIntegrationResult
} = require('../queue-planning-integration-schema');

const {
  buildMultiProjectQueue
} = require('./mira-multi-project-queue-coordinator-service');

const {
  buildConsistentMultiProjectQueue
} = require('./mira-project-queue-consistency-service');

const {
  buildAllProjectQueueLifecycles
} = require('./mira-project-queue-lifecycle-service');

function uniqueTaskCount(items) {
  return new Set(
    items
      .filter(item => item && typeof item === 'object')
      .map(item => item.taskId)
      .filter(Boolean)
  ).size;
}

function normalizeLifecycleResult(result) {
  if (!result) return [];

  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result.lifecycle)) {
    return result.lifecycle;
  }

  if (Array.isArray(result.records)) {
    return result.records;
  }

  if (Array.isArray(result.items)) {
    return result.items;
  }

  return [];
}

function buildQueuePlanningIntegration({
  now = new Date()
} = {}) {
  const coordinated = buildMultiProjectQueue({ now });

  if (!coordinated || coordinated.ok !== true) {
    return createPlanningIntegrationResult({
      status: 'error'
    });
  }

  const consistent =
    buildConsistentMultiProjectQueue({ now });

  if (!consistent || consistent.ok !== true) {
    return createPlanningIntegrationResult({
      status: 'inconsistent',
      projectCount: coordinated.projectCount || 0,
      projectsWithItems: coordinated.projectsWithItems || 0,
      queue: coordinated.items || []
    });
  }

  const lifecycleResult =
    buildAllProjectQueueLifecycles({ now });

  const lifecycle =
    normalizeLifecycleResult(lifecycleResult);

  const queue =
    Array.isArray(consistent.queue)
      ? consistent.queue
      : [];

  const taskCount =
    uniqueTaskCount(queue);

  const status =
    queue.length === 0
      ? 'empty'
      : 'ready';

  const result =
    createPlanningIntegrationResult({
      status,
      projectCount:
        coordinated.projectCount || 0,
      projectsWithItems:
        coordinated.projectsWithItems || 0,
      taskCount,
      queue,
      lifecycle,
      consistency: consistent
    });

  if (!validatePlanningIntegrationResult(result)) {
    throw new Error(
      'INVALID_PLANNING_INTEGRATION_RESULT'
    );
  }

  return result;
}

function getPlanningQueue({
  now = new Date()
} = {}) {
  return buildQueuePlanningIntegration({ now });
}

module.exports = {
  buildQueuePlanningIntegration,
  getPlanningQueue
};
