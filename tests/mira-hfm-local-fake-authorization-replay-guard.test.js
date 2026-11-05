'use strict';

const assert = require('node:assert/strict');
const { createLocalFakeAuthorizationReplayGuard } =
  require('../services/mira-hfm-local-fake-authorization-replay-guard');

(async () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z');
  const claim = {
    issuerId: 'policy-issuer',
    decisionId: 'decision-001',
    requestId: 'request-001',
    nonce: 'nonce-001',
    expiresAt: '2026-11-05T12:05:00.000Z'
  };
  const guard = createLocalFakeAuthorizationReplayGuard({ now });
  const outcomes = await Promise.all(Array.from({ length: 32 }, () => guard.consume(claim)));
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(guard.status, 'LOCAL_FAKE_REPLAY_GUARD_NOT_DURABLE');

  const restartSnapshot = guard.snapshotClaims();
  const restarted = createLocalFakeAuthorizationReplayGuard({ now, initialClaims: restartSnapshot });
  assert.equal(await restarted.consume(claim), false);

  const expiredGuard = createLocalFakeAuthorizationReplayGuard({ now });
  assert.equal(await expiredGuard.consume({
    ...claim, expiresAt: '2026-11-05T11:59:59.000Z'
  }), false);
  assert.equal(await expiredGuard.consume({ ...claim, nonce: '' }), false);

  assert.throws(() => createLocalFakeAuthorizationReplayGuard({
    now: NaN
  }), error => error.code === 'HFM_AUTHZ_REPLAY_FAKE_CONFIG_INVALID');

  process.stdout.write('MIRA_HFM_AUTHZ_LOCAL_FAKE_REPLAY_ATOMIC_SINGLE_WINNER_PASS\\n');
  process.stdout.write('MIRA_HFM_AUTHZ_LOCAL_FAKE_REPLAY_RESTART_SIMULATION_PASS\\n');
  process.stdout.write('MIRA_HFM_AUTHZ_LOCAL_FAKE_REPLAY_EXPIRED_AND_INVALID_REJECTED_PASS\\n');
  process.stdout.write('PRODUCTION_DURABLE_REPLAY_GUARD=NOT_PROVEN\\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
