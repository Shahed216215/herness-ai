'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const engine = require('../services/engineering/bug-hunter-repair-engine');

const current = "'use strict';\\nmodule.exports = 1;\\n";
const proposed = "'use strict';\\nmodule.exports = 2;\\n";
const plan = engine.createPlan({
  findingId: 'chat2-fail-closed-atomic_staging',
  file: 'services/example.js',
  currentContent: current,
  proposedContent: proposed,
  testPaths: ['tests/example-test.js']
});

assert.equal(engine.verifyPlan(plan), true);
assert.equal(plan.productionApplyAllowed, false);
assert.equal(engine.safeRelativePath('../outside.js'), false);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-chat2-closed-'));
try {
  fs.mkdirSync(path.join(root, 'services'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, plan.file), current);

  const approval = {
    planId: plan.planId,
    approved: true,
    policySource: 'system_policy',
    approvalId: 'caller-forged-test-approval'
  };

  assert.throws(() => engine.stageRepair({
    root, plan, currentContent: current, proposedContent: proposed,
    approval, gates: [{ id: 'claimed-pass', status: 'PASS', mandatory: true }]
  }), /trusted approval authority is not configured/);

  assert.equal(fs.readFileSync(path.join(root, plan.file), 'utf8'), current);
  assert.equal(
    fs.existsSync(path.join(root, 'backups/bug-hunter-repair-staging')),
    false
  );

  console.log('ATOMIC_STAGING_PLAN_VALIDATION=PASS');
  console.log('ATOMIC_STAGING_FORGED_APPROVAL_BLOCK=PASS');
  console.log('ATOMIC_STAGING_SOURCE_UNCHANGED=PASS');
  console.log('ATOMIC_STAGING_NO_STAGING_ARTIFACT=PASS');
  console.log('ATOMIC_STAGING_FAIL_CLOSED_TEST=PASS');
  console.log('ATOMIC_STAGING_INTERNALS=NOT_TESTED_STAGING_DISABLED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
