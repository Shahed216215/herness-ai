'use strict';

const {
  listProjects
} = require('../project-store');

const {
  buildMultiProjectQueue,
  buildProjectScopedMultiProjectQueue
} = require('./mira-multi-project-queue-coordinator-service');

const {
  checkAndRebuildQueue
} = require('./mira-queue-consistency-engine');

function buildConsistentMultiProjectQueue({
  now = new Date()
} = {}) {
  const coordinated =
    buildMultiProjectQueue({ now });

  if (!coordinated.ok) {
    return {
      ok: false,
      status: coordinated.status,
      queue: []
    };
  }

  const projects = listProjects();

  const result =
    checkAndRebuildQueue({
      items: coordinated.items,
      projectIds: projects.map(
        project => project.projectId
      )
    });

  return {
    ...result,
    projectCount: coordinated.projectCount,
    projectsWithItems: coordinated.projectsWithItems,
    projectResults: coordinated.projectResults
  };
}

function buildConsistentProjectScopedQueue({
  projectIds = [],
  now = new Date()
} = {}) {
  const coordinated =
    buildProjectScopedMultiProjectQueue({
      projectIds,
      now
    });

  if (!coordinated.ok) {
    return {
      ...coordinated,
      queue: []
    };
  }

  const result =
    checkAndRebuildQueue({
      items: coordinated.items,
      projectIds
    });

  return {
    ...result,
    projectIds: [...projectIds]
  };
}

function auditAllProjectsQueueConsistency({
  now = new Date()
} = {}) {
  const projects = listProjects();

  const records = [];

  for (const project of projects) {
    const result =
      buildConsistentProjectScopedQueue({
        projectIds: [project.projectId],
        now
      });

    records.push({
      projectId: project.projectId,
      ok: result.ok,
      status: result.status,
      checkedItems:
        result.consistency
          ? result.consistency.checkedItems
          : 0,
      issueCount:
        result.consistency
          ? result.consistency.issueCount
          : 0,
      rebuilt: result.rebuilt === true,
      executionAllowed: false,
      planningOnly: true
    });
  }

  return {
    ok: records.every(record => record.ok),
    status: records.every(
      record => record.status === 'consistent' ||
                record.status === 'rebuilt' ||
                record.status === 'empty'
    )
      ? 'ok'
      : 'inconsistent',
    projectCount: records.length,
    records,
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };
}

module.exports = {
  buildConsistentMultiProjectQueue,
  buildConsistentProjectScopedQueue,
  auditAllProjectsQueueConsistency
};
