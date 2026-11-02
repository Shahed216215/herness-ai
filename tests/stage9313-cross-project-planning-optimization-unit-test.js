'use strict';

const assert = require('assert');

const {
  createOptimizationResult,
  validateOptimizationResult
} = require('../cross-project-planning-optimization-schema');

const result = createOptimizationResult({
  status: 'optimized',
  optimizedQueue: [
    {
      taskId: 'task-1',
      projectId: 'project-1'
    }
  ],
  projectSummary: [],
  conflicts: []
});

assert.strictEqual(
  validateOptimizationResult(result),
  true
);

assert.strictEqual(result.executionAllowed, false);
assert.strictEqual(result.planningOnly, true);
assert.strictEqual(result.externalActionPerformed, false);

console.log(
  'STAGE9313_CROSS_PROJECT_PLANNING_OPTIMIZATION_UNIT_TEST: PASS'
);
