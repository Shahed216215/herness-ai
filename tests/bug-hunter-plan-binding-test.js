'use strict';
const assert = require('node:assert/strict');
const { createRepairPlan } =
  require('../services/engineering/bug-hunter-orchestrator');

const base = {
  id: 'binding-test',
  file: 'services/example.js',
  title: 'Example repair',
  testPaths: ['tests/example-test.js'],
  proposedChange: 'return 1;'
};

const first = createRepairPlan(base);
const repeat = createRepairPlan({ ...base });
const changed = createRepairPlan({ ...base, proposedChange: 'return 2;' });
const empty = createRepairPlan({ ...base, proposedChange: '' });

assert.equal(first.planId, repeat.planId);
assert.notEqual(first.planId, changed.planId);
assert.notEqual(first.planId, empty.planId);
assert.equal(first.evidence.proposedChangeHash.length, 64);
assert.notEqual(
  first.evidence.proposedChangeHash,
  changed.evidence.proposedChangeHash
);
assert.equal(first.mayApply, false);
assert.equal(first.status, 'PROPOSAL_ONLY');
assert.throws(
  () => createRepairPlan({ ...base, proposedChange: { patch: 'unsafe' } }),
  /proposedChange must be a string/
);

console.log('BUG_HUNTER_PLAN_BINDING_TEST=PASS');
console.log('ASSERTIONS=8');
