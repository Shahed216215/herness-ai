'use strict';

const assert = require('assert');

const {
  buildPlanningSnapshot,
  buildPlanningDecisionLayer
} = require('../services/mira-planning-snapshot-decision-engine');

const {
  buildProjectPlanningSnapshot,
  buildProjectPlanningDecision
} = require('../services/mira-project-planning-snapshot-decision-service');

const now = new Date();

const snapshot = buildPlanningSnapshot({ now });

assert.strictEqual(snapshot.executionAllowed, false);
assert.strictEqual(snapshot.planningOnly, true);
assert.strictEqual(snapshot.externalActionPerformed, false);
assert.ok(snapshot.projectCount >= 0);
assert.ok(snapshot.taskCount >= 0);
assert.ok(Array.isArray(snapshot.queueItems));
assert.ok(snapshot.summary);

const decision = buildPlanningDecisionLayer({ now });

assert.strictEqual(decision.executionAllowed, false);
assert.strictEqual(decision.planningOnly, true);
assert.strictEqual(decision.externalActionPerformed, false);
assert.ok(Array.isArray(decision.recommendations));

const projectId =
  snapshot.queueItems.length > 0
    ? snapshot.queueItems[0].projectId
    : null;

if (projectId) {
  const projectSnapshot =
    buildProjectPlanningSnapshot({
      projectId,
      now
    });

  const projectDecision =
    buildProjectPlanningDecision({
      projectId,
      now
    });

  assert.strictEqual(projectSnapshot.projectId, projectId);
  assert.ok(
    projectSnapshot.queueItems.every(
      item => item.projectId === projectId
    )
  );

  assert.ok(
    projectDecision.recommendations.every(
      item => item.projectId === projectId
    )
  );
}

console.log(
  'PROJECTS_CHECKED:',
  snapshot.projectCount
);
console.log(
  'TASKS_CHECKED:',
  snapshot.taskCount
);
console.log(
  'RECOMMENDATIONS:',
  decision.recommendations.length
);
console.log(
  'PLANNING_SNAPSHOT: PASS'
);
console.log(
  'DECISION_LAYER: PASS'
);
console.log(
  'STAGE9312_PLANNING_SNAPSHOT_DECISION_E2E_TEST: PASS'
);
