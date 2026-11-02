'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-stage13-hardening-'));
const suffix = `${process.pid}-${Date.now()}`;
const passFixture = path.join(__dirname, `.stage13-hardening-pass-${suffix}.js`);
const failFixture = path.join(__dirname, `.stage13-hardening-fail-${suffix}.js`);

process.env.MIRA_STAGE13_STORE = path.join(tempDir, 'store.json');

const relative = file => path.relative(projectRoot, file).split(path.sep).join('/');
const engine = require('../services/mira-stage13-learning-governance');

try {
  fs.writeFileSync(passFixture, "console.log('fixture-pass');\n", { flag: 'wx' });
  fs.writeFileSync(failFixture, "console.log('fixture-fail'); process.exit(7);\n", { flag: 'wx' });

  const feedback = engine.recordFeedback({
    clientFeedback: 'A required section was missing.',
    errorAnalysis: 'No final requirements checklist was used.',
    lesson: 'Compare every requested section before delivery.',
    improvementProposal: 'Add a mandatory requirements checklist.'
  });
  assert.strictEqual(feedback.approvalRequired, true);
  assert.strictEqual(feedback.autoApplied, false);
  console.log('PASS feedback remains approval-gated');

  // A caller-supplied boolean must never override real execution.
  const failed = engine.recordFailure({
    failure: 'A regression occurred.',
    rootCause: 'Missing validation.',
    correction: 'Add validation.',
    testCase: 'Run a real failing regression test.',
    preventionKnowledge: 'Require actual test evidence.',
    testPassed: true,
    testFile: relative(failFixture)
  });
  assert.strictEqual(failed.testPassed, false);
  assert.strictEqual(failed.testExecution.exitCode, 7);
  assert.strictEqual(failed.autoApplied, false);
  assert.strictEqual(failed.approvalRequired, true);
  console.log('PASS failed fixture overrides caller-supplied success claim');

  const passed = engine.recordFailure({
    failure: 'A previous regression was corrected.',
    rootCause: 'Missing validation.',
    correction: 'Add validation.',
    testCase: 'Run the passing regression test.',
    preventionKnowledge: 'Run the test before delivery.',
    testFile: relative(passFixture)
  });
  assert.strictEqual(passed.testPassed, true);
  assert.strictEqual(passed.testExecution.exitCode, 0);
  console.log('PASS successful fixture is recorded accurately');

  assert.throws(() => engine.recordFailure({
    failure: 'x', rootCause: 'x', correction: 'x', testCase: 'x',
    preventionKnowledge: 'x', testPassed: true
  }), /testFile_required/);
  console.log('PASS missing testFile is rejected');

  const benchmark = engine.recordBenchmark({
    skill: 'test-execution',
    tests: [
      { name: 'passing fixture', testFile: relative(passFixture) },
      { name: 'failing fixture', testFile: relative(failFixture) }
    ],
    minimumScore: 1,
    evidenceReference: 'stage14-isolated-local-execution'
  });
  assert.strictEqual(benchmark.criteriaMet, false);
  assert.strictEqual(benchmark.capabilityClaimAllowed, false);
  assert.strictEqual(benchmark.expertClaimAllowed, false);
  console.log('PASS failing benchmark blocks capability claims');

  const beforeTamper = engine.verifyIntegrity();
  assert.strictEqual(beforeTamper.ok, true, JSON.stringify(beforeTamper));
  console.log('PASS integrity valid before tampering');

  const store = engine.loadStore();
  assert.ok(store.feedback.length > 0, 'feedback fixture record required');
  store.feedback[0].lesson = 'TAMPERED CONTENT';
  engine.saveStore(store);

  const afterTamper = engine.verifyIntegrity();
  assert.strictEqual(afterTamper.ok, false, 'tampered content must fail integrity');
  assert.ok(afterTamper.failures.length > 0);
  console.log('PASS tampering is detected and asserted');

  console.log('STAGE13_HARDENING_GAP_AUDIT: PASS');
} catch (error) {
  console.error('STAGE13_HARDENING_GAP_AUDIT: FAIL');
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  try { fs.unlinkSync(passFixture); } catch {}
  try { fs.unlinkSync(failFixture); } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
}
