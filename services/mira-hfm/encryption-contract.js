'use strict';

const ENVELOPE_FIELDS = [
  'algorithm', 'keyId', 'keyVersion', 'nonce',
  'authTag', 'ciphertext', 'aadProfile'
];

function cryptoProviderReadiness(provider, context) {
  if (!provider || provider.approvedProfile !== true ||
      typeof provider.algorithmProfile !== 'string' || !provider.algorithmProfile.trim() ||
      typeof provider.encrypt !== 'function' || typeof provider.decrypt !== 'function') {
    return { ready: false, status: 'NOT_APPROVED', reason: 'APPROVED_AEAD_PROVIDER_REQUIRED' };
  }
  if (provider.testOnly === true && (!context || context.testOnly !== true)) {
    return { ready: false, status: 'NOT_APPROVED', reason: 'TEST_ONLY_CRYPTO_PROVIDER_BLOCKED' };
  }
  return { ready: true, status: 'READY' };
}

function validateEnvelope(envelope, provider) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return false;
  const keys = Object.keys(envelope);
  if (keys.some(key => !ENVELOPE_FIELDS.includes(key)) ||
      ENVELOPE_FIELDS.some(key => !Object.prototype.hasOwnProperty.call(envelope, key))) return false;
  if (envelope.algorithm !== provider.algorithmProfile ||
      typeof envelope.keyId !== 'string' || !envelope.keyId ||
      typeof envelope.keyVersion !== 'string' || !envelope.keyVersion ||
      typeof envelope.nonce !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.nonce) ||
      typeof envelope.authTag !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.authTag) ||
      typeof envelope.ciphertext !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.ciphertext) ||
      typeof envelope.aadProfile !== 'string' || !envelope.aadProfile) return false;
  return true;
}

async function encryptPayload(provider, plaintext, context) {
  const readiness = cryptoProviderReadiness(provider, context);
  if (!readiness.ready) return { ok: false, status: readiness.status, reason: readiness.reason };
  if (typeof plaintext !== 'string' || !context || typeof context.projectId !== 'string' ||
      !context.projectId.trim()) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'PLAINTEXT_OR_PROJECT_INVALID' };
  }
  try {
    const envelope = await provider.encrypt(plaintext, context);
    if (!validateEnvelope(envelope, provider)) {
      return { ok: false, status: 'ENCRYPTION_FAILED', reason: 'ENVELOPE_INVALID' };
    }
    return {
      ok: true,
      status: 'ENCRYPTED',
      envelope: Object.assign({}, envelope),
      plaintextReturned: false
    };
  } catch (_) {
    return { ok: false, status: 'ENCRYPTION_FAILED', reason: 'CRYPTO_PROVIDER_FAILED' };
  }
}

async function decryptPayload(provider, envelope, context) {
  const readiness = cryptoProviderReadiness(provider, context);
  if (!readiness.ready) return { ok: false, status: readiness.status, reason: readiness.reason };
  if (!validateEnvelope(envelope, provider) || !context ||
      typeof context.projectId !== 'string' || !context.projectId.trim()) {
    return { ok: false, status: 'DECRYPTION_FAILED', reason: 'ENVELOPE_OR_PROJECT_INVALID' };
  }
  try {
    const plaintext = await provider.decrypt(envelope, context);
    if (typeof plaintext !== 'string') {
      return { ok: false, status: 'DECRYPTION_FAILED', reason: 'PLAINTEXT_RESULT_INVALID' };
    }
    return { ok: true, status: 'DECRYPTED', plaintext };
  } catch (_) {
    // Authentication-tag failure, missing key and provider failure all fail closed.
    return { ok: false, status: 'DECRYPTION_FAILED', reason: 'AUTHENTICATION_OR_KEY_FAILURE' };
  }
}

module.exports = {
  ENVELOPE_FIELDS,
  cryptoProviderReadiness,
  validateEnvelope,
  encryptPayload,
  decryptPayload
};
