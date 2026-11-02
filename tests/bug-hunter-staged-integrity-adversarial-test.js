'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const engine = require('../services/engineering/bug-hunter-repair-engine');

assert.equal(
  typeof engine.verifyStagedArtifact,
  'function',
  'integrity verifier export must exist'
);

const hash = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-integrity-adv-'));
let count = 0;

function fixture() {
  const base = fs.mkdtempSync(path.join(temp, 'case-'));
  const root = path.join(base, 'stage');
  const planId = 'b'.repeat(64);
  const stage = path.join(root, planId);
  const rel = path.join(planId, 'candidate', 'safe.js');
  const candidate = path.join(root, rel);
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.mkdirSync(stage, { recursive: true });

  const content = 'module.exports = "safe";\n';
  const digest = hash(content);
  const manifest = {
    version: 1,
    planId,
    candidate: rel,
    proposedHash: digest,
    status: 'STAGED_REVIEW_REQUIRED',
    productionApplyAllowed: false,
    productionSourceModified: false
  };
  fs.writeFileSync(candidate, content);
  const manifestPath = path.join(stage, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest) + '\n');

  return {
    base, root, stage, planId, rel, candidate,
    digest, manifest, manifestPath,
    run(expected = digest) {
      return engine.verifyStagedArtifact({
        stagingRoot: root,
        planId,
        expectedProposedHash: expected
      });
    }
  };
}

function expectBlocked(label, fn, pattern) {
  assert.throws(fn, pattern, label);
  count++;
  console.log(label + '=PASS');
}

try {
  {
    const f = fixture();
    assert.equal(f.run().verified, true);
    count++;
    console.log('VALID_ARTIFACT_ACCEPTED=PASS');
  }

  {
    const f = fixture();
    expectBlocked('EXPECTED_HASH_MISMATCH_BLOCKED',
      () => f.run('0'.repeat(64)), /manifest contract rejected/);
  }

  {
    const f = fixture();
    f.manifest.candidate = path.join(f.planId, '..', '..', 'outside.js');
    fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
    expectBlocked('CANDIDATE_TRAVERSAL_BLOCKED',
      () => f.run(), /candidate path escaped|manifest contract rejected/);
  }

  {
    const f = fixture();
    fs.unlinkSync(f.manifestPath);
    fs.symlinkSync(f.candidate, f.manifestPath);
    expectBlocked('MANIFEST_SYMLINK_BLOCKED',
      () => f.run(), /manifest is not a regular file/);
  }

  {
    const f = fixture();
    fs.unlinkSync(f.candidate);
    fs.symlinkSync(path.join(f.base, 'missing-target'), f.candidate);
    expectBlocked('CANDIDATE_SYMLINK_BLOCKED',
      () => f.run(), /candidate is not a regular file/);
  }

  {
    const f = fixture();
    fs.writeFileSync(f.manifestPath, '{not-json');
    expectBlocked('MALFORMED_MANIFEST_BLOCKED',
      () => f.run());
  }

  {
    const f = fixture();
    fs.unlinkSync(f.candidate);
    fs.mkdirSync(f.candidate);
    expectBlocked('CANDIDATE_DIRECTORY_BLOCKED',
      () => f.run(), /candidate is not a regular file/);
  }

  {
    const f = fixture();
    fs.unlinkSync(f.manifestPath);
    fs.writeFileSync(f.manifestPath, JSON.stringify({
      ...f.manifest,
      productionApplyAllowed: true
    }));
    expectBlocked('APPLY_FLAG_TAMPERING_BLOCKED',
      () => f.run(), /manifest contract rejected/);
  }

  {
    const f = fixture();
    fs.writeFileSync(f.candidate, 'tampered\n');
    expectBlocked('CANDIDATE_CONTENT_TAMPERING_BLOCKED',
      () => f.run(), /integrity mismatch/);
  }

  console.log('ADVERSARIAL_ASSERTIONS=' + count);
  console.log('STAGED_INTEGRITY_ADVERSARIAL_TEST=PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
