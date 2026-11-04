'use strict';

const crypto = require('node:crypto');
const { isCanonicalTimestamp: validCanonicalTimestamp } = require('./mira-hfm-timestamp-profile');

const VERIFIER_VERSION = '1.0.0';
const CANONICALIZATION_PROFILE = 'RFC8785-JCS-UTF8-v1';
const HASH_ALGORITHM = 'SHA-256';
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function isWellFormedUnicode(value) {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      i += 1;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function canonicalizeJcs(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    if (!isWellFormedUnicode(value)) throw new Error('Invalid Unicode string.');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number is not supported by JCS.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = [];
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) throw new Error('Sparse arrays are not supported by JCS.');
      items.push(canonicalizeJcs(value[i]));
    }
    return '[' + items.join(',') + ']';
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Only plain JSON objects are supported by JCS.');
    }
    const keys = Object.keys(value).sort();
    const pairs = [];
    for (const key of keys) {
      if (!isWellFormedUnicode(key)) throw new Error('Invalid Unicode object key.');
      const item = value[key];
      if (item === undefined) throw new Error('Undefined object values are not supported by JCS.');
      pairs.push(JSON.stringify(key) + ':' + canonicalizeJcs(item));
    }
    return '{' + pairs.join(',') + '}';
  }
  throw new Error('Unsupported value for JCS canonicalization.');
}

