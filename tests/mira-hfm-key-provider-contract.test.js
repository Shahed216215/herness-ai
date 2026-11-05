'use strict';
const assert = require('node:assert/strict');
const { validateKeyProviderContract } = require('../services/mira-hfm-key-provider-contract');
const { validateSnapshotSigningProvider } = require('../services/mira-hfm-snapshot-signing-provider-contract');

const metadata = { keyId: 'fixture-key', keyVersion: '2' };
const provider = {
  descriptor: { contractVersion: '1', providerId: 'fixture-provider', providerVersion: '1',
    keyId: 'fixture-key', keyVersion: '2', keyPurpose: 'MIRA_HFM_BACKUP', environment: 'test' },
  async wrapDataKey() {},
  async unwrapDataKey() {}
};
const result = validateKeyProviderContract(provider, metadata, 'wrapDataKey');
assert.equal(result.status, 'CONTRACT_SHAPE_VALID_NOT_APPROVAL');
assert.equal(result.productionUseAllowed, false);
assert.equal(result.approvalRequired, true);
assert.throws(() => validateKeyProviderContract({
  ...provider,
  descriptor: { ...provider.descriptor, environment: 'production' }
}, metadata, 'wrapDataKey'), error => error.code === 'BACKUP_PRODUCTION_KEY_PROVIDER_NOT_APPROVED');
assert.throws(() => validateKeyProviderContract(provider, { ...metadata, keyVersion: '3' }, 'wrapDataKey'),
  error => error.code === 'BACKUP_KEY_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateKeyProviderContract({ ...provider, descriptor: { ...provider.descriptor, keyPurpose: 'OTHER' } },
  metadata, 'wrapDataKey'), error => error.code === 'BACKUP_KEY_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateKeyProviderContract({ ...provider, unwrapDataKey: undefined },
  metadata, 'wrapDataKey'), error => error.code === 'BACKUP_KEY_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateKeyProviderContract(provider, metadata, 'deleteKey'),
  error => error.code === 'BACKUP_KEY_PROVIDER_CONTRACT_INVALID');
for (const field of ['privateKeyPem', 'privateKeyBytes', 'masterKey', 'masterKeyBytes',
  'keyMaterial', 'secretKey', 'secretKeyBytes', 'keyEncryptionKey', 'keyEncryptionKeyBytes',
  'kek', 'encryptionKey', 'encryptionKeyBytes', 'credential', 'credentials',
  'accessToken', 'refreshToken', 'clientSecret']) {
  assert.throws(() => validateKeyProviderContract({
    ...provider, [field]: 'must-not-be-exposed'
  }, metadata, 'wrapDataKey'), error => error.code === 'BACKUP_KEY_PROVIDER_SECRET_BOUNDARY_VIOLATION');
  assert.throws(() => validateKeyProviderContract({
    ...provider, descriptor: { ...provider.descriptor, [field]: 'must-not-be-exposed' }
  }, metadata, 'wrapDataKey'), error => error.code === 'BACKUP_KEY_PROVIDER_SECRET_BOUNDARY_VIOLATION');
}

const signingProvider = {
  descriptor: { contractVersion: '1', providerId: 'fixture-snapshot-signer', providerVersion: '1',
    keyId: 'snapshot-key', keyVersion: 'v2', keyPurpose: 'MIRA_HFM_SNAPSHOT_ATTESTATION',
    algorithm: 'Ed25519', environment: 'staging' },
  async sign() { return Buffer.alloc(64); }
};
const signingResult = validateSnapshotSigningProvider(signingProvider, {
  environment: 'staging', keyId: 'snapshot-key'
});
assert.equal(signingResult.status, 'SIGNING_PROVIDER_SHAPE_VALID_NOT_CUSTODY_APPROVAL');
assert.equal(signingResult.productionUseAllowed, false);
assert.throws(() => validateSnapshotSigningProvider({
  ...signingProvider, descriptor: { ...signingProvider.descriptor, keyVersion: '' }
}, { environment: 'staging', keyId: 'snapshot-key' }),
error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider({
  ...signingProvider, privateKeyPem: 'must-not-enter-provider-interface'
}, { environment: 'staging', keyId: 'snapshot-key' }),
error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider({
  ...signingProvider, descriptor: { ...signingProvider.descriptor, environment: 'production' }
}, { environment: 'production', keyId: 'snapshot-key' }),
error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider({
  ...signingProvider, descriptor: { ...signingProvider.descriptor, algorithm: 'RSA-SHA256' }
}, { environment: 'staging', keyId: 'snapshot-key' }),
error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider({
  ...signingProvider, descriptor: { ...signingProvider.descriptor, keyPurpose: 'MIRA_HFM_BACKUP' }
}, { environment: 'staging', keyId: 'snapshot-key' }),
error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider(signingProvider,
  { environment: 'staging', keyId: 'different-key' }),
error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider({
  ...signingProvider, privateKeyBytes: Buffer.from('secret')
}, { environment: 'staging', keyId: 'snapshot-key' }),
error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateSnapshotSigningProvider({
  ...signingProvider,
  descriptor: { ...signingProvider.descriptor, privateKeyPem: 'must-not-enter-descriptor' }
}, { environment: 'staging', keyId: 'snapshot-key' }),
error => error.code === 'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
process.stdout.write('MIRA_HFM_PHASE7_SNAPSHOT_SIGNING_PROVIDER_CONTRACT_PASS\\n');
process.stdout.write('PRIVATE_KEY_MATERIAL_EXPOSED_TO_ADAPTER=NO\\n');

process.stdout.write('MIRA_HFM_PHASE7_KEY_PROVIDER_SECRET_BOUNDARY_PASS\\n');
process.stdout.write('MIRA_HFM_PHASE7_KEY_PROVIDER_CONTRACT_PASS\nPRODUCTION_KEY_CUSTODY=NOT_APPROVED\nNETWORK_REQUESTS=0\n');
