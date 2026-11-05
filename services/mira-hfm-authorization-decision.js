'use strict';

const crypto = require('node:crypto');

const DEFAULT_MAX_VALIDITY_MS = 300000;
const DEFAULT_FUTURE_SKEW_MS = 30000;
const MAX_CONFIGURED_VALIDITY_MS = DEFAULT_MAX_VALIDITY_MS;

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
function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (!isPlainObject(value)) throw new Error('Authorization decision contains an unsupported value.');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function unsignedDecision(decision) {
  const { signature, ...unsigned } = decision;
  return unsigned;
}

/**
 * Authenticates a short-lived, request-bound authorization decision using a
 * trust store separate from the snapshot-source signing trust store.
 * replayGuard.consume must be an atomic, durable one-time claim in real
 * deployments; an in-memory Set is suitable only for isolated tests.
 */
async function verifyAuthorizationDecision({
  decision, request, trustedIssuers, replayGuard, now = Date.now(),
  maxValidityMs = DEFAULT_MAX_VALIDITY_MS, maxFutureSkewMs = DEFAULT_FUTURE_SKEW_MS
}) {
  if (!Number.isSafeInteger(now) ||
      !Number.isSafeInteger(maxValidityMs) || maxValidityMs < 1 ||
      maxValidityMs > MAX_CONFIGURED_VALIDITY_MS ||
      !Number.isSafeInteger(maxFutureSkewMs) || maxFutureSkewMs < 0 ||
      maxFutureSkewMs > DEFAULT_FUTURE_SKEW_MS) {
    fail('Authorization verifier time configuration is invalid or exceeds its fixed safety limits.',
      'HFM_AUTHZ_CONFIG_INVALID');
  }
  if (!isPlainObject(decision) || !isPlainObject(request) || !isPlainObject(trustedIssuers) ||
      !isPlainObject(replayGuard) || typeof replayGuard.consume !== 'function') {
    fail('A signed authorization decision, independent issuer trust store, request and replay guard are required.',
      'HFM_AUTHZ_CONTRACT_MISSING');
  }
  let stableDecision, stableRequest, stableTrustedIssuers;
  try {
    stableDecision = JSON.parse(canonicalize(decision));
    stableRequest = JSON.parse(canonicalize(request));
    stableTrustedIssuers = JSON.parse(canonicalize(trustedIssuers));
  } catch {
    fail('Authorization decision, request, or trust configuration cannot be snapshotted safely.',
      'HFM_AUTHZ_CONTRACT_INVALID');
  }
  const consumeReplay = replayGuard.consume;
  const required = ['issuerId', 'keyId', 'decisionId', 'policyVersion', 'projectId',
    'actorId', 'scope', 'requestId', 'nonce', 'issuedAt', 'expiresAt', 'signature'];
  if (required.some(k => typeof stableDecision[k] !== 'string' || !stableDecision[k].trim()) ||
      stableDecision.decision !== 'ALLOW' ||
      stableDecision.projectId !== stableRequest.projectId || stableDecision.actorId !== stableRequest.actorId ||
      stableDecision.scope !== stableRequest.scope || stableDecision.requestId !== stableRequest.requestId ||
      stableDecision.nonce !== stableRequest.nonce || stableRequest.scope !== 'backup:read') {
    fail('Authorization decision is denied, incomplete, or not bound to the exact request.',
      'HFM_AUTHZ_DECISION_MISMATCH');
  }
  const trusted = stableTrustedIssuers[stableDecision.issuerId];
  if (!isPlainObject(trusted) || trusted.keyId !== stableDecision.keyId ||
      typeof trusted.policyVersion !== 'string' || !trusted.policyVersion.trim() ||
      stableDecision.policyVersion !== trusted.policyVersion ||
      typeof trusted.publicKeyPem !== 'string' || !trusted.publicKeyPem.includes('PUBLIC KEY') ||
      typeof trusted.publicKeySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(trusted.publicKeySha256)) {
    fail('Authorization decision issuer is not independently trusted.', 'HFM_AUTHZ_ISSUER_UNTRUSTED');
  }
  let publicKey;
  try { publicKey = crypto.createPublicKey(trusted.publicKeyPem); }
  catch {
    fail('Authorization issuer trust anchor is malformed.', 'HFM_AUTHZ_TRUST_ANCHOR_INVALID');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    fail('Authorization issuer trust anchor must be Ed25519.', 'HFM_AUTHZ_TRUST_ANCHOR_INVALID');
  }
  const fingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  if (fingerprint !== trusted.publicKeySha256) {
    fail('Authorization issuer trust-anchor fingerprint mismatch.', 'HFM_AUTHZ_TRUST_ANCHOR_MISMATCH');
  }
  const issuedAt = Date.parse(stableDecision.issuedAt);
  const expiresAt = Date.parse(stableDecision.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt > now + maxFutureSkewMs || expiresAt <= now ||
      expiresAt <= issuedAt || expiresAt - issuedAt > maxValidityMs) {
    fail('Authorization decision is expired, future-dated, or exceeds its maximum validity.',
      'HFM_AUTHZ_DECISION_EXPIRED_OR_INVALID');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(stableDecision.signature) ||
      Buffer.from(stableDecision.signature, 'base64').toString('base64') !== stableDecision.signature) {
    fail('Authorization decision signature encoding is invalid.', 'HFM_AUTHZ_SIGNATURE_INVALID');
  }
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(canonicalize(unsignedDecision(stableDecision)), 'utf8'),
      publicKey, Buffer.from(stableDecision.signature, 'base64'));
  } catch { valid = false; }
  if (!valid) fail('Authorization decision signature verification failed.', 'HFM_AUTHZ_SIGNATURE_INVALID');

  let consumed = false;
  try {
    consumed = await consumeReplay.call(replayGuard, {
      issuerId: stableDecision.issuerId, decisionId: stableDecision.decisionId,
      requestId: stableDecision.requestId, nonce: stableDecision.nonce, expiresAt: stableDecision.expiresAt
    });
  } catch {
    fail('Authorization decision was already consumed or replay protection is unavailable.',
      'HFM_AUTHZ_REPLAY_REJECTED');
  }
  if (consumed !== true) {
    fail('Authorization decision was already consumed or replay protection is unavailable.',
      'HFM_AUTHZ_REPLAY_REJECTED');
  }
  return {
    status: 'SIGNED_AUTHORIZATION_DECISION_AUTHENTICATED',
    issuerId: stableDecision.issuerId, keyId: stableDecision.keyId,
    decisionId: stableDecision.decisionId, policyVersion: stableDecision.policyVersion,
    expiresAt: stableDecision.expiresAt, trustAnchorSha256: fingerprint,
    replayGuardConsumed: true,
    policyCorrectnessIndependentlyAudited: false
  };
}

module.exports = { verifyAuthorizationDecision, DEFAULT_MAX_VALIDITY_MS };
