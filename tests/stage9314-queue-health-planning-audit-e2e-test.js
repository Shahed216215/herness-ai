'use strict';

const assert = require('assert');

const {
  getQueueHealthPlanningAudit
} = require('../services/mira-project-queue-health-planning-audit-service');

const result = getQueueHealthPlanningAudit({
  now: new Date()
});

assert(result);
assert.strictEqual(typeof result, 'object');

assert(
  ['empty', 'audited'].includes(result.status)
);

assert(
  ['healthy', 'warning', 'unhealthy'].includes(result.health)
);

assert(Number.isInteger(result.projectCount));
assert(Number.isInteger(result.projectsWithItems));
assert(Number.isInteger(result.taskCount));

assert(Array.isArray(result.issues));
assert(result.metrics);
assert.strictEqual(typeof result.metrics.totalItems, 'number');
assert.strictEqual(typeof result.metrics.uniqueTaskIds, 'number');
assert.strictEqual(
  result.metrics.uniqueTaskIds,
  result.taskCount
);

assert.strictEqual(
  result.safety.executionAllowed,
  false
);

assert.strictEqual(
  result.safety.planningOnly,
  true
);

assert.strictEqual(
  result.safety.externalActionPerformed,
  false
);

assert.strictEqual(
  result.safety.paymentAllowed,
  false
);

assert.strictEqual(
  result.safety.paymentTransferAuthorized,
  false
);

assert.strictEqual(
  result.safety.contractSigningAllowed,
  false
);

console.log(
  'STAGE9314_QUEUE_HEALTH_PLANNING_AUDIT_E2E_TEST: PASS'
);
console.log(
  `PROJECTS_CHECKED: ${result.projectCount}`
);
console.log(
  `TASKS_CHECKED: ${result.taskCount}`
);
console.log(
  `QUEUE_ITEMS: ${result.metrics.totalItems}`
);
console.log(
  `HEALTH: ${result.health}`
);
console.log(
  `ISSUES: ${result.issues.length}`
);
