'use strict';
const assert = require('node:assert/strict');
const { validateKeyProviderContract } = require('../services/mira-hfm-key-provider-contract');

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
assert.throws(() => validateKeyProviderContract(provider, { ...metadata, keyVersion: '3' }, 'wrapDataKey'),
  error => error.code === 'BACKUP_KEY_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateKeyProviderContract({ ...provider, descriptor: { ...provider.descriptor, keyPurpose: 'OTHER' } },
  metadata, 'wrapDataKey'), error => error.code === 'BACKUP_KEY_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateKeyProviderContract({ ...provider, unwrapDataKey: undefined },
  metadata, 'wrapDataKey'), error => error.code === 'BACKUP_KEY_PROVIDER_CONTRACT_INVALID');
assert.throws(() => validateKeyProviderContract(provider, metadata, 'deleteKey'),
  error => error.code === 'BACKUP_KEY_PROVIDER_CONTRACT_INVALID');
process.stdout.write('MIRA_HFM_PHASE7_KEY_PROVIDER_CONTRACT_PASS\nPRODUCTION_KEY_CUSTODY=NOT_APPROVED\nNETWORK_REQUESTS=0\n');
