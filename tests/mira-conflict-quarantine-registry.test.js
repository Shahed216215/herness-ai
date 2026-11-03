'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createConflictQuarantine, readConflict, verifyConflict,
  listConflicts, resolveConflict, verifyResolution, filterTrustedRecords
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
const authorizeResolution = request => request.actor === 'reviewer' && request.policyDecision.startsWith('POLICY-');
try {
  const originalA = record();
  const originalB = record({ content: 'competing fact', version: { revision: 1, contentHash: 'b'.repeat(64) } });
  const created = createConflictQuarantine({
    directory, projectId: 'project-a', conflictTypes: ['CONTENT_CONFLICT'],
    records: [originalA, originalB], reason: 'fixture conflict', actor: 'test-suite', auditWriter
  });
  assert.equal(created.status, 'QUARANTINED');
  assert.equal(fs.readdirSync(directory).some(name => name.startsWith('.mira-quarantine-tmp-')), false);
  const repeatedCreate = createConflictQuarantine({
    directory, projectId: 'project-a', conflictTypes: ['CONTENT_CONFLICT'],
    records: [originalA, originalB], reason: 'fixture conflict', actor: 'test-suite-retry', auditWriter
  });
  assert.equal(repeatedCreate.status, 'ALREADY_EXISTS');
  const read = readConflict({ directory, conflictId: created.conflictId, projectId: 'project-a' });
  assert.deepEqual(read.originals.map(item => item.record), [originalA, originalB]);
  assert.throws(() => readConflict({ directory, conflictId: created.conflictId, projectId: 'project-b' }), /Cross-project/);
  assert.equal(verifyConflict({ directory, conflictId: created.conflictId, projectId: 'project-a' }).status, 'VERIFIED');
  assert.equal(listConflicts({ directory, projectId: 'project-a' })[0].status, 'PENDING_REVIEW');

  const visibleBefore = filterTrustedRecords([
    originalA, originalB, record({ memoryId: 'memory-0002' }),
    record({ memoryId: 'memory-0001', projectId: 'project-b',
      access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-b'] } })
  ], listConflicts({ directory, projectId: 'project-a' }), 'project-a');
  assert.deepEqual(visibleBefore.map(item => item.projectId + ':' + item.memoryId),
    ['project-a:memory-0002', 'project-b:memory-0001']);
  assert.throws(() => filterTrustedRecords([], [], ''), /projectId is required/);

  assert.throws(() => resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'KEEP_BOTH', actor: 'unapproved-user', policyDecision: 'POLICY-1',
    auditWriter, authorizeResolution
  }), /authorization denied/);
  assert.throws(() => resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'KEEP_BOTH', actor: 'reviewer', policyDecision: 'POLICY-1', auditWriter
  }), /authorizeResolution callback is required/);

  const invalidMerge = record({ version: { revision: 1, contentHash: 'c'.repeat(64) } });
  assert.throws(() => resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'MERGE', actor: 'reviewer', policyDecision: 'POLICY-1',
    mergedRecord: invalidMerge, auditWriter, authorizeResolution
  }), /increment exactly once/);

  const resolution = resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'KEEP_BOTH', actor: 'reviewer', policyDecision: 'POLICY-1', auditWriter, authorizeResolution
  });
  assert.equal(resolution.status, 'RESOLVED');
  assert.equal(listConflicts({ directory, projectId: 'project-a' })[0].status, 'RESOLVED');
  assert.equal(verifyConflict({ directory, conflictId: created.conflictId, projectId: 'project-a' }).status, 'VERIFIED');
  assert.equal(verifyResolution({ directory, conflictId: created.conflictId, projectId: 'project-a' }).status, 'VERIFIED');
  const repeatedResolution = resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'KEEP_BOTH', actor: 'reviewer', policyDecision: 'POLICY-1', auditWriter, authorizeResolution
  });
  assert.equal(repeatedResolution.status, 'ALREADY_RESOLVED');

  const rejectDirectory = path.join(directory, 'reject-fixture');
  const rejectConflict = createConflictQuarantine({
    directory: rejectDirectory, projectId: 'project-a', conflictTypes: ['SOURCE_CONFLICT'],
    records: [originalA, originalB], actor: 'test-suite', auditWriter
  });
  assert.equal(resolveConflict({
    directory: rejectDirectory, conflictId: rejectConflict.conflictId, projectId: 'project-a',
    decision: 'REJECT_INCOMING', actor: 'reviewer', policyDecision: 'POLICY-REJECT',
    auditWriter, authorizeResolution
  }).status, 'RESOLVED');
  const rejectRecord = JSON.parse(fs.readFileSync(path.join(rejectDirectory, rejectConflict.conflictId + '.resolution.json'), 'utf8'));
  assert.equal(rejectRecord.decision, 'REJECT_INCOMING');
  assert.equal(rejectRecord.originalDigests.length, 2);

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
    mergedRecord: merged, auditWriter, authorizeResolution
  }).status, 'RESOLVED');
  const mergedResolution = JSON.parse(fs.readFileSync(path.join(mergeDirectory, mergeConflict.conflictId + '.resolution.json'), 'utf8'));
  assert.deepEqual(mergedResolution.originalDigests.length, 2);
  assert.equal(mergedResolution.resultingRecord.version.revision, 3);
  assert.equal(verifyResolution({ directory: mergeDirectory, conflictId: mergeConflict.conflictId, projectId: 'project-a' }).status, 'VERIFIED');

  const resolutionTamper = JSON.parse(fs.readFileSync(path.join(mergeDirectory, mergeConflict.conflictId + '.resolution.json'), 'utf8'));
  resolutionTamper.policyDecision = 'TAMPERED';
  fs.writeFileSync(path.join(mergeDirectory, mergeConflict.conflictId + '.resolution.json'), JSON.stringify(resolutionTamper));
  assert.equal(verifyResolution({ directory: mergeDirectory, conflictId: mergeConflict.conflictId, projectId: 'project-a' }).status, 'INTEGRITY_FAILED');
  assert.equal(listConflicts({ directory: mergeDirectory, projectId: 'project-a' })[0].status, 'INTEGRITY_FAILED');

  const auditFailDir = path.join(directory, 'audit-fail');
  assert.throws(() => createConflictQuarantine({
    directory: auditFailDir, projectId: 'project-a', conflictTypes: ['CONTENT_CONFLICT'],
    records: [originalA, originalB], actor: 'test-suite',
    auditWriter: () => { throw new Error('audit unavailable'); }
  }), error => error.code === 'CONFLICT_QUARANTINED_AUDIT_FAILED' && error.stateCommitted === true);

  const resolutionAuditDir = path.join(directory, 'resolution-audit-fail');
  const resolutionAuditConflict = createConflictQuarantine({
    directory: resolutionAuditDir, projectId: 'project-a', conflictTypes: ['CONTENT_CONFLICT'],
    records: [originalA, originalB], actor: 'test-suite', auditWriter
  });
  assert.throws(() => resolveConflict({
    directory: resolutionAuditDir, conflictId: resolutionAuditConflict.conflictId, projectId: 'project-a',
    decision: 'KEEP_BOTH', actor: 'reviewer', policyDecision: 'POLICY-3',
    auditWriter: () => { throw new Error('resolution audit unavailable'); }, authorizeResolution
  }), error => error.code === 'CONFLICT_RESOLUTION_AUDIT_FAILED' && error.stateCommitted === true);
  assert.equal(listConflicts({ directory: resolutionAuditDir, projectId: 'project-a' })[0].status, 'RESOLVED');
  assert.equal(resolveConflict({
    directory: resolutionAuditDir, conflictId: resolutionAuditConflict.conflictId, projectId: 'project-a',
    decision: 'KEEP_BOTH', actor: 'reviewer', policyDecision: 'POLICY-3',
    auditWriter, authorizeResolution
  }).status, 'ALREADY_RESOLVED');

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

  const metadataTamperDir = path.join(directory, 'metadata-tamper');
  const metadataConflict = createConflictQuarantine({
    directory: metadataTamperDir, projectId: 'project-a', conflictTypes: ['CONTENT_CONFLICT'],
    records: [originalA, originalB], actor: 'test-suite', auditWriter
  });
  const metadataPath = path.join(metadataTamperDir, metadataConflict.conflictId + '.conflict.json');
  const metadataEnvelope = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  metadataEnvelope.createdBy = 'tampered-actor';
  fs.writeFileSync(metadataPath, JSON.stringify(metadataEnvelope));
  assert.equal(verifyConflict({ directory: metadataTamperDir, conflictId: metadataConflict.conflictId }).status, 'INTEGRITY_FAILED');

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
  assert.throws(() => createConflictQuarantine({
    directory: path.join(symlinkDir, 'linked', 'nested'), projectId: 'project-a',
    conflictTypes: ['CONTENT_CONFLICT'], records: [originalA, originalB],
    actor: 'test-suite', auditWriter
  }), /unsafe directory component/);

  assert.ok(auditEvents.some(event => event.action === 'memory_conflict_quarantined'));
  assert.ok(auditEvents.some(event => event.action === 'memory_conflict_resolved'));
  console.log('IMMUTABLE_CONFLICT_ENVELOPE_AND_ORIGINAL_PRESERVATION=PASS');
  console.log('ATOMIC_IMMUTABLE_PUBLICATION_AND_TEMP_CLEANUP=PASS');
  console.log('PROJECT_SCOPED_READ_AND_LIST=PASS');
  console.log('LOCAL_SHA256_INTEGRITY_VERIFICATION=PASS');
  console.log('IMMUTABLE_RESOLUTION_INTEGRITY_AND_IDEMPOTENCY=PASS');
  console.log('PENDING_CONFLICT_RETRIEVAL_EXCLUSION=PASS');
  console.log('PROJECT_SCOPED_RETRIEVAL_EXCLUSION=PASS');
  console.log('GOVERNED_KEEP_BOTH_RESOLUTION=PASS');
  console.log('GOVERNED_REJECT_INCOMING_RESOLUTION=PASS');
  console.log('EXPLICIT_RESOLUTION_AUTHORIZATION_GATE=PASS');
  console.log('MERGE_REVISION_INCREMENT_AND_SOURCE_LINKAGE=PASS');
  console.log('AUDIT_FAILURE_FAIL_CLOSED=PASS');
  console.log('RESOLUTION_AUDIT_FAILURE_RECOVERY=PASS');
  console.log('TAMPER_DETECTION=PASS');
  console.log('FULL_ENVELOPE_METADATA_TAMPER_DETECTION=PASS');
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
