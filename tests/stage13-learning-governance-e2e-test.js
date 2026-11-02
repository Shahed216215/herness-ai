'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-stage13-e2e-'));
const fixtures = [
  path.join(__dirname, `stage13-fixture-pass-${process.pid}.js`),
  path.join(__dirname, `stage13-fixture-fail-${process.pid}.js`)
];
process.env.MIRA_STAGE13_STORE = path.join(temp, 'store.json');

const engine = require('../services/mira-stage13-learning-governance');
const relative = file => path.relative(root, file).split(path.sep).join('/');

try {
  fs.writeFileSync(fixtures[0], "process.exitCode = 0;\n", { flag: 'wx' });
  fs.writeFileSync(fixtures[1], "process.exitCode = 7;\n", { flag: 'wx' });

  const feedback = engine.recordFeedback({
    clientFeedback: 'A required section was missing.',
    errorAnalysis: 'No final checklist was used.',
    lesson: 'Compare every requested section.',
    improvementProposal: 'Add a mandatory checklist.'
  });
  assert.strictEqual(feedback.autoApplied, false);
  assert.strictEqual(feedback.approvalRequired, true);

  const failed = engine.recordFailure({
    failure: 'Regression occurred.', rootCause: 'Missing validation.',
    correction: 'Add validation.', testCase: 'Execute regression test.',
    preventionKnowledge: 'Require actual passing tests.',
    testPassed: true, testFile: relative(fixtures[1])
  });
  assert.strictEqual(failed.testPassed, false, 'Caller boolean must not override actual failure');
  assert.strictEqual(failed.testExecution.exitCode, 7);

  const passed = engine.recordFailure({
    failure: 'Previous regression.', rootCause: 'Missing validation.',
    correction: 'Add validation.', testCase: 'Execute fixed test.',
    preventionKnowledge: 'Run the test before delivery.',
    testFile: relative(fixtures[0])
  });
  assert.strictEqual(passed.testPassed, true);
  assert.strictEqual(passed.testExecution.exitCode, 0);

  const benchmark = engine.recordBenchmark({
    skill: 'test-execution',
    tests: [
      { name: 'passing check', testFile: relative(fixtures[0]) },
      { name: 'failing check', testFile: relative(fixtures[1]) }
    ],
    minimumScore: 0.5,
    evidenceReference: 'local-e2e-execution'
  });
  assert.strictEqual(benchmark.score, 0.5);
  assert.strictEqual(benchmark.criteriaMet, false);
  assert.strictEqual(benchmark.capabilityClaimAllowed, false);
  assert.strictEqual(benchmark.expertClaimAllowed, false);

  assert.throws(() => engine.recordFailure({
    failure: 'x', rootCause: 'x', correction: 'x', testCase: 'x',
    preventionKnowledge: 'x', testPassed: true
  }), /testFile_required/);

  const beforeTamper = engine.verifyIntegrity();
  assert.strictEqual(beforeTamper.ok, true, JSON.stringify(beforeTamper));

  const store = engine.loadStore();
  store.feedback[0].lesson = 'TAMPERED CONTENT';
  engine.saveStore(store);
  const afterTamper = engine.verifyIntegrity();
  assert.strictEqual(afterTamper.ok, false, 'Record content tampering must be detected');
  assert(afterTamper.failures.some(f => f.reason === 'record_content_hash_mismatch'));

  console.log('PASS Feedback remains approval-gated');
  console.log('PASS Failure status derives from actual test execution');
  console.log('PASS Benchmark executes tests and failed test blocks capability claim');
  console.log('PASS Record-content tampering detected');
  console.log('STAGE13_LEARNING_GOVERNANCE_E2E_TEST: PASS');
} catch (error) {
  console.error('STAGE13_LEARNING_GOVERNANCE_E2E_TEST: FAIL');
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  for (const file of fixtures) {
    try { fs.unlinkSync(file); } catch {}
  }
  fs.rmSync(temp, { recursive: true, force: true });
}
