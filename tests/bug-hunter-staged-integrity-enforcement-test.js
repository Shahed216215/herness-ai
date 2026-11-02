'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const engine = require('../services/engineering/bug-hunter-repair-engine');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-integrity-'));
try {
  const root = path.join(temp, 'stage');
  const planId = 'a'.repeat(64);
  const planRoot = path.join(root, planId);
  const candidateRel = path.join(planId, 'candidate', 'sample.js');
  const candidate = path.join(root, candidateRel);
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.mkdirSync(planRoot, { recursive: true });

  const content = 'module.exports = 42;\n';
  const hash = require('node:crypto')
    .createHash('sha256').update(content, 'utf8').digest('hex');

  fs.writeFileSync(candidate, content);
  fs.writeFileSync(path.join(planRoot, 'manifest.json'), JSON.stringify({
    version: 1,
    planId,
    candidate: candidateRel,
    proposedHash: hash,
    status: 'STAGED_REVIEW_REQUIRED',
    productionApplyAllowed: false,
    productionSourceModified: false
  }, null, 2) + '\n');

  const result = engine.verifyStagedArtifact({
    stagingRoot: root,
    planId,
    expectedProposedHash: hash
  });
  assert.equal(result.verified, true);
  assert.equal(result.candidateHash, hash);
  assert.equal(result.productionApplyAllowed, false);
  console.log('VALID_STAGED_ARTIFACT=PASS');

  fs.writeFileSync(candidate, 'tampered\n');
  assert.throws(() => engine.verifyStagedArtifact({
    stagingRoot: root, planId, expectedProposedHash: hash
  }), /integrity mismatch/);
  console.log('TAMPERED_CANDIDATE_BLOCK=PASS');

  fs.writeFileSync(candidate, content);
  const manifestPath = path.join(planRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.productionApplyAllowed = true;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  assert.throws(() => engine.verifyStagedArtifact({
    stagingRoot: root, planId, expectedProposedHash: hash
  }), /manifest contract rejected/);
  console.log('MANIFEST_POLICY_TAMPERING_BLOCK=PASS');

  console.log('STAGED_INTEGRITY_ENFORCEMENT_TEST=PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
