'use strict';

const assert = require('assert');

const {
  buildCrossProjectPlanningOptimization
} = require('../services/mira-cross-project-planning-optimization-engine');

const {
  buildProjectCrossProjectOptimization
} = require('../services/mira-project-cross-project-planning-optimization-service');

const now = new Date();

const result =
  buildCrossProjectPlanningOptimization({ now });

assert.strictEqual(result.executionAllowed, false);
assert.strictEqual(result.planningOnly, true);
assert.strictEqual(result.externalActionPerformed, false);

assert.ok(result.projectCount >= 0);
assert.ok(result.taskCount >= 0);
assert.ok(Array.isArray(result.optimizedQueue));
assert.ok(Array.isArray(result.projectSummary));
assert.ok(Array.isArray(result.conflicts));

for (let i = 1; i < result.optimizedQueue.length; i += 1) {
  assert.strictEqual(
    result.optimizedQueue[i].optimizedPosition,
    i + 1
  );
}

if (result.optimizedQueue.length > 0) {
  const projectId =
    result.optimizedQueue[0].projectId;

  const scoped =
    buildProjectCrossProjectOptimization({
      projectId,
      now
    });

  assert.strictEqual(
    scoped.projectId,
    projectId
  );

  assert.ok(
    scoped.optimizedQueue.every(
      item => item.projectId === projectId
    )
  );
}

console.log(
  'PROJECTS_CHECKED:',
  result.projectCount
);
console.log(
  'OPTIMIZED_QUEUE_ITEMS:',
  result.optimizedQueue.length
);
console.log(
  'PROJECT_SUMMARIES:',
  result.projectSummary.length
);
console.log(
  'CONFLICTS:',
  result.conflicts.length
);
console.log(
  'CROSS_PROJECT_OPTIMIZATION: PASS'
);
console.log(
  'STAGE9313_CROSS_PROJECT_PLANNING_OPTIMIZATION_E2E_TEST: PASS'
);
