'use strict';

const crypto = require('node:crypto');

function validText(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

/**
 * Isolated test fake only. The Set is process-local and is NOT a durable,
 * multi-process or production replay store.
 */
function createLocalFakeAuthorizationReplayGuard({ now = Date.now(), initialClaims = [] } = {}) {
  if (!Number.isSafeInteger(now) || !Array.isArray(initialClaims) ||
      initialClaims.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
    const error = new Error('Local fake replay-guard seed is invalid.');
    error.code = 'HFM_AUTHZ_REPLAY_FAKE_CONFIG_INVALID';
    throw error;
  }
  const consumed = new Set(initialClaims);
  async function consume(claim) {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim) ||
        !validText(claim.issuerId) || !validText(claim.decisionId) ||
        !validText(claim.requestId) || !validText(claim.nonce) ||
        typeof claim.expiresAt !== 'string') return false;
    const expiresAt = Date.parse(claim.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
    const key = crypto.createHash('sha256').update(JSON.stringify([
      claim.issuerId, claim.decisionId, claim.requestId, claim.nonce
    ])).digest('hex');
    if (consumed.has(key)) return false;
    consumed.add(key);
    return true;
  }
  return Object.freeze({
    consume,
    snapshotClaims() { return Object.freeze(Array.from(consumed).sort()); },
    status: 'LOCAL_FAKE_REPLAY_GUARD_NOT_DURABLE'
  });
}

module.exports = { createLocalFakeAuthorizationReplayGuard };
