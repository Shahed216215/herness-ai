'use strict';

const assert = require('node:assert/strict');
const {
  VERIFIER_VERSION,
  CANONICALIZATION_PROFILE,
  HASH_ALGORITHM,
  canonicalizeJcs,
  sha256Canonical,
  validCanonicalTimestamp,
  verifyAuditChainExport
} = require('../services/mira-audit-chain-independent-verifier');

const timestamp = '2026-11-03T12:00:00.000Z';
const projectId = 'mira-hfm-fixture-project';
const chainId = 'mira-hfm-fixture-chain';

function makeGenesis(overrides = {}) {
  const genesis = {
    genesisSchemaVersion: '1.0.0',
    projectId,
    chainId,
    createdAt: timestamp,
    canonicalizationProfile: CANONICALIZATION_PROFILE,
    hashAlgorithm: HASH_ALGORITHM,
    initialSequence: 0,
    ...overrides
  };
  genesis.genesisHash = sha256Canonical(genesis, 'genesisHash');
  return genesis;
}

function makeEvent(genesis, sequence, previousHash, overrides = {}) {
  const event = {
    eventSchemaVersion: '1.0.0',
    projectId,
    chainId,
    eventId: 'event-' + sequence,
    sequence,
    timestamp,
    actorIdentity: 'fixture:authorized-writer',
    action: 'memory.recorded',
    payload: { text: 'fixture-' + sequence, nested: { count: sequence } },
    previousHash,
    canonicalizationProfile: CANONICALIZATION_PROFILE,
    hashAlgorithm: HASH_ALGORITHM,
    ...overrides
  };
  event.eventHash = sha256Canonical(event, 'eventHash');
  return event;
}

function makeFixture() {
  const genesis = makeGenesis();
  const first = makeEvent(genesis, 1, genesis.genesisHash);
  const second = makeEvent(genesis, 2, first.eventHash);
  const checkpoint = {
    checkpointSchemaVersion: '1.0.0',
    projectId,
    chainId,
    sequence: 2,
    chainHash: second.eventHash,
    createdAt: timestamp,
    canonicalizationProfile: CANONICALIZATION_PROFILE,
    hashAlgorithm: HASH_ALGORITHM
  };
  checkpoint.checkpointHash = sha256Canonical(checkpoint, 'checkpointHash');
  return {
    projectId, chainId, genesis, events: [first, second], checkpoint,
    trustedGenesisHash: genesis.genesisHash,
    trustedCheckpointHash: checkpoint.checkpointHash
  };
}

