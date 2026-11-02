'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const engine = require('../services/engineering/bug-hunter-repair-engine');

const hash = value =>
  crypto.createHash('sha256').update(value).digest('hex');

const tmp = fs.mkdtempSync(
  path.join(os.tmpdir(), 'mira-bh-chat2-phase1-')
);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL: ' + name + ' :: ' + String(err.message || err));
  }
}

try {
  const fixture = path.join(tmp, 'fixture.txt');
  const original = 'original fixture content\n';
  const proposed = 'proposed fixture content\n';
  fs.writeFileSync(fixture, original, { flag: 'wx', mode: 0o600 });

  const beforeHash = hash(fs.readFileSync(fixture));

  const plan = engine.createPlan({
    findingId: 'phase1-offline-integration',
    file: 'fixture.txt',
    currentContent: original,
    proposedContent: proposed,
    testPaths: []
  });

  check('plan is proposal-only and cannot directly apply to production', () => {
    assert.equal(plan.status, 'PROPOSAL_ONLY');
    assert.equal(plan.approvalRequired, true);
    assert.equal(plan.productionApplyAllowed, false);
    assert.equal(plan.mode, 'ISOLATED_STAGING_ONLY');
  });

  check('valid plan passes integrity verification', () => {
    assert.doesNotThrow(() => engine.verifyPlan(plan));
  });

  check('tampered plan is rejected', () => {
    const tampered = { ...plan, proposedHash: '0'.repeat(64) };
    let rejected = false;
    try {
      const result = engine.verifyPlan(tampered);
      rejected = result === false;
    } catch (_) {
      rejected = true;
    }
    assert.equal(
      rejected,
      true,
      'verifyPlan accepted a tampered plan instead of returning false or throwing'
    );
  });

  check('unsafe relative paths are rejected', () => {
    assert.equal(engine.safeRelativePath('../outside.txt'), false);
    assert.equal(engine.safeRelativePath('/absolute/path.txt'), false);
  });

  check('missing trusted approval fails closed', () => {
    let caught;
    try {
      engine.stageRepair({ root: tmp, plan });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'stageRepair unexpectedly accepted a plan without approval');
    assert.match(
      String(caught.message || caught),
      /approval|system_policy|trusted|policy|authoriz/i,
      'rejection did not identify an approval/policy boundary'
    );
  });

  check('production fixture remains unchanged after rejected staging', () => {
    assert.equal(hash(fs.readFileSync(fixture)), beforeHash);
    assert.equal(fs.readFileSync(fixture, 'utf8'), original);
  });

  check('staging does not create a candidate after rejected staging', () => {
    const candidates = [];
    function walk(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) walk(full);
        else if (/candidate|manifest/i.test(item.name)) candidates.push(full);
      }
    }
    walk(tmp);
    assert.deepEqual(candidates, []);
  });
} catch (err) {
  failures++;
  console.log('FAIL: integration harness :: ' + String(err.stack || err));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('INTEGRATION_TESTS_FAILED=' + failures);
console.log('INTEGRATION_STATUS=' + (failures === 0 ? 'PASS' : 'FAIL'));
process.exitCode = failures === 0 ? 0 : 1;
