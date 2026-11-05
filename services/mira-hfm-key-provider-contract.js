'use strict';

const CONTRACT_VERSION = '1';
const REQUIRED_PURPOSE = 'MIRA_HFM_BACKUP';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates the declared adapter shape only. It does not authenticate the
 * provider, prove key custody, or authorize production use.
 */
function validateKeyProviderContract(provider, metadata, operation) {
  if (!isPlainObject(provider) || !isPlainObject(provider.descriptor)) {
    const error = new Error('Key provider descriptor is required by the Phase 7 contract.');
    error.code = 'BACKUP_KEY_PROVIDER_CONTRACT_MISSING';
    throw error;
  }
  const descriptor = provider.descriptor;
  const forbiddenKeyMaterialFields = [
    'privateKeyPem', 'privateKey', 'privateKeyBytes',
    'masterKey', 'masterKeyBytes', 'keyMaterial', 'secretKey', 'secretKeyBytes',
    'keyEncryptionKey', 'keyEncryptionKeyBytes', 'kek', 'encryptionKey', 'encryptionKeyBytes',
    'credential', 'credentials', 'accessToken', 'refreshToken', 'clientSecret'
  ];
  if (forbiddenKeyMaterialFields.some(field =>
      Object.prototype.hasOwnProperty.call(provider, field) ||
      Object.prototype.hasOwnProperty.call(descriptor, field))) {
    const error = new Error('Raw key material is not accepted on the backup key-provider interface.');
    error.code = 'BACKUP_KEY_PROVIDER_SECRET_BOUNDARY_VIOLATION';
    throw error;
  }
  if (descriptor.environment === 'production') {
    const error = new Error('Production key-provider use is not approved by the Phase 7 contract.');
    error.code = 'BACKUP_PRODUCTION_KEY_PROVIDER_NOT_APPROVED';
    throw error;
  }
  const required = ['providerId', 'providerVersion', 'keyId', 'keyVersion', 'environment'];
  if (descriptor.contractVersion !== CONTRACT_VERSION ||
      descriptor.keyPurpose !== REQUIRED_PURPOSE ||
      required.some(field => typeof descriptor[field] !== 'string' || !descriptor[field].trim() || descriptor[field].length > 256) ||
      !['test', 'staging', 'production'].includes(descriptor.environment) ||
      !metadata || descriptor.keyId !== metadata.keyId || descriptor.keyVersion !== metadata.keyVersion ||
      typeof provider.wrapDataKey !== 'function' || typeof provider.unwrapDataKey !== 'function' ||
      !['wrapDataKey', 'unwrapDataKey'].includes(operation)) {
    const error = new Error('Key provider descriptor, key scope, or required operations do not satisfy the Phase 7 contract.');
    error.code = 'BACKUP_KEY_PROVIDER_CONTRACT_INVALID';
    throw error;
  }
  return {
    status: 'CONTRACT_SHAPE_VALID_NOT_APPROVAL',
    providerId: descriptor.providerId,
    providerVersion: descriptor.providerVersion,
    keyId: descriptor.keyId,
    keyVersion: descriptor.keyVersion,
    environment: descriptor.environment,
    productionUseAllowed: false,
    approvalRequired: true
  };
}

module.exports = { CONTRACT_VERSION, REQUIRED_PURPOSE, validateKeyProviderContract };
