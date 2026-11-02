'use strict';
const assert = require('node:assert/strict');
const {
  safeRelativePath, createRepairPlan, verifyApproval
} = require('../services/engineering/bug-hunter-orchestrator');

assert.equal(safeRelativePath('services/example.js'), true);
for (const p of ['../server.js', '/etc/passwd', '.env', '.env.local',
  'secrets/token.txt', 'credentials/key.json', 'backups/a.js',
  'node_modules/a.js', 'x.pem', 'x.key', 'a\\b.js', '']) {
  assert.equal(safeRelativePath(p), false, `must reject ${p}`);
}
const input = {
  id: 'BH-1', file: 'services/example.js',
  title: 'Example finding', testPaths: ['tests/example-test.js']
};
const plan = createRepairPlan(input);
assert.equal(plan.status, 'PROPOSAL_ONLY');
assert.equal(plan.mode, 'PREVIEW_ONLY');
assert.equal(plan.approvalRequired, true);
assert.equal(plan.mayApply, false);
assert.equal(plan.planId, createRepairPlan(input).planId);
assert.throws(() => createRepairPlan({ file: '../unsafe.js' }));
assert.throws(() => createRepairPlan({
  file: 'services/example.js', testPaths: ['../../unsafe.js']
}));
assert.equal(verifyApproval(plan, null).status, 'APPROVAL_REJECTED');
assert.equal(verifyApproval(plan, {
  planId: plan.planId, approved: true,
  policySource: 'model', approvalId: 'x'
}).status, 'APPROVAL_REJECTED');
const result = verifyApproval(plan, {
  planId: plan.planId, approved: true,
  policySource: 'system_policy', approvalId: 'approval-test-1'
});
assert.equal(result.status, 'APPROVAL_VERIFIED');
assert.equal(result.mayApply, false);
console.log('BUG_HUNTER_ORCHESTRATOR_TEST=PASS');
