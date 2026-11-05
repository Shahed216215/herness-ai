'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { sha256Canonical, CANONICALIZATION_PROFILE, HASH_ALGORITHM } = require('../services/mira-audit-chain-independent-verifier');
const { initializeChain, readChainState, appendEvent, pathsFor } = require('../services/mira-hfm-local-append-arbiter');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-arbiter-'));
const now = '2026-11-04T00:00:00.000Z';
const genesisBase = {
  genesisSchemaVersion: '1.0.0', genesisId: 'genesis-project-a-chain-a',
  projectId: 'project-a', chainId: 'chain-a', initialSequence: 0,
  canonicalizationProfile: CANONICALIZATION_PROFILE, hashAlgorithm: HASH_ALGORITHM,
  createdAt: now, createdBy: 'fixture-authority'
};
const genesis = { ...genesisBase, genesisHash: '' };
genesis.genesisHash = sha256Canonical(genesis, 'genesisHash');
const audit = [];
const auditWriter = event => audit.push(event);
function runWorker(eventId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, 'fixtures/mira-hfm-append-worker.js'),
      root, genesis.genesisHash, eventId
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || 'worker failed')));
  });
}
(async () => {
  try {
    await assert.rejects(initializeChain({
      root, projectId: 'project-a', chainId: 'chain-a', genesis,
      trustedGenesisHash: genesis.genesisHash, authorityReference: 'AUTH-ARB-001',
      authorizeInitialize: () => false, auditWriter
    }), /authorization denied/);
    console.log('APPEND_ARBITER_INIT_REQUIRES_AUTHORIZATION=PASS');

    const init = await initializeChain({
      root, projectId: 'project-a', chainId: 'chain-a', genesis,
      trustedGenesisHash: genesis.genesisHash, authorityReference: 'AUTH-ARB-001',
      authorizeInitialize: () => true, auditWriter
    });
    assert.equal(init.status, 'INITIALIZED');
    console.log('APPEND_ARBITER_INITIALIZED_FROM_PINNED_GENESIS=PASS');

    await assert.rejects(initializeChain({
      root, projectId: 'project-a', chainId: 'chain-a', genesis,
      trustedGenesisHash: genesis.genesisHash, authorityReference: 'AUTH-ARB-001',
      authorizeInitialize: () => true, auditWriter
    }), /already exists/);
    console.log('APPEND_ARBITER_GENESIS_STATE_IMMUTABLE=PASS');

    const results = await Promise.all([
      runWorker('event-worker-1'), runWorker('event-worker-2'),
      runWorker('event-worker-3'), runWorker('event-worker-4')
    ]);
    assert.equal(results.filter(x => x === 'APPENDED').length, 1);
    assert.equal(results.filter(x => x === 'STALE_HEAD').length, 3);
    console.log('CROSS_PROCESS_CAS_SINGLE_WINNER=PASS');

    const current = await readChainState({ root, projectId: 'project-a', chainId: 'chain-a' });
    assert.equal(current.head.sequence, 1);
    assert.equal(current.state.events.length, 1);
    console.log('APPEND_STATE_HEAD_AND_EVENT_ATOMICALLY_MATCH=PASS');

    const stale = await appendEvent({
      root, projectId: 'project-a', chainId: 'chain-a',
      expectedSequence: 0, expectedHeadHash: genesis.genesisHash,
      eventId: 'event-stale', timestamp: now, actorIdentity: 'fixture',
      action: 'stale-write', auditWriter
    });
    assert.equal(stale.status, 'STALE_HEAD');
    assert.equal(stale.writesPerformed, false);
    console.log('STALE_HEAD_WRITE_REJECTED_WITHOUT_MUTATION=PASS');

    await assert.rejects(appendEvent({
      root, projectId: 'project-a', chainId: 'chain-a',
      expectedSequence: 1, expectedHeadHash: current.head.hash,
      eventId: current.state.events[0].eventId, timestamp: now,
      actorIdentity: 'fixture', action: 'duplicate-id', auditWriter
    }), /Duplicate eventId/);
    console.log('DUPLICATE_EVENT_ID_REJECTED=PASS');

    const lock = pathsFor(root, 'project-a', 'chain-a').lockFile;
    fs.writeFileSync(lock, JSON.stringify({ pid: -1, createdAt: now }));
    await assert.rejects(appendEvent({
      root, projectId: 'project-a', chainId: 'chain-a',
      expectedSequence: 1, expectedHeadHash: current.head.hash,
      eventId: 'event-lock-busy', timestamp: now, actorIdentity: 'fixture',
      action: 'lock-busy', auditWriter, lockAttempts: 2, lockDelayMs: 1
    }), error => error.code === 'ARBITER_LOCK_BUSY');
    fs.unlinkSync(lock);
    console.log('STALE_LOCK_FAILS_CLOSED_NO_AUTO_STEAL=PASS');

    const auditedAppend = await appendEvent({
      root, projectId: 'project-a', chainId: 'chain-a',
      expectedSequence: 1, expectedHeadHash: current.head.hash,
      eventId: 'event-audit-check', timestamp: now, actorIdentity: 'fixture',
      action: 'audit-check', auditWriter
    });
    assert.equal(auditedAppend.status, 'APPENDED');
    console.log('APPEND_AUDITABLE_COMMIT_CONFIRMED=PASS');

    let uncertainError;
    try {
      await appendEvent({
        root, projectId: 'project-a', chainId: 'chain-a',
        expectedSequence: 2, expectedHeadHash: auditedAppend.head.hash,
        eventId: 'event-uncertain-ack', timestamp: now, actorIdentity: 'fixture',
        action: 'uncertain-ack', auditWriter: event => {
          if (event.action === 'hfm_append_event_committed') throw new Error('INJECTED_ACK_FAILURE');
        }
      });
    } catch (error) {
      uncertainError = error;
    }
    assert.ok(uncertainError);
    assert.equal(uncertainError.stateCommitted, true);
    const recovered = await readChainState({ root, projectId: 'project-a', chainId: 'chain-a' });
    assert.equal(recovered.head.sequence, 3);
    assert.equal(recovered.state.events[2].eventId, 'event-uncertain-ack');
    console.log('UNCERTAIN_ACK_RECOVERED_BY_AUTHORITATIVE_READBACK=PASS');

    assert.ok(audit.some(x => x.action === 'hfm_append_event_intent'));
    assert.ok(audit.some(x => x.action === 'hfm_append_event_committed'));
    console.log('APPEND_ARBITER_AUDIT_INTENT_AND_COMMIT=PASS');

    console.log('TESTS_FAILED=0');
    console.log('RESULT=MIRA_HFM_LOCAL_APPEND_ARBITER_ISOLATED_PASS');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
