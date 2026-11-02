'use strict';

const {
  buildCrossProjectPlanningOptimization
} = require('./mira-cross-project-planning-optimization-engine');

function buildProjectCrossProjectOptimization({
  projectId,
  now = new Date()
} = {}) {
  if (!projectId) {
    throw new Error('PROJECT_ID_REQUIRED');
  }

  const result =
    buildCrossProjectPlanningOptimization({ now });

  const optimizedQueue =
    result.optimizedQueue.filter(
      item => item && item.projectId === projectId
    );

  return {
    ...result,
    projectId,
    optimizedQueue,
    taskCount: optimizedQueue.length,
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false
  };
}

module.exports = {
  buildProjectCrossProjectOptimization
};
