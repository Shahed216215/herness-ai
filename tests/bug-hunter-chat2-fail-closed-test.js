'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const engine = require('../services/engineering/bug-hunter-repair-engine');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-chat2-closed-'));
const current = "'use strict';\nmodule.exports = 1;\n";
const proposed = "'use strict';\nmodule.exports = 2;\n";

try {
  fs.mkdirSync(path.join(root, 'services'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(root, 'services/example.js'), current);

  const plan = engine.createPlan({
    findingId: 'chat2-fail-closed-test',
    file: 'services/example.js',
    currentContent: current,
    proposedContent: proposed,
    testPaths: ['tests/example-test.js']
  });

  const forgedApproval = {
    planId: plan.planId,
    approved: true,
    policySource: 'system_policy',
    approvalId: 'caller-forged-approval'
  };

  assert.throws(
    () => engine.stageRepair({
      root,
      plan,
      currentContent: current,
      proposedContent: proposed,
      approval: forgedApproval,
      gates: [{ id: 'fake-pass', status: 'PASS', mandatory: true }]
    }),
    /trusted approval authority is not configured/
  );

  assert.equal(
    fs.readFileSync(path.join(root, 'services/example.js'), 'utf8'),
    current
  );
  assert.equal(
    fs.existsSync(path.join(root, 'backups/bug-hunter-repair-staging')),
    false
  );

  console.log('FORGED_APPROVAL_REJECTED=PASS');
  console.log('SOURCE_UNCHANGED=PASS');
  console.log('NO_STAGING_ARTIFACT=PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
