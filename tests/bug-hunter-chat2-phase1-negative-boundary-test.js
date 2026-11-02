'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const engine = require('../services/engineering/bug-hunter-repair-engine');
const gate = require('../services/engineering/gate-status-policy');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL: ' + name + ' :: ' + String(e.message || e));
  }
}
function rejected(fn) {
  try {
    const result = fn();
    return result === false;
  } catch (_) {
    return true;
  }
}

check('absolute and traversal paths remain rejected', () => {
  for (const p of ['/tmp/outside', '../outside', 'a/../../outside',
                   '..', '', '.', 'foo\\..\\outside']) {
    assert.equal(engine.safeRelativePath(p), false, 'accepted: ' + p);
  }
});

check('malformed and tampered plans fail closed', () => {
  assert.equal(rejected(() => engine.verifyPlan(null)), true);
  assert.equal(rejected(() => engine.verifyPlan({})), true);
  const p = engine.createPlan({
    findingId: 'negative-boundary-test',
    file: 'fixture.txt',
    currentContent: 'before\n',
    proposedContent: 'after\n',
    testPaths: []
  });
  assert.doesNotThrow(() => engine.verifyPlan(p));
  for (const patch of [
    { sourceHash: 'f'.repeat(64) },
    { proposedHash: '0'.repeat(64) },
    { file: '../outside.txt' },
    { testPaths: ['../outside-test.js'] }
  ]) {
    const changed = { ...p, ...patch };
    assert.equal(rejected(() => engine.verifyPlan(changed)), true,
      'tampered identity field accepted: ' + Object.keys(patch).join(','));
  }
});

check('mutable approval metadata cannot enable disabled staging', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-bh-metadata-'));
  try {
    const p = engine.createPlan({
      findingId: 'metadata-tamper-test',
      file: 'fixture.txt',
      currentContent: 'before\\n',
      proposedContent: 'after\\n',
      testPaths: []
    });
    const altered = {
      ...p,
      status: 'APPROVED',
      approvalRequired: false,
      productionApplyAllowed: true
    };
    assert.doesNotThrow(() => engine.verifyPlan(altered));
    assert.equal(rejected(() => engine.stageRepair({
      root,
      plan: altered,
      currentContent: 'before\\n',
      proposedContent: 'after\\n',
      approval: {
        planId: altered.planId,
        approved: true,
        policySource: 'system_policy',
        approvalId: 'forged-test-only'
      },
      gates: [{ status: 'PASS' }]
    })), true);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

check('staged-artifact verifier rejects missing or malformed evidence', () => {
  assert.equal(rejected(() => engine.verifyStagedArtifact({})), true);
  assert.equal(rejected(() => engine.verifyStagedArtifact(null)), true);
});

check('staging stays disabled without trusted approval authority', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-bh-boundary-'));
  try {
    const p = engine.createPlan({
      findingId: 'approval-negative-test',
      file: 'fixture.txt',
      currentContent: 'original\n',
      proposedContent: 'candidate\n',
      testPaths: []
    });
    assert.equal(rejected(() => engine.stageRepair({ root, plan: p })), true);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

check('gate classifier does not promote incomplete evidence to PASS', () => {
  const incomplete = [
    {},
    { exitCode: 0, executed: true },
    { exitCode: 0, executed: true, coverageComplete: true,
      evidenceVerified: true, assertionsPassed: true, timedOut: true },
    { exitCode: 0, executed: true, coverageComplete: true,
      evidenceVerified: true, assertionsPassed: true, skipped: true }
  ];
  for (const item of incomplete) {
    assert.notEqual(gate.classify(item), 'PASS', JSON.stringify(item));
  }
});

check('gate aggregation remains review-required and blocks apply', () => {
  const result = gate.aggregate(
    [{ name: 'fabricated', status: 'PASS', exitCode: 0 }],
    ['fabricated']
  );
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.approved, false);
  assert.equal(result.mayApply, false);
});

console.log('NEGATIVE_BOUNDARY_FAILED=' + failed);
console.log('NEGATIVE_BOUNDARY_STATUS=' + (failed === 0 ? 'PASS' : 'FAIL'));
process.exitCode = failed === 0 ? 0 : 1;
