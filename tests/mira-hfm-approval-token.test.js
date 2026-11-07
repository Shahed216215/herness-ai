'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  signApprovalToken, createApprovalTokenVerifier,
  validatePayload, MAX_APPROVAL_TTL_MS
} = require('../services/mira-hfm-approval-token');

const now = Date.now();
const secret = 'hfm-approval-token-test-secret-32-bytes-minimum';
const expected = Object.freeze({
  projectId: 'project-alpha',
  actorId: 'mira:mira.admins:admin-subject-001',
  approverActorId: 'mira:mira.admins:admin-subject-001',
  operation: 'memory.read',
  resource: 'memory:project:project-alpha',
  purpose: 'approved retrieval'
});
const payload = Object.freeze({
  approvalRef: 'approval-ref-001',
  nonce: crypto.randomBytes(32).toString('base64url'),
  ...expected,
  issuedAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 120000).toISOString(),
  maxUses: 1
});

(async () => {
  const token = signApprovalToken({ secret, payload });
  const consumed = [];
  const verify = createApprovalTokenVerifier({
    secret,
    async consumeNonce(receipt) {
      consumed.push(receipt);
      return true;
    }
  });
  const receipt = await verify(token, expected, { consume: true, singleUse: true });
  assert.equal(receipt.verified, true);
  assert.equal(receipt.approved, true);
  assert.equal(receipt.consumed, true);
  assert.equal(receipt.maxUses, 1);
  assert.equal(receipt.actorId, expected.actorId);
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].singleUse, true);
  assert.equal(consumed[0].nonceHash.length, 64);
  console.log('HFM_APPROVAL_TOKEN_HMAC_AND_SCOPE_VALIDATION=PASS');
  console.log('HFM_APPROVAL_TOKEN_ATOMIC_NONCE_CONSUMPTION_REQUIRED=PASS');

  await assert.rejects(
    verify(token, { ...expected, projectId: 'project-attacker' }, { consume: true, singleUse: true }),
    error => error.code === 'HFM_APPROVAL_TOKEN_SCOPE_MISMATCH'
  );
  console.log('HFM_APPROVAL_TOKEN_CROSS_PROJECT_SCOPE_BLOCK=PASS');

  await assert.rejects(
    verify(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), expected, { consume: true, singleUse: true }),
    error => error.code === 'HFM_APPROVAL_TOKEN_SIGNATURE_INVALID'
  );
  console.log('HFM_APPROVAL_TOKEN_TAMPER_BLOCK=PASS');

  const replayVerifier = createApprovalTokenVerifier({
    secret, async consumeNonce() { return false; }
  });
  await assert.rejects(
    replayVerifier(token, expected, { consume: true, singleUse: true }),
    error => error.code === 'HFM_APPROVAL_TOKEN_REPLAY_OR_UNKNOWN'
  );
  console.log('HFM_APPROVAL_TOKEN_REPLAY_BLOCK=PASS');

  await assert.rejects(
    verify(token, expected, { consume: false, singleUse: true }),
    error => error.code === 'HFM_APPROVAL_TOKEN_CONSUMPTION_REQUIRED'
  );
  console.log('HFM_APPROVAL_TOKEN_NON_CONSUMING_VERIFY_BLOCK=PASS');

  assert.throws(() => validatePayload({ ...payload, maxUses: 2 }), /SINGLE_USE_REQUIRED/);
  assert.throws(() => validatePayload({
    ...payload, expiresAt: new Date(now + MAX_APPROVAL_TTL_MS + 1000).toISOString()
  }), /TIME_INVALID/);
  assert.throws(() => createApprovalTokenVerifier({ secret: 'short', consumeNonce: async () => true }),
    /SECRET_INVALID/);
  console.log('HFM_APPROVAL_TOKEN_SINGLE_USE_AND_TTL_BOUNDS=PASS');
  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
