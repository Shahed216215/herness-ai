'use strict';

const {
  buildPlanningSnapshot,
  buildPlanningDecisionLayer
} = require('./mira-planning-snapshot-decision-engine');

function filterByProject(items, projectId) {
  return items.filter(
    item => item && item.projectId === projectId
  );
}

function buildProjectPlanningSnapshot({
  projectId,
  now = new Date()
} = {}) {
  if (!projectId) {
    throw new Error('PROJECT_ID_REQUIRED');
  }

  const snapshot = buildPlanningSnapshot({ now });
  const queueItems = filterByProject(
    snapshot.queueItems,
    projectId
  );

  return {
    ...snapshot,
    projectId,
    queueItems,
    taskCount: queueItems.length,
    status: queueItems.length > 0 ? 'ready' : 'empty',
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false
  };
}

function buildProjectPlanningDecision({
  projectId,
  now = new Date()
} = {}) {
  if (!projectId) {
    throw new Error('PROJECT_ID_REQUIRED');
  }

  const decision = buildPlanningDecisionLayer({ now });

  return {
    ...decision,
    projectId,
    recommendations: decision.recommendations.filter(
      item => item.projectId === projectId
    ),
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false
  };
}

module.exports = {
  buildProjectPlanningSnapshot,
  buildProjectPlanningDecision
};
