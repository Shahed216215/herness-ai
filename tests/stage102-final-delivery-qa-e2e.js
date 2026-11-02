'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const store = require('../deliverable-store');
const qa = require('../services/final-delivery-qa');

const UNIQUE =
  Date.now().toString() +
  '-' +
  Math.random().toString(16).slice(2);

const tempDir = path.join(
  __dirname,
  '..',
  'data',
  '.stage102-qa'
);

fs.mkdirSync(tempDir, { recursive: true });

const filePath = path.join(
  tempDir,
  'delivery-' + UNIQUE + '.txt'
);

fs.writeFileSync(
  filePath,
  'Mira final delivery QA verified content',
  'utf8'
);

const deliveryId =
  'stage102-delivery-' + UNIQUE;

const created = store.create({
  id: deliveryId,
  title: 'Final Delivery ' + UNIQUE,
  name: 'stage102-final-delivery-' + UNIQUE,
  description: 'Final client deliverable',
  type: 'text',
  content: 'Mira final delivery QA verified content',
  status: 'final'
});

assert(created);
assert.strictEqual(created.id, deliveryId);

const loaded = store.get(deliveryId);

assert(loaded);
assert.strictEqual(
  loaded.id,
  deliveryId
);

const sha = qa.sha256File(filePath);

const result = qa.runQA({
  deliverable: loaded,
  filePath,
  expectedSha256: sha,
  requirements: [
    'Mira',
    'final delivery',
    'QA verified'
  ]
});

console.log('DELIVERABLE_ID=', created.id);
console.log('FILE_INTEGRITY=', result.fileIntegrity.passed);
console.log('REQUIREMENT_MATCH=', result.requirementMatch.passed);
console.log('QUALITY=', result.quality.passed);
console.log('SECURITY=', result.security.passed);
console.log('FINAL_VERIFICATION=', result.finalVerification.passed);

assert.strictEqual(
  result.fileIntegrity.passed,
  true
);

assert.strictEqual(
  result.requirementMatch.passed,
  true
);

assert.strictEqual(
  result.quality.passed,
  true
);

assert.strictEqual(
  result.security.passed,
  true
);

assert.strictEqual(
  result.finalVerification.passed,
  true
);

const badRequirement = qa.runQA({
  deliverable: loaded,
  filePath,
  expectedSha256: sha,
  requirements: [
    'THIS_REQUIREMENT_MUST_NOT_EXIST'
  ]
});

assert.strictEqual(
  badRequirement.requirementMatch.passed,
  false
);

const badHash = qa.fileIntegrity(
  filePath,
  '0000000000000000000000000000000000000000000000000000000000000000'
);

assert.strictEqual(
  badHash.passed,
  false
);

const missingFile = qa.fileIntegrity(
  path.join(tempDir, 'does-not-exist.txt'),
  sha
);

assert.strictEqual(
  missingFile.passed,
  false
);

const malicious = qa.securityCheck({
  content: 'node child_process exec(rm -rf)'
});

assert.strictEqual(
  malicious.passed,
  false
);

const emptyQuality = qa.qualityCheck({
  id: 'quality-negative',
  content: '',
  status: 'final'
});

assert.strictEqual(
  emptyQuality.passed,
  false
);

console.log('NEGATIVE_REQUIREMENT_TEST: PASS');
console.log('HASH_TAMPER_TEST: PASS');
console.log('MISSING_FILE_TEST: PASS');
console.log('SECURITY_NEGATIVE_TEST: PASS');
console.log('QUALITY_NEGATIVE_TEST: PASS');
console.log('STAGE10_2_FINAL_DELIVERY_QA_E2E: PASS');

fs.rmSync(tempDir, {
  recursive: true,
  force: true
});

const currentStore = store.loadStore();
currentStore.deliveries = currentStore.deliveries.filter(
  delivery => delivery.id !== deliveryId
);
store.saveStore(currentStore);

console.log('TEST_FIXTURE_CLEANUP: PASS');
