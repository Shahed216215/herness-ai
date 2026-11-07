'use strict';

const crypto = require('node:crypto');

const ENVELOPE_VERSION = '1';
const ALGORITHM = 'AES-256-GCM';
const MAX_PLAINTEXT_BYTES = 1024 * 1024;
const CONTEXT_LIMITS = Object.freeze({
  recordId: 128,
  ownerId: 512,
  projectId: 128,
  recordType: 64,
  classification: 32,
  schemaVersion: 32
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function boundedText(value, max = 256) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value;
}

function validateContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw fail('MIRA_VAULT_CONTEXT_INVALID');
  }
  for (const [field, max] of Object.entries(CONTEXT_LIMITS)) {
    if (!boundedText(context[field], max)) {
      throw fail('MIRA_VAULT_CONTEXT_INVALID');
    }
  }
  if (context.recordId.length < 8) {
    throw fail('MIRA_VAULT_CONTEXT_INVALID');
  }
  if (!['PROJECT_PRIVATE', 'RESTRICTED'].includes(context.classification)) {
    throw fail('MIRA_VAULT_CONTEXT_CLASSIFICATION_INVALID');
  }
  return Object.freeze({
    recordId: context.recordId,
    ownerId: context.ownerId,
    projectId: context.projectId,
    recordType: context.recordType,
    classification: context.classification,
    schemaVersion: context.schemaVersion
  });
}

function resolveKey(version, env) {
  if (!/^v[1-9][0-9]*$/.test(version)) {
    throw fail('MIRA_VAULT_KEY_VERSION_INVALID');
  }
  const variable = 'MIRA_VAULT_KEK_' + version.toUpperCase();
  const encoded = env && env[variable];
  if (typeof encoded !== 'string' || !encoded) {
    throw fail('MIRA_VAULT_KEY_MISSING');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    key.fill(0);
    throw fail('MIRA_VAULT_KEY_INVALID');
  }
  return key;
}

function activeKeyVersion(env) {
  const version = env && env.MIRA_VAULT_ACTIVE_KEK_VERSION;
  if (typeof version !== 'string' || !/^v[1-9][0-9]*$/.test(version)) {
    throw fail('MIRA_VAULT_ACTIVE_KEY_VERSION_MISSING');
  }
  return version;
}

function createVaultDigestCandidates(canonicalText, env = process.env) {
  if (typeof canonicalText !== 'string' || !canonicalText) {
    throw fail('MIRA_VAULT_DIGEST_INPUT_INVALID');
  }
  const activeVersion = activeKeyVersion(env);
  const versions = Object.keys(env || {})
    .filter(name => /^MIRA_VAULT_KEK_V[1-9][0-9]*$/.test(name))
    .map(name => name.slice('MIRA_VAULT_KEK_'.length));
  if (!versions.includes(activeVersion)) versions.push(activeVersion);
  versions.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  const ordered = [activeVersion, ...versions.filter(version => version !== activeVersion)];
  const digests = [];
  for (const version of ordered) {
    const kek = resolveKey(version, env);
    let derived;
    try {
      derived = Buffer.from(crypto.hkdfSync(
        'sha256', kek,
        Buffer.from('mira-hfm-idempotency-digest-salt-v1', 'utf8'),
        Buffer.from('mira-hfm-idempotency-digest-v1', 'utf8'),
        32
      ));
      digests.push(crypto.createHmac('sha256', derived)
        .update(canonicalText, 'utf8').digest('hex'));
    } finally {
      kek.fill(0);
      if (derived) derived.fill(0);
    }
  }
  return Object.freeze({ activeDigest: digests[0], candidates: Object.freeze(digests) });
}

function payloadAad(context) {
  return Buffer.from(JSON.stringify([
    'mira-hfm-vault-payload',
    ENVELOPE_VERSION,
    context.recordId,
    context.ownerId,
    context.projectId,
    context.recordType,
    context.classification,
    context.schemaVersion
  ]), 'utf8');
}

function dekAad(context, keyVersion) {
  return Buffer.from(JSON.stringify([
    'mira-hfm-vault-dek',
    ENVELOPE_VERSION,
    keyVersion,
    context.recordId,
    context.ownerId,
    context.projectId,
    context.recordType,
    context.classification,
    context.schemaVersion
  ]), 'utf8');
}

