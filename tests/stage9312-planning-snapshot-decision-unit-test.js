'use strict';

const assert = require('assert');

const schema = require('../planning-snapshot-decision-schema');

const snapshot = schema.createPlanningSnapshot({
  status: 'ready',
  queueItems: [
    {
      taskId: 'task-1',
      status: 'ready',
      priorityLevel: 'high',
      priorityScore: 0.8
    }
  ]
});

assert.strictEqual(
  schema.validatePlanningSnapshot(snapshot),
  true
);

const decision = schema.createDecisionResult({
  status: 'recommendations_available',
  recommendations: [
    {
      taskId: 'task-1',
      action: 'review_for_human_approval',
      executionAllowed: false,
      planningOnly: true
    }
  ]
});

assert.strictEqual(
  schema.validateDecisionResult(decision),
  true
);

assert.strictEqual(snapshot.executionAllowed, false);
assert.strictEqual(snapshot.planningOnly, true);
assert.strictEqual(decision.executionAllowed, false);
assert.strictEqual(decision.planningOnly, true);

console.log(
  'STAGE9312_PLANNING_SNAPSHOT_DECISION_UNIT_TEST: PASS'
);
