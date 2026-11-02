'use strict';

const {
  listProjects
} = require('../project-store');

const {
  buildProjectPriorityQueue
} = require('./mira-project-priority-service');

const {
  buildExecutionQueue,
  getQueueSummary
} = require('./mira-execution-queue-engine');

function buildProjectExecutionQueue({
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
      queue: []
    };
  }

  const priorityResult =
    buildProjectPriorityQueue({
      projectId,
      now
    });

  if (!priorityResult.ok) {
    return {
      ok: false,
      status: priorityResult.status,
      projectId,
      queue: []
    };
  }

  const queue =
    buildExecutionQueue(priorityResult.queue);

  return {
    ok: true,
    status: 'ok',
    projectId,
    projectStatus: project.status,
    taskCount: priorityResult.taskCount,
    queue,
    summary: getQueueSummary(queue),
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };
}

function buildAllProjectExecutionQueues({
  now = new Date()
} = {}) {
  return listProjects().map(project =>
    buildProjectExecutionQueue({
      projectId: project.projectId,
      now
    })
  );
}

module.exports = {
  buildProjectExecutionQueue,
  buildAllProjectExecutionQueues
};