function encryptBytes(key, plaintext, aad) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, {
    authTagLength: 16
  });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);
  return {
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

function decodePart(value, expectedLength) {
  if (typeof value !== 'string' || !value) {
    throw fail('MIRA_VAULT_ENVELOPE_INVALID');
  }
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length ||
      decoded.toString('base64') !== value ||
      (expectedLength !== undefined && decoded.length !== expectedLength)) {
    decoded.fill(0);
    throw fail('MIRA_VAULT_ENVELOPE_INVALID');
  }
  return decoded;
}

function decryptBytes(key, encrypted, aad) {
  const nonce = decodePart(encrypted.nonce, 12);
  const ciphertext = decodePart(encrypted.ciphertext);
  const tag = decodePart(encrypted.tag, 16);
  let partial;
  let finalPart;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    partial = decipher.update(ciphertext);
    finalPart = decipher.final();
    return Buffer.concat([partial, finalPart]);
  } catch (_error) {
    throw fail('MIRA_VAULT_AUTHENTICATION_FAILED');
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
    tag.fill(0);
    if (partial) partial.fill(0);
    if (finalPart) finalPart.fill(0);
  }
}

function createVaultEnvelope({ record, context, env = process.env } = {}) {
  const safeContext = validateContext(context);
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw fail('MIRA_VAULT_RECORD_INVALID');
  }

  let plaintext;
  try {
    plaintext = Buffer.from(JSON.stringify(record), 'utf8');
  } catch (_error) {
    throw fail('MIRA_VAULT_RECORD_SERIALIZATION_FAILED');
  }
  if (!plaintext.length || plaintext.length > MAX_PLAINTEXT_BYTES) {
    plaintext.fill(0);
    throw fail('MIRA_VAULT_RECORD_SIZE_INVALID');
  }

  let kek;
  let dek;
  try {
    const keyVersion = activeKeyVersion(env);
    kek = resolveKey(keyVersion, env);
    dek = crypto.randomBytes(32);
    const payload = encryptBytes(dek, plaintext, payloadAad(safeContext));
    const wrappedDek = encryptBytes(kek, dek, dekAad(safeContext, keyVersion));
    return Object.freeze({
      envelopeVersion: ENVELOPE_VERSION,
      algorithm: ALGORITHM,
      keyVersion,
      payload: Object.freeze(payload),
      wrappedDek: Object.freeze(wrappedDek)
    });
  } finally {
    plaintext.fill(0);
    if (dek) dek.fill(0);
    if (kek) kek.fill(0);
  }
}

function decryptVaultEnvelope({ envelope, context, env = process.env } = {}) {
  const safeContext = validateContext(context);
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      envelope.envelopeVersion !== ENVELOPE_VERSION ||
      envelope.algorithm !== ALGORITHM ||
      typeof envelope.keyVersion !== 'string' ||
      !envelope.payload || !envelope.wrappedDek) {
    throw fail('MIRA_VAULT_ENVELOPE_INVALID');
  }

  const kek = resolveKey(envelope.keyVersion, env);
  let dek;
  let plaintext;
  try {
    dek = decryptBytes(kek, envelope.wrappedDek, dekAad(safeContext, envelope.keyVersion));
    if (dek.length !== 32) {
      throw fail('MIRA_VAULT_ENVELOPE_INVALID');
    }
    plaintext = decryptBytes(dek, envelope.payload, payloadAad(safeContext));
    if (!plaintext.length || plaintext.length > MAX_PLAINTEXT_BYTES) {
      throw fail('MIRA_VAULT_RECORD_SIZE_INVALID');
    }
    let record;
    try {
      record = JSON.parse(plaintext.toString('utf8'));
    } catch (_error) {
      throw fail('MIRA_VAULT_RECORD_DESERIALIZATION_FAILED');
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw fail('MIRA_VAULT_RECORD_INVALID');
    }
    return record;
  } finally {
    kek.fill(0);
    if (dek) dek.fill(0);
    if (plaintext) plaintext.fill(0);
  }
}

module.exports = Object.freeze({
  ENVELOPE_VERSION,
  ALGORITHM,
  MAX_PLAINTEXT_BYTES,
  validateContext,
  createVaultEnvelope,
  decryptVaultEnvelope,
  createVaultDigestCandidates
});
