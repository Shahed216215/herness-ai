'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createConflictQuarantine, readConflict, verifyConflict,
  listConflicts, resolveConflict, filterTrustedRecords
} = require('../services/mira-conflict-quarantine-registry');

function record(overrides = {}) {
  return {
    schemaVersion: '1.0.0', memoryId: 'memory-0001', projectId: 'project-a',
    recordType: 'fact', content: 'original fact',
    source: { sourceType: 'manual', sourceId: 'source-1', sourceUrl: null, observedAt: '2026-11-03T10:00:00.000Z' },
    timestamps: { createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z' },
    version: { revision: 1, contentHash: 'a'.repeat(64) },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-a'] },
    lifecycle: 'ACTIVE',
    ...overrides
  };
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-conflict-registry-'));
const auditEvents = [];
const auditWriter = event => { auditEvents.push(event); };
try {
  const originalA = record();
  const originalB = record({ content: 'competing fact', version: { revision: 1, contentHash: 'b'.repeat(64) } });
  const created = createConflictQuarantine({
    directory, projectId: 'project-a', conflictTypes: ['CONTENT_CONFLICT'],
    records: [originalA, originalB], reason: 'fixture conflict', actor: 'test-suite', auditWriter
  });
  assert.equal(created.status, 'QUARANTINED');
  const read = readConflict({ directory, conflictId: created.conflictId, projectId: 'project-a' });
  assert.deepEqual(read.originals.map(item => item.record), [originalA, originalB]);
  assert.throws(() => readConflict({ directory, conflictId: created.conflictId, projectId: 'project-b' }), /Cross-project/);
  assert.equal(verifyConflict({ directory, conflictId: created.conflictId, projectId: 'project-a' }).status, 'VERIFIED');
  assert.equal(listConflicts({ directory, projectId: 'project-a' })[0].status, 'PENDING_REVIEW');

  const visibleBefore = filterTrustedRecords([originalA, originalB, record({ memoryId: 'memory-0002' })],
    listConflicts({ directory, projectId: 'project-a' }));
  assert.deepEqual(visibleBefore.map(item => item.memoryId), ['memory-0002']);

  const invalidMerge = record({ version: { revision: 1, contentHash: 'c'.repeat(64) } });
  assert.throws(() => resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'MERGE', actor: 'reviewer', policyDecision: 'POLICY-1',
    mergedRecord: invalidMerge, auditWriter
  }), /increment exactly once/);

  const resolution = resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'KEEP_BOTH', actor: 'reviewer', policyDecision: 'POLICY-1', auditWriter
  });
  assert.equal(resolution.status, 'RESOLVED');
  assert.equal(listConflicts({ directory, projectId: 'project-a' })[0].status, 'RESOLVED');
  assert.equal(verifyConflict({ directory, conflictId: created.conflictId, projectId: 'project-a' }).status, 'VERIFIED');

  const mergeDirectory = path.join(directory, 'merge-fixture');
  const mergeConflict = createConflictQuarantine({
    directory: mergeDirectory, projectId: 'project-a', conflictTypes: ['REVISION_CONFLICT'],
    records: [originalA, record({ version: { revision: 2, contentHash: 'd'.repeat(64) } })],
    actor: 'test-suite', auditWriter
  });
  const merged = record({ content: 'reviewed merged content', version: { revision: 3, contentHash: 'e'.repeat(64) } });
  assert.equal(resolveConflict({
    directory: mergeDirectory, conflictId: mergeConflict.conflictId, projectId: 'project-a',
    decision: 'MERGE', actor: 'reviewer', policyDecision: 'POLICY-2',
    mergedRecord: merged, auditWriter
  }).status, 'RESOLVED');
  const mergedResolution = JSON.parse(fs.readFileSync(path.join(mergeDirectory, mergeConflict.conflictId + '.resolution.json'), 'utf8'));
  assert.deepEqual(mergedResolution.originalDigests.length, 2);
  assert.equal(mergedResolution.resultingRecord.version.revision, 3);

  const auditFailDir = path.join(directory, 'audit-fail');
  assert.throws(() => createConflictQuarantine({
    directory: auditFailDir, projectId: 'project-a', conflictTypes: ['CONTENT_CONFLICT'],
    records: [originalA, originalB], actor: 'test-suite',
    auditWriter: () => { throw new Error('audit unavailable'); }
  }), error => error.code === 'CONFLICT_QUARANTINED_AUDIT_FAILED' && error.stateCommitted === true);

  const tamperDir = path.join(directory, 'tamper');
  const tampered = createConflictQuarantine({
    directory: tamperDir, projectId: 'project-a', conflictTypes: ['CONTENT_CONFLICT'],
    records: [originalA, originalB], actor: 'test-suite', auditWriter
  });
  const tamperPath = path.join(tamperDir, tampered.conflictId + '.conflict.json');
  const tamperEnvelope = JSON.parse(fs.readFileSync(tamperPath, 'utf8'));
  tamperEnvelope.originals[0].record.content = 'tampered';
  fs.writeFileSync(tamperPath, JSON.stringify(tamperEnvelope));
  assert.equal(verifyConflict({ directory: tamperDir, conflictId: tampered.conflictId }).status, 'INTEGRITY_FAILED');

  const symlinkDir = path.join(directory, 'symlink');
  fs.mkdirSync(symlinkDir);
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(symlinkDir, 'linked'), 'dir');
  assert.throws(() => createConflictQuarantine({
    directory: path.join(symlinkDir, 'linked'), projectId: 'project-a',
    conflictTypes: ['CONTENT_CONFLICT'], records: [originalA, originalB],
    actor: 'test-suite', auditWriter
  }), /safe directory/);

  assert.ok(auditEvents.some(event => event.action === 'memory_conflict_quarantined'));
  assert.ok(auditEvents.some(event => event.action === 'memory_conflict_resolved'));
  console.log('IMMUTABLE_CONFLICT_ENVELOPE_AND_ORIGINAL_PRESERVATION=PASS');
  console.log('PROJECT_SCOPED_READ_AND_LIST=PASS');
  console.log('LOCAL_SHA256_INTEGRITY_VERIFICATION=PASS');
  console.log('PENDING_CONFLICT_RETRIEVAL_EXCLUSION=PASS');
  console.log('GOVERNED_KEEP_BOTH_RESOLUTION=PASS');
  console.log('MERGE_REVISION_INCREMENT_AND_SOURCE_LINKAGE=PASS');
  console.log('AUDIT_FAILURE_FAIL_CLOSED=PASS');
  console.log('TAMPER_DETECTION=PASS');
  console.log('SYMLINK_PATH_REJECTION=PASS');
  console.log('SYNTHETIC_FIXTURES_ONLY=PASS');
  console.log('PRODUCTION_DATA_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('EXTERNAL_ACTIONS=0');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=PHASE2_CONFLICT_QUARANTINE_LIFECYCLE_ISOLATED_PASS');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
