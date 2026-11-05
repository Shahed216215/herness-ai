'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyAuthorizationDecision } = require('../services/mira-hfm-authorization-decision');

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (!value || typeof value !== 'object' ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error('Unsupported fixture value');
  }
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}
function fingerprint(publicKey) {
  return crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}
function fixture() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const trustedIssuers = {
    'policy-issuer': {
      keyId: 'policy-key-v1',
      policyVersion: 'policy-v1',
      publicKeyPem,
      publicKeySha256: fingerprint(pair.publicKey)
    }
  };
  const request = {
    projectId: 'mira-test',
    actorId: 'operator-1',
    scope: 'backup:read',
    requestId: 'request-001',
    nonce: 'nonce-001'
  };
  const now = Date.now();
  const decision = {
    issuerId: 'policy-issuer',
    keyId: 'policy-key-v1',
    decisionId: 'decision-001',
    policyVersion: 'policy-v1',
    decision: 'ALLOW',
    projectId: request.projectId,
    actorId: request.actorId,
    scope: request.scope,
    requestId: request.requestId,
    nonce: request.nonce,
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60000).toISOString()
  };
  function sign(value = decision) {
    const unsigned = { ...value };
    delete unsigned.signature;
    return {
      ...unsigned,
      signature: crypto.sign(null, Buffer.from(canonicalize(unsigned)), pair.privateKey).toString('base64')
    };
  }
  const replayGuard = { async consume() { return true; } };
  return { pair, trustedIssuers, request, decision, sign, replayGuard, now };
}
async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}

