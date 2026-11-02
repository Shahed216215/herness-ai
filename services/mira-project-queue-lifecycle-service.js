'use strict';

const {
  listProjects
} = require('../project-store');

const {
  buildProjectExecutionQueue
} = require('./mira-project-execution-queue-service');

const {
  evaluateQueueLifecycle
} = require('./mira-queue-lifecycle-engine');

function buildProjectQueueLifecycle({
  projectId,
  now = new Date()
} = {}) {
  const project = listProjects().find(
    item => item.projectId === projectId
  );

  if (!project) {
    return {
      ok: false,
      status: 'not_found',
      projectId,
      lifecycle: null
    };
  }

  const queueResult =
    buildProjectExecutionQueue({
      projectId,
      now
    });

  if (!queueResult.ok) {
    return {
      ok: false,
      status: queueResult.status,
      projectId,
      lifecycle: null
    };
  }

  const lifecycle =
    evaluateQueueLifecycle(
      queueResult.queue,
      now
    );

  return {
    ok: true,
    status: 'ok',
    projectId,
    projectStatus: queueResult.projectStatus,
    taskCount: queueResult.taskCount,
    queue: queueResult.queue,
    lifecycle,
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };
}

function buildAllProjectQueueLifecycles({
  now = new Date()
} = {}) {
  return listProjects().map(project =>
    buildProjectQueueLifecycle({
      projectId: project.projectId,
      now
    })
  );
}

module.exports = {
  buildProjectQueueLifecycle,
  buildAllProjectQueueLifecycles
};
