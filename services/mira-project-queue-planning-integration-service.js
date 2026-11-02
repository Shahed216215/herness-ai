'use strict';

const {
  listProjects
} = require('../project-store');

const {
  buildProjectScopedMultiProjectQueue
} = require('./mira-multi-project-queue-coordinator-service');

const {
  buildConsistentProjectScopedQueue
} = require('./mira-project-queue-consistency-service');

const {
  buildProjectQueueLifecycle
} = require('./mira-project-queue-lifecycle-service');

const {
  createPlanningIntegrationResult,
  validatePlanningIntegrationResult
} = require('../queue-planning-integration-schema');

function buildProjectQueuePlanningIntegration({
  projectId,
  now = new Date()
} = {}) {
  if (
    typeof projectId !== 'string' ||
    projectId.length === 0
  ) {
    return {
      ok: false,
      status: 'invalid_project_id'
    };
  }

  const projects = listProjects();

  const project =
    projects.find(
      item => item && item.projectId === projectId
    );

  if (!project) {
    return {
      ok: false,
      status: 'not_found',
      projectId
    };
  }

  const coordinated =
    buildProjectScopedMultiProjectQueue({
      projectIds: [projectId],
      now
    });

  if (!coordinated || coordinated.ok !== true) {
    return {
      ok: false,
      status: 'error',
      projectId
    };
  }

  const consistent =
    buildConsistentProjectScopedQueue({
      projectIds: [projectId],
      now
    });

  if (!consistent || consistent.ok !== true) {
    return {
      ok: false,
      status: 'inconsistent',
      projectId,
      queue: coordinated.items || []
    };
  }

  const lifecycle =
    buildProjectQueueLifecycle({
      projectId,
      now
    });

  const queue =
    Array.isArray(consistent.queue)
      ? consistent.queue
      : [];

  const result =
    createPlanningIntegrationResult({
      status:
        queue.length === 0
          ? 'empty'
          : 'ready',
      projectCount: 1,
      projectsWithItems:
        queue.length > 0 ? 1 : 0,
      taskCount: new Set(
        queue.map(item => item.taskId)
      ).size,
      queue,
      lifecycle:
        Array.isArray(lifecycle)
          ? lifecycle
          : (
              lifecycle &&
              Array.isArray(lifecycle.items)
                ? lifecycle.items
                : []
            ),
      consistency: consistent
    });

  if (!validatePlanningIntegrationResult(result)) {
    throw new Error(
      'INVALID_PROJECT_PLANNING_INTEGRATION_RESULT'
    );
  }

  return {
    ...result,
    projectId
  };
}

function buildAllProjectQueuePlanningIntegrations({
  now = new Date()
} = {}) {
  const projects = listProjects();

  const results =
    projects.map(project =>
      buildProjectQueuePlanningIntegration({
        projectId: project.projectId,
        now
      })
    );

  return {
    ok: true,
    projectCount: projects.length,
    results,
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };
}

module.exports = {
  buildProjectQueuePlanningIntegration,
  buildAllProjectQueuePlanningIntegrations
};
