'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { verifyStagedArtifact } =
  require('../services/engineering/bug-hunter-repair-engine');

const planId = crypto.createHash('sha256')
  .update('isolated-runtime-test-plan').digest('hex');
const content = 'isolated candidate content\n';
const hash = value => crypto.createHash('sha256')
  .update(value).digest('hex');

let passed = 0, failed = 0, inconclusive = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (e) {
    if (e && e.code === 'TEST_INCONCLUSIVE') {
      inconclusive++;
      console.log('INCONCLUSIVE: ' + name + ' — ' + e.message);
    } else {
      failed++;
      console.log('FAIL: ' + name + ' — ' + (e.message || e));
    }
  }
}

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh2-artifact-'));
  const root = path.join(tmp, 'staging');
  const stage = path.join(root, planId);
  fs.mkdirSync(stage, { recursive: true });
  const candidate = path.join(stage, 'candidate.txt');
  fs.writeFileSync(candidate, content);
  const manifest = {
    planId,
    status: 'STAGED_REVIEW_REQUIRED',
    productionApplyAllowed: false,
    productionSourceModified: false,
    proposedHash: hash(content),
    candidate: planId + '/candidate.txt'
  };
  const manifestPath = path.join(stage, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return {
    tmp, root, stage, candidate, manifestPath, manifest,
    expected: hash(content),
    verify: (opts = {}) => verifyStagedArtifact({
      stagingRoot: root,
      planId,
      expectedProposedHash: hash(content),
      ...opts
    }),
    rewrite: patch => fs.writeFileSync(
      manifestPath, JSON.stringify({ ...manifest, ...patch })
    ),
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true })
  };
}

function withFixture(name, fn) {
  test(name, () => {
    const f = fixture();
    try { fn(f); } finally { f.cleanup(); }
  });
}

withFixture('valid artifact verifies but remains non-applicable', f => {
  const result = f.verify();
  assert.equal(result.verified, true);
  assert.equal(result.planId, planId);
  assert.equal(result.candidateHash, f.expected);
  assert.equal(result.productionApplyAllowed, false);
});

withFixture('tampered candidate content is rejected', f => {
  fs.writeFileSync(f.candidate, 'tampered\n');
  assert.throws(() => f.verify(), /integrity mismatch/);
});

withFixture('manifest plan ID tampering is rejected', f => {
  f.rewrite({ planId: 'f'.repeat(64) });
  assert.throws(() => f.verify(), /manifest contract rejected/);
});

withFixture('manifest status tampering is rejected', f => {
  f.rewrite({ status: 'APPROVED' });
  assert.throws(() => f.verify(), /manifest contract rejected/);
});

withFixture('manifest apply flag tampering is rejected', f => {
  f.rewrite({ productionApplyAllowed: true });
  assert.throws(() => f.verify(), /manifest contract rejected/);
});

withFixture('manifest source-modified flag tampering is rejected', f => {
  f.rewrite({ productionSourceModified: true });
  assert.throws(() => f.verify(), /manifest contract rejected/);
});

withFixture('manifest proposed hash tampering is rejected', f => {
  f.rewrite({ proposedHash: '0'.repeat(64) });
  assert.throws(() => f.verify(), /manifest contract rejected/);
});

withFixture('manifest traversal candidate is rejected', f => {
  f.rewrite({ candidate: '../outside.txt' });
  assert.throws(() => f.verify(), /manifest contract rejected/);
});

withFixture('corrupt JSON manifest is rejected', f => {
  fs.writeFileSync(f.manifestPath, '{not-json');
  assert.throws(() => f.verify());
});

withFixture('missing manifest is rejected', f => {
  fs.unlinkSync(f.manifestPath);
  assert.throws(() => f.verify());
});

withFixture('candidate symlink is rejected', f => {
  const outside = path.join(f.tmp, 'outside.txt');
  fs.writeFileSync(outside, content);
  fs.unlinkSync(f.candidate);
  try {
    fs.symlinkSync(outside, f.candidate);
  } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(e.code)) {
      const x = new Error('symlink creation unsupported: ' + e.code);
      x.code = 'TEST_INCONCLUSIVE';
      throw x;
    }
    throw e;
  }
  assert.throws(() => f.verify(), /candidate is not a regular file/);
});

withFixture('manifest symlink is rejected', f => {
  const outside = path.join(f.tmp, 'outside-manifest.json');
  fs.writeFileSync(outside, JSON.stringify(f.manifest));
  fs.unlinkSync(f.manifestPath);
  try {
    fs.symlinkSync(outside, f.manifestPath);
  } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(e.code)) {
      const x = new Error('symlink creation unsupported: ' + e.code);
      x.code = 'TEST_INCONCLUSIVE';
      throw x;
    }
    throw e;
  }
  assert.throws(() => f.verify(), /manifest is not a regular file/);
});

withFixture('stage-directory symlink is rejected', f => {
  const outside = path.join(f.tmp, 'outside-stage');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'candidate.txt'), content);
  fs.writeFileSync(path.join(outside, 'manifest.json'),
    JSON.stringify(f.manifest));
  fs.rmSync(f.stage, { recursive: true, force: true });
  try {
    fs.symlinkSync(outside, f.stage, 'dir');
  } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(e.code)) {
      const x = new Error('symlink creation unsupported: ' + e.code);
      x.code = 'TEST_INCONCLUSIVE';
      throw x;
    }
    throw e;
  }
  assert.throws(() => f.verify());
});

withFixture('staging-root symlink is rejected', f => {
  const alias = path.join(f.tmp, 'root-alias');
  try {
    fs.symlinkSync(f.root, alias, 'dir');
  } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(e.code)) {
      const x = new Error('symlink creation unsupported: ' + e.code);
      x.code = 'TEST_INCONCLUSIVE';
      throw x;
    }
    throw e;
  }
  assert.throws(() => f.verify({ stagingRoot: alias }),
    /staging root or plan directory is not a safe directory/);
});

withFixture('plan path escape is rejected', f => {
  assert.throws(() => f.verify({ planId: '../escape' }),
    /staging path escaped root/);
});

console.log(`RUNTIME_TESTS_PASSED=${passed}`);
console.log(`RUNTIME_TESTS_FAILED=${failed}`);
console.log(`RUNTIME_TESTS_INCONCLUSIVE=${inconclusive}`);
console.log(`RUNTIME_TEST_STATUS=${
  failed ? 'FAIL' : inconclusive ? 'REVIEW_REQUIRED' : 'PASS'
}`);
if (failed) process.exitCode = 1;
