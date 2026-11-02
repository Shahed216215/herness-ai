'use strict';

const {
  listProjects
} = require('../project-store');

const {
  buildAllProjectExecutionQueues
} = require('./mira-project-execution-queue-service');

const {
  buildProjectExecutionQueue
} = require('./mira-project-execution-queue-service');

const {
  coordinateProjectQueues
} = require('./mira-multi-project-queue-coordinator');

function buildMultiProjectQueue({
  now = new Date()
} = {}) {
  const projectResults =
    buildAllProjectExecutionQueues({ now });

  const coordinated =
    coordinateProjectQueues(projectResults);

  return {
    ...coordinated,
    projectResults
  };
}

function buildProjectScopedMultiProjectQueue({
  projectIds = [],
  now = new Date()
} = {}) {
  if (!Array.isArray(projectIds)) {
    return {
      ok: false,
      status: 'invalid_project_ids',
      items: []
    };
  }

  const projects = listProjects();

  const selected = [];

  for (const projectId of projectIds) {
    const exists = projects.some(
      project => project.projectId === projectId
    );

    if (!exists) {
      return {
        ok: false,
        status: 'not_found',
        projectId,
        items: []
      };
    }

    selected.push(
      buildProjectExecutionQueue({
        projectId,
        now
      })
    );
  }

  return coordinateProjectQueues(selected);
}

module.exports = {
  buildMultiProjectQueue,
  buildProjectScopedMultiProjectQueue
};
