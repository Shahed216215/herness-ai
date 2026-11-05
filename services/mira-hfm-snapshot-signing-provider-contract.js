'use strict';

const CONTRACT_VERSION = '1';
const REQUIRED_PURPOSE = 'MIRA_HFM_SNAPSHOT_ATTESTATION';

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates only the signing-provider interface and declared key scope.
 * It does not authenticate provider identity, prove non-exportable custody,
 * or approve staging/production use. Private key material is never accepted.
 */
function validateSnapshotSigningProvider(provider, expected) {
  if (!isPlainObject(provider) || !isPlainObject(provider.descriptor) || !isPlainObject(expected)) {
    fail('A snapshot signing provider and expected source scope are required.',
      'HFM_SIGNING_PROVIDER_CONTRACT_MISSING');
  }
  const d = provider.descriptor;
  const required = ['providerId', 'providerVersion', 'keyId', 'keyVersion'];
  if (d.contractVersion !== CONTRACT_VERSION ||
      d.keyPurpose !== REQUIRED_PURPOSE || d.algorithm !== 'Ed25519' ||
      required.some(k => typeof d[k] !== 'string' || !d[k].trim() || d[k].length > 256) ||
      d.environment !== expected.environment ||
      d.environment !== 'staging' ||
      d.keyId !== expected.keyId ||
      typeof provider.sign !== 'function' ||
      ['privateKeyPem', 'privateKey', 'privateKeyBytes'].some(k =>
        Object.prototype.hasOwnProperty.call(provider, k) ||
        Object.prototype.hasOwnProperty.call(d, k))) {
    fail('Snapshot signing provider descriptor, key scope, or sign-only interface is invalid.',
      'HFM_SIGNING_PROVIDER_CONTRACT_INVALID');
  }
  return Object.freeze({
    status: 'SIGNING_PROVIDER_SHAPE_VALID_NOT_CUSTODY_APPROVAL',
    providerId: d.providerId, providerVersion: d.providerVersion,
    keyId: d.keyId, keyVersion: d.keyVersion, algorithm: d.algorithm,
    environment: d.environment, productionUseAllowed: false, approvalRequired: true
  });
}

module.exports = { CONTRACT_VERSION, REQUIRED_PURPOSE, validateSnapshotSigningProvider };
