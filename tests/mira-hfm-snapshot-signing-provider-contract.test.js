'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateSnapshotSigningProvider } = require('../services/mira-hfm-snapshot-signing-provider-contract');

const pair = crypto.generateKeyPairSync('ed25519');
const provider = {
  descriptor: { contractVersion: '1', providerId: 'synthetic-provider', providerVersion: '1',
    keyId: 'snapshot-key', keyVersion: 'v2', keyPurpose: 'MIRA_HFM_SNAPSHOT_ATTESTATION',
    algorithm: 'Ed25519', environment: 'staging' },
  async sign({ message, keyId, keyVersion, purpose }) {
    assert.equal(keyId, 'snapshot-key');
    assert.equal(keyVersion, 'v2');
    assert.equal(purpose, 'MIRA_HFM_SNAPSHOT_ATTESTATION');
    return crypto.sign(null, message, pair.privateKey);
  }
};
const expected = { environment: 'staging', keyId: 'snapshot-key' };
const result = validateSnapshotSigningProvider(provider, expected);
assert.equal(result.status, 'SIGNING_PROVIDER_SHAPE_VALID_NOT_CUSTODY_APPROVAL');
assert.equal(result.productionUseAllowed, false);
assert.equal(result.approvalRequired, true);
assert.throws(() => validateSnapshotSigningProvider({
  ...provider, descriptor: { ...provider.descriptor, environment: 'production' }
}, expected), error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider({
  ...provider, descriptor: { ...provider.descriptor, keyId: 'other-key' }
}, expected), error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider({
  ...provider, sign: undefined
}, expected), error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider({
  ...provider, privateKeyPem: 'MUST_NOT_BE_ACCEPTED'
}, expected), error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
process.stdout.write('MIRA_HFM_PHASE7_SNAPSHOT_SIGNING_PROVIDER_CONTRACT_PASS\n');
process.stdout.write('PRIVATE_KEY_MATERIAL_EXPOSED_TO_ADAPTER=NO\n');
process.stdout.write('PRODUCTION_KEY_CUSTODY=NOT_APPROVED\nNETWORK_REQUESTS=0\n');
