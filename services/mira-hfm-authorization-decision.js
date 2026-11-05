'use strict';

const crypto = require('node:crypto');

const DEFAULT_MAX_VALIDITY_MS = 300000;
const DEFAULT_FUTURE_SKEW_MS = 30000;

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
  if (!isPlainObject(decision) || !isPlainObject(request) || !isPlainObject(trustedIssuers) ||
      !isPlainObject(replayGuard) || typeof replayGuard.consume !== 'function') {
    fail('A signed authorization decision, independent issuer trust store, request and replay guard are required.',
      'HFM_AUTHZ_CONTRACT_MISSING');
  }
  const required = ['issuerId', 'keyId', 'decisionId', 'policyVersion', 'projectId',
    'actorId', 'scope', 'requestId', 'nonce', 'issuedAt', 'expiresAt', 'signature'];
  if (required.some(k => typeof decision[k] !== 'string' || !decision[k].trim()) ||
      decision.decision !== 'ALLOW' ||
      decision.projectId !== request.projectId || decision.actorId !== request.actorId ||
      decision.scope !== request.scope || decision.requestId !== request.requestId ||
      decision.nonce !== request.nonce || request.scope !== 'backup:read') {
    fail('Authorization decision is denied, incomplete, or not bound to the exact request.',
      'HFM_AUTHZ_DECISION_MISMATCH');
  }
  const trusted = trustedIssuers[decision.issuerId];
  if (!isPlainObject(trusted) || trusted.keyId !== decision.keyId ||
      typeof trusted.policyVersion !== 'string' || !trusted.policyVersion.trim() ||
      decision.policyVersion !== trusted.policyVersion ||
      typeof trusted.publicKeyPem !== 'string' || !trusted.publicKeyPem.includes('PUBLIC KEY') ||
      typeof trusted.publicKeySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(trusted.publicKeySha256)) {
    fail('Authorization decision issuer is not independently trusted.', 'HFM_AUTHZ_ISSUER_UNTRUSTED');
  }
  const publicKey = crypto.createPublicKey(trusted.publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    fail('Authorization issuer trust anchor must be Ed25519.', 'HFM_AUTHZ_TRUST_ANCHOR_INVALID');
  }
  const fingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  if (fingerprint !== trusted.publicKeySha256) {
    fail('Authorization issuer trust-anchor fingerprint mismatch.', 'HFM_AUTHZ_TRUST_ANCHOR_MISMATCH');
  }
  const issuedAt = Date.parse(decision.issuedAt);
  const expiresAt = Date.parse(decision.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt > now + maxFutureSkewMs || expiresAt <= now ||
      expiresAt <= issuedAt || expiresAt - issuedAt > maxValidityMs) {
    fail('Authorization decision is expired, future-dated, or exceeds its maximum validity.',
      'HFM_AUTHZ_DECISION_EXPIRED_OR_INVALID');
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(decision.signature)) {
    fail('Authorization decision signature encoding is invalid.', 'HFM_AUTHZ_SIGNATURE_INVALID');
  }
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(canonicalize(unsignedDecision(decision)), 'utf8'),
      publicKey, Buffer.from(decision.signature, 'base64'));
  } catch { valid = false; }
  if (!valid) fail('Authorization decision signature verification failed.', 'HFM_AUTHZ_SIGNATURE_INVALID');

  const consumed = await replayGuard.consume({
    issuerId: decision.issuerId, decisionId: decision.decisionId,
    requestId: decision.requestId, nonce: decision.nonce, expiresAt: decision.expiresAt
  });
  if (consumed !== true) {
    fail('Authorization decision was already consumed or replay protection is unavailable.',
      'HFM_AUTHZ_REPLAY_REJECTED');
  }
  return {
    status: 'SIGNED_AUTHORIZATION_DECISION_AUTHENTICATED',
    issuerId: decision.issuerId, keyId: decision.keyId,
    decisionId: decision.decisionId, policyVersion: decision.policyVersion,
    expiresAt: decision.expiresAt, trustAnchorSha256: fingerprint,
    replayGuardConsumed: true,
    policyCorrectnessIndependentlyAudited: false
  };
}

module.exports = { verifyAuthorizationDecision, DEFAULT_MAX_VALIDITY_MS };
