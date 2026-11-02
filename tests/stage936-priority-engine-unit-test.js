'use strict';

const assert = require('assert');

const {
  PRIORITY_WEIGHTS,
  calculatePriorityScore,
  validatePriorityRecord
} = require('../priority-schema');

const {
  calculateUrgencyScore,
  calculateEffortScore,
  calculateRiskScore,
  calculateDependencyState,
  analyzeTaskPriority,
  rankPriorityRecords
} = require('../services/mira-deadline-priority-engine');

const NOW = new Date('2026-10-08T12:00:00Z');

assert.ok(
  Math.abs(
    Object.values(PRIORITY_WEIGHTS)
      .reduce((a, b) => a + b, 0) - 1
  ) < 1e-9
);

assert.strictEqual(
  calculateUrgencyScore('today', NOW),
  0.75
);

assert.strictEqual(
  calculateUrgencyScore('tomorrow', NOW),
  0.50
);

assert.strictEqual(
  calculateUrgencyScore('2026-10-07T12:00:00Z', NOW),
  1
);

assert.strictEqual(
  calculateUrgencyScore('', NOW),
  0
);

assert.strictEqual(
  calculateEffortScore({ difficulty: 'easy' }),
  0.25
);

assert.strictEqual(
  calculateEffortScore({ difficulty: 'expert' }),
  1
);

assert.strictEqual(
  calculateRiskScore({ risk: 'low' }),
  0
);

assert.strictEqual(
  calculateRiskScore({ risk: 'critical' }),
  1
);

assert.deepStrictEqual(
  calculateDependencyState({
    dependencies: [],
    knownSubtaskIds: []
  }),
  {
    dependencyScore: 1,
    dependencyBlocked: false,
    unresolvedDependencies: []
  }
);

assert.deepStrictEqual(
  calculateDependencyState({
    dependencies: ['subtask-a'],
    knownSubtaskIds: ['subtask-a']
  }),
  {
    dependencyScore: 0.75,
    dependencyBlocked: false,
    unresolvedDependencies: []
  }
);

assert.deepStrictEqual(
  calculateDependencyState({
    dependencies: ['unknown-subtask'],
    knownSubtaskIds: []
  }),
  {
    dependencyScore: 0,
    dependencyBlocked: true,
    unresolvedDependencies: ['unknown-subtask']
  }
);

const record = analyzeTaskPriority({
  task: {
    id: 'unit-task',
    deadline: 'tomorrow',
    difficulty: 'medium',
    risk: 'low'
  },
  projectId: 'unit-project',
  planId: 'unit-plan',
  dependencies: [],
  sequence: 1,
  now: NOW
});

assert.strictEqual(record.taskId, 'unit-task');
assert.strictEqual(record.urgencyScore, 0.5);
assert.strictEqual(record.effortScore, 0.5);
assert.strictEqual(record.dependencyScore, 1);
assert.strictEqual(record.riskScore, 0);
assert.strictEqual(record.priorityScore, 0.55);
assert.strictEqual(record.priority, 'medium');

assert.strictEqual(
  validatePriorityRecord(record),
  true
);

const blocked = analyzeTaskPriority({
  task: {
    id: 'blocked-task',
    deadline: 'today',
    difficulty: 'expert',
    risk: 'critical'
  },
  projectId: 'unit-project',
  dependencies: ['missing'],
  knownSubtaskIds: [],
  now: NOW
});

assert.strictEqual(blocked.dependencyBlocked, true);
assert.strictEqual(blocked.dependencyScore, 0);

const ranked = rankPriorityRecords([
  blocked,
  record
]);

assert.strictEqual(
  ranked[0].dependencyBlocked,
  false
);

assert.strictEqual(
  ranked[1].dependencyBlocked,
  true
);

for (const item of ranked) {
  assert.strictEqual(item.executionAllowed, false);
  assert.strictEqual(item.planningOnly, true);
  assert.strictEqual(item.externalActionPerformed, false);
  assert.strictEqual(item.paymentAllowed, false);
  assert.strictEqual(item.paymentTransferAuthorized, false);
  assert.strictEqual(item.contractSigningAllowed, false);
}

console.log('STAGE936_PRIORITY_ENGINE_UNIT_TEST: PASS');