function sha256Canonical(value, excludedField) {
  const body = Object.create(null);
  for (const key of Object.keys(value)) {
    if (key !== excludedField) body[key] = value[key];
  }
  const bytes = Buffer.from(canonicalizeJcs(body), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fail(reason, details = {}) {
  return {
    status: 'INTEGRITY_FAILED',
    verifierVersion: VERIFIER_VERSION,
    reason,
    details,
    writesPerformed: false
  };
}

function inconclusive(reason, details = {}) {
  return {
    status: 'INCONCLUSIVE',
    verifierVersion: VERIFIER_VERSION,
    reason,
    details,
    writesPerformed: false
  };
}

function verifyAuditChainExport({
  projectId,
  chainId,
  genesis,
  trustedGenesisHash,
  events,
  checkpoint,
  trustedCheckpointHash
}) {
  if (typeof projectId !== 'string' || !projectId.trim() ||
      typeof chainId !== 'string' || !chainId.trim()) {
    return inconclusive('PROJECT_OR_CHAIN_SCOPE_MISSING');
  }
  if (!genesis || typeof genesis !== 'object' || Array.isArray(genesis)) {
    return inconclusive('GENESIS_MISSING_OR_INVALID');
  }
  if (!HASH_PATTERN.test(trustedGenesisHash || '')) {
    return inconclusive('TRUSTED_GENESIS_HASH_NOT_PROVISIONED');
  }
  if (!Array.isArray(events)) return inconclusive('EVENT_EXPORT_MISSING');
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    return inconclusive('CHECKPOINT_MISSING_OR_INVALID');
  }
  if (!HASH_PATTERN.test(trustedCheckpointHash || '')) {
    return inconclusive('TRUSTED_CHECKPOINT_HASH_NOT_PROVISIONED');
  }

  try {
    if (genesis.genesisSchemaVersion !== '1.0.0' ||
        genesis.projectId !== projectId || genesis.chainId !== chainId ||
        genesis.canonicalizationProfile !== CANONICALIZATION_PROFILE ||
        genesis.hashAlgorithm !== HASH_ALGORITHM || genesis.initialSequence !== 0 ||
        !validCanonicalTimestamp(genesis.createdAt)) {
      return fail('GENESIS_SCHEMA_OR_SCOPE_MISMATCH');
    }
    const genesisHash = sha256Canonical(genesis, 'genesisHash');
    if (genesis.genesisHash !== genesisHash || genesisHash !== trustedGenesisHash) {
      return fail('GENESIS_HASH_OR_TRUST_ANCHOR_MISMATCH', { expected: trustedGenesisHash, actual: genesisHash });
    }

    let previousHash = genesisHash;
    let expectedSequence = 1;
    const seenIds = new Set();
    const verifiedEvents = [];

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        return fail('INVALID_EVENT_OBJECT', { index });
      }
      if (event.projectId !== projectId || event.chainId !== chainId) {
        return fail('PROJECT_OR_CHAIN_SCOPE_MISMATCH', { index });
      }
      if (typeof event.eventId !== 'string' || !event.eventId.trim() || seenIds.has(event.eventId)) {
        return fail('MISSING_OR_DUPLICATE_EVENT_ID', { index, eventId: event.eventId || null });
      }
      seenIds.add(event.eventId);
      if (event.eventSchemaVersion !== '1.0.0' ||
          event.canonicalizationProfile !== CANONICALIZATION_PROFILE ||
          event.hashAlgorithm !== HASH_ALGORITHM ||
          !Number.isSafeInteger(event.sequence) || event.sequence !== expectedSequence) {
        return fail('EVENT_SCHEMA_OR_SEQUENCE_MISMATCH', { index, expectedSequence, actualSequence: event.sequence });
      }
      if (!validCanonicalTimestamp(event.timestamp)) {
        return fail('NON_CANONICAL_EVENT_TIMESTAMP', { index, timestamp: event.timestamp });
      }
      if (typeof event.actorIdentity !== 'string' || !event.actorIdentity.trim() ||
          typeof event.action !== 'string' || !event.action.trim()) {
        return fail('EVENT_ACTOR_OR_ACTION_MISSING', { index });
      }
      if (event.previousHash !== previousHash) {
        return fail('PREVIOUS_HASH_LINK_MISMATCH', { index, expected: previousHash, actual: event.previousHash });
      }
      const expectedHash = sha256Canonical(event, 'eventHash');
      if (!HASH_PATTERN.test(event.eventHash || '') || event.eventHash !== expectedHash) {
        return fail('EVENT_HASH_MISMATCH', { index, expected: expectedHash, actual: event.eventHash || null });
      }
      previousHash = event.eventHash;
      expectedSequence += 1;
      verifiedEvents.push({ eventId: event.eventId, sequence: event.sequence, eventHash: event.eventHash });
    }

    if (checkpoint.projectId !== projectId || checkpoint.chainId !== chainId ||
        checkpoint.sequence !== expectedSequence - 1 ||
        checkpoint.chainHash !== previousHash ||
        checkpoint.canonicalizationProfile !== CANONICALIZATION_PROFILE ||
        checkpoint.hashAlgorithm !== HASH_ALGORITHM ||
        !validCanonicalTimestamp(checkpoint.createdAt)) {
      return fail('CHECKPOINT_SCOPE_OR_HEAD_MISMATCH', {
        expectedSequence: expectedSequence - 1,
        expectedChainHash: previousHash
      });
    }
    const checkpointHash = sha256Canonical(checkpoint, 'checkpointHash');
    if (checkpoint.checkpointHash !== checkpointHash || checkpointHash !== trustedCheckpointHash) {
      return fail('CHECKPOINT_HASH_OR_TRUST_ANCHOR_MISMATCH', {
        expected: trustedCheckpointHash, actual: checkpointHash
      });
    }

    const reportBody = {
      verificationSchemaVersion: '1.0.0',
      projectId,
      chainId,
      verifierVersion: VERIFIER_VERSION,
      canonicalizationProfile: CANONICALIZATION_PROFILE,
      hashAlgorithm: HASH_ALGORITHM,
      genesisHash,
      checkedRange: { firstSequence: 1, lastSequence: expectedSequence - 1 },
      verifiedEventCount: verifiedEvents.length,
      chainHeadHash: previousHash,
      checkpointHash,
      eventEvidence: verifiedEvents,
      genesisAuthenticity: 'PINNED_HASH_ONLY',
      checkpointAuthenticity: 'PINNED_HASH_ONLY',
      limitations: [
        'No digital signature or writer identity cryptographic verification is performed.',
        'Trust-anchor provisioning and custody are external to this verifier.',
        'This verifier does not qualify provider atomicity or durable append acknowledgement.',
        'The verifier is read-only and never repairs or rewrites source data.'
      ]
    };
    return {
      status: 'VERIFIED',
      ...reportBody,
      evidenceDigest: crypto.createHash('sha256').update(Buffer.from(canonicalizeJcs(reportBody), 'utf8')).digest('hex'),
      writesPerformed: false
    };
  } catch (error) {
    return fail('UNSUPPORTED_OR_MALFORMED_CANONICAL_DATA', { message: error.message });
  }
}

module.exports = {
  VERIFIER_VERSION,
  CANONICALIZATION_PROFILE,
  HASH_ALGORITHM,
  canonicalizeJcs,
  sha256Canonical,
  validCanonicalTimestamp,
  verifyAuditChainExport
};