(async () => {
  const f = fixture();
  const valid = await verifyAuthorizationDecision({
    decision: f.sign(), request: f.request,
    trustedIssuers: f.trustedIssuers, replayGuard: f.replayGuard, now: f.now
  });
  assert.equal(valid.status, 'SIGNED_AUTHORIZATION_DECISION_AUTHENTICATED');
  assert.equal(valid.replayGuardConsumed, true);
  assert.equal(valid.policyCorrectnessIndependentlyAudited, false);

  const tamperedSignature = f.sign();
  tamperedSignature.signature = Buffer.from('forged').toString('base64');
  await rejectsCode(verifyAuthorizationDecision({
    decision: tamperedSignature,
    request: f.request, trustedIssuers: f.trustedIssuers, replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_SIGNATURE_INVALID');

  for (const [field, value] of [
    ['projectId', 'other-project'], ['actorId', 'other-actor'],
    ['scope', 'backup:write'], ['requestId', 'other-request'], ['nonce', 'other-nonce']
  ]) {
    const alteredRequest = { ...f.request, [field]: value };
    await rejectsCode(verifyAuthorizationDecision({
      decision: f.sign(), request: alteredRequest,
      trustedIssuers: f.trustedIssuers, replayGuard: f.replayGuard, now: f.now
    }), 'HFM_AUTHZ_DECISION_MISMATCH');
  }

  const alteredTrust = {
    ...f.trustedIssuers,
    'policy-issuer': { ...f.trustedIssuers['policy-issuer'], publicKeySha256: '0'.repeat(64) }
  };
  await rejectsCode(verifyAuthorizationDecision({
    decision: f.sign(), request: f.request,
    trustedIssuers: alteredTrust, replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_TRUST_ANCHOR_MISMATCH');

  const wrongKey = {
    ...f.trustedIssuers,
    'policy-issuer': { ...f.trustedIssuers['policy-issuer'], keyId: 'different-key' }
  };
  await rejectsCode(verifyAuthorizationDecision({
    decision: f.sign(), request: f.request,
    trustedIssuers: wrongKey, replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_ISSUER_UNTRUSTED');

  const denied = f.sign({ ...f.decision, decision: 'DENY' });
  await rejectsCode(verifyAuthorizationDecision({
    decision: denied, request: f.request,
    trustedIssuers: f.trustedIssuers, replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_DECISION_MISMATCH');

  const expired = f.sign({
    ...f.decision,
    issuedAt: new Date(f.now - 120000).toISOString(),
    expiresAt: new Date(f.now - 60000).toISOString()
  });
  await rejectsCode(verifyAuthorizationDecision({
    decision: expired, request: f.request,
    trustedIssuers: f.trustedIssuers, replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_DECISION_EXPIRED_OR_INVALID');

  const overlong = f.sign({
    ...f.decision,
    issuedAt: new Date(f.now - 1000).toISOString(),
    expiresAt: new Date(f.now + 600000).toISOString()
  });
  await rejectsCode(verifyAuthorizationDecision({
    decision: overlong, request: f.request,
    trustedIssuers: f.trustedIssuers, replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_DECISION_EXPIRED_OR_INVALID');

  const future = f.sign({
    ...f.decision,
    issuedAt: new Date(f.now + 120000).toISOString(),
    expiresAt: new Date(f.now + 180000).toISOString()
  });
  await rejectsCode(verifyAuthorizationDecision({
    decision: future, request: f.request,
    trustedIssuers: f.trustedIssuers, replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_DECISION_EXPIRED_OR_INVALID');

  await rejectsCode(verifyAuthorizationDecision({
    decision: f.sign(), request: f.request, trustedIssuers: f.trustedIssuers,
    replayGuard: { async consume() { return false; } }, now: f.now
  }), 'HFM_AUTHZ_REPLAY_REJECTED');

  await rejectsCode(verifyAuthorizationDecision({
    decision: f.sign(), request: f.request, trustedIssuers: f.trustedIssuers,
    replayGuard: { async consume() { throw new Error('synthetic replay-store outage'); } }, now: f.now
  }), 'HFM_AUTHZ_REPLAY_REJECTED');

  for (const config of [
    { maxValidityMs: Infinity },
    { maxValidityMs: NaN },
    { maxValidityMs: 0 },
    { maxValidityMs: -1 },
    { maxValidityMs: 300001 },
    { maxFutureSkewMs: Infinity },
    { maxFutureSkewMs: NaN },
    { maxFutureSkewMs: -1 },
    { maxFutureSkewMs: 30001 },
    { now: Infinity }
  ]) {
    await rejectsCode(verifyAuthorizationDecision({
      decision: f.sign(), request: f.request, trustedIssuers: f.trustedIssuers,
      replayGuard: f.replayGuard, now: f.now, ...config
    }), 'HFM_AUTHZ_CONFIG_INVALID');
  }

  const malformedAnchor = {
    'policy-issuer': {
      ...f.trustedIssuers['policy-issuer'],
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\\nnot-a-valid-key\\n-----END PUBLIC KEY-----'
    }
  };
  await rejectsCode(verifyAuthorizationDecision({
    decision: f.sign(), request: f.request, trustedIssuers: malformedAnchor,
    replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_TRUST_ANCHOR_INVALID');

  const malformedSignature = f.sign();
  malformedSignature.signature = '%%%not-base64%%%';
  await rejectsCode(verifyAuthorizationDecision({
    decision: malformedSignature, request: f.request, trustedIssuers: f.trustedIssuers,
    replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_SIGNATURE_INVALID');

  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaTrust = {
    'policy-issuer': {
      keyId: 'policy-key-v1', policyVersion: 'policy-v1',
      publicKeyPem: rsa.publicKey.export({ type: 'spki', format: 'pem' }),
      publicKeySha256: fingerprint(rsa.publicKey)
    }
  };
  await rejectsCode(verifyAuthorizationDecision({
    decision: f.sign(), request: f.request, trustedIssuers: rsaTrust,
    replayGuard: f.replayGuard, now: f.now
  }), 'HFM_AUTHZ_TRUST_ANCHOR_INVALID');

  console.log('MIRA_HFM_AUTHORIZATION_DECISION_NEGATIVE_TESTS=PASS');
  console.log('CASES=valid_signature,signature_tamper,project_actor_scope_request_nonce_binding,trust_fingerprint_mismatch,key_id_mismatch,deny,expired,overlong,future_dated,replay_duplicate,replay_store_unavailable,non_ed25519_anchor');
  console.log('POLICY_CORRECTNESS_INDEPENDENTLY_AUDITED=NO');
  console.log('DURABLE_REPLAY_GUARD=NOT_PROVEN');
})().catch(error => {
  console.error('MIRA_HFM_AUTHORIZATION_DECISION_NEGATIVE_TESTS=FAIL');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