function run() {
  assert.equal(VERIFIER_VERSION, '1.0.0');
  assert.equal(canonicalizeJcs({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(
    canonicalizeJcs({ unicode: 'é', nested: { z: 0, a: [true, null] } }),
    '{"nested":{"a":[true,null],"z":0},"unicode":"é"}'
  );
  assert.equal(sha256Canonical({ a: 1, b: 2 }, 'excluded'),
    '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
  assert.throws(() => canonicalizeJcs({ bad: undefined }), /Undefined object values/);
  assert.throws(() => canonicalizeJcs(Number.NaN), /Non-finite number/);
  assert.throws(() => canonicalizeJcs(new Date()), /plain JSON objects/);
  assert.throws(() => canonicalizeJcs('\uD800'), /Invalid Unicode/);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => canonicalizeJcs(sparse), /Sparse arrays/);

  assert.equal(validCanonicalTimestamp(timestamp), true);
  assert.equal(validCanonicalTimestamp('2026-11-03T12:00:00Z'), false);
  assert.equal(validCanonicalTimestamp('2026-02-30T12:00:00.000Z'), false);
  assert.equal(validCanonicalTimestamp('2026-11-03T12:00:60.000Z'), false);

  const fixture = makeFixture();
  const valid = verifyAuditChainExport(fixture);
  assert.equal(valid.status, 'VERIFIED');
  assert.equal(valid.verifiedEventCount, 2);
  assert.equal(valid.checkedRange.firstSequence, 1);
  assert.equal(valid.checkedRange.lastSequence, 2);
  assert.equal(valid.genesisAuthenticity, 'PINNED_HASH_ONLY');
  assert.equal(valid.checkpointAuthenticity, 'PINNED_HASH_ONLY');
  assert.equal(valid.writesPerformed, false);
  assert.ok(valid.evidenceDigest);

  assert.equal(verifyAuditChainExport({
    ...fixture, trustedGenesisHash: undefined
  }).status, 'INCONCLUSIVE');
  assert.equal(verifyAuditChainExport({
    ...fixture, trustedCheckpointHash: undefined
  }).status, 'INCONCLUSIVE');

  const tamperedEvents = fixture.events.map(event => ({ ...event, payload: structuredClone(event.payload) }));
  tamperedEvents[0].payload.text = 'tampered';
  assert.equal(verifyAuditChainExport({ ...fixture, events: tamperedEvents }).reason, 'EVENT_HASH_MISMATCH');

  assert.equal(verifyAuditChainExport({
    ...fixture, events: [fixture.events[1]]
  }).reason, 'EVENT_SCHEMA_OR_SEQUENCE_MISMATCH');

  const forkEvents = [
    fixture.events[0],
    makeEvent(fixture.genesis, 2, '0'.repeat(64))
  ];
  assert.equal(verifyAuditChainExport({ ...fixture, events: forkEvents }).reason, 'PREVIOUS_HASH_LINK_MISMATCH');

  const duplicateEvents = [
    fixture.events[0],
    makeEvent(fixture.genesis, 2, fixture.events[0].eventHash, { eventId: fixture.events[0].eventId })
  ];
  assert.equal(verifyAuditChainExport({ ...fixture, events: duplicateEvents }).reason, 'MISSING_OR_DUPLICATE_EVENT_ID');

  const wrongProjectEvents = fixture.events.map(event => ({ ...event, projectId: 'other-project' }));
  wrongProjectEvents[0].eventHash = sha256Canonical(wrongProjectEvents[0], 'eventHash');
  wrongProjectEvents[1].previousHash = wrongProjectEvents[0].eventHash;
  wrongProjectEvents[1].eventHash = sha256Canonical(wrongProjectEvents[1], 'eventHash');
  assert.equal(verifyAuditChainExport({ ...fixture, events: wrongProjectEvents }).reason, 'PROJECT_OR_CHAIN_SCOPE_MISMATCH');

  const wrongCheckpoint = { ...fixture.checkpoint, chainHash: 'f'.repeat(64) };
  wrongCheckpoint.checkpointHash = sha256Canonical(wrongCheckpoint, 'checkpointHash');
  assert.equal(verifyAuditChainExport({ ...fixture, checkpoint: wrongCheckpoint }).reason, 'CHECKPOINT_SCOPE_OR_HEAD_MISMATCH');

  const wrongGenesis = { ...fixture.genesis, projectId: 'other-project' };
  wrongGenesis.genesisHash = sha256Canonical(wrongGenesis, 'genesisHash');
  assert.equal(verifyAuditChainExport({ ...fixture, genesis: wrongGenesis }).reason, 'GENESIS_SCHEMA_OR_SCOPE_MISMATCH');

  const badTimestampEvents = fixture.events.map(event => ({ ...event }));
  badTimestampEvents[0].timestamp = '2026-11-03';
  badTimestampEvents[0].eventHash = sha256Canonical(badTimestampEvents[0], 'eventHash');
  assert.equal(verifyAuditChainExport({ ...fixture, events: badTimestampEvents }).reason, 'NON_CANONICAL_EVENT_TIMESTAMP');

  console.log('JCS_CANONICAL_OBJECT_KEY_ORDER=PASS');
  console.log('JCS_UNICODE_AND_NESTED_VALUES=PASS');
  console.log('JCS_FIXED_SHA256_VECTOR=PASS');
  console.log('JCS_UNSUPPORTED_VALUES_REJECTED=PASS');
  console.log('U06_CANONICAL_UTC_MILLISECOND_TIMESTAMP=PASS');
  console.log('U03_PINNED_GENESIS_ANCHOR=PASS');
  console.log('E15_VALID_CHAIN_AND_CHECKPOINT=PASS');
  console.log('E15_TRUST_ANCHORS_REQUIRED=PASS');
  console.log('E15_EVENT_TAMPER_DETECTION=PASS');
  console.log('E15_SEQUENCE_GAP_DETECTION=PASS');
  console.log('E15_FORK_DETECTION=PASS');
  console.log('E15_DUPLICATE_EVENT_ID_DETECTION=PASS');
  console.log('E15_PROJECT_ISOLATION=PASS');
  console.log('E15_CHECKPOINT_HEAD_BINDING=PASS');
  console.log('E15_NON_CANONICAL_TIMESTAMP_REJECTED=PASS');
  console.log('VERIFIER_READ_ONLY=PASS');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=PHASE2_INDEPENDENT_AUDIT_CHAIN_VERIFIER_ISOLATED_PASS');
}

try {
  run();
} catch (error) {
  console.error(error);
  console.log('TESTS_FAILED=1');
  console.log('RESULT=PHASE2_INDEPENDENT_AUDIT_CHAIN_VERIFIER_ISOLATED_FAIL');
  process.exitCode = 1;
}
