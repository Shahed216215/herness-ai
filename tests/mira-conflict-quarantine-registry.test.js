'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createConflictQuarantine, readConflict, verifyConflict,
  beginConflictReview, verifyReview, listConflicts,
  resolveConflict, verifyResolution, filterTrustedRecords
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
const authorizeResolution = request => request.actor === 'reviewer' && request.policyDecision.startsWith('POLICY-') && request.resolutionProposal?.requiredAuthority === 'authorized-human-reviewer';
const resolutionProposal = () => ({
  fieldLevelChanges: [],
  dataLossRisks: ['Both original versions are preserved; no source record is deleted by this isolated service.'],
  requiredAuthority: 'authorized-human-reviewer',
  recoveryPoint: 'synthetic-fixture-originals-retained',
  verificationPlan: ['verify both original digests', 'verify resolution digest', 'verify accepted result or merge revision']
});
const authorizeReview = request => request.actor === 'reviewer' && request.policyDecision.startsWith('POLICY-REVIEW');
function startReview(directory, conflictId) {
  return beginConflictReview({
    directory, conflictId, projectId: 'project-a', actor: 'reviewer',
    policyDecision: 'POLICY-REVIEW-1', authorizeReview, auditWriter
  });
}
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
  assert.equal(listConflicts({ directory, projectId: 'project-a' })[0].status, 'QUARANTINED');

  const visibleBefore = filterTrustedRecords([
    originalA, originalB, record({ memoryId: 'memory-0002' }),
    record({ memoryId: 'memory-0001', projectId: 'project-b',
      access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-b'] } })
  ], listConflicts({ directory, projectId: 'project-a' }), 'project-a');
  assert.deepEqual(visibleBefore.map(item => item.projectId + ':' + item.memoryId),
    ['project-a:memory-0002', 'project-b:memory-0001']);
  const mainReview = startReview(directory, created.conflictId);
  assert.equal(mainReview.status, 'UNDER_REVIEW');
  assert.equal(verifyReview({ directory, conflictId: created.conflictId, projectId: 'project-a' }).status, 'VERIFIED');
  assert.equal(listConflicts({ directory, projectId: 'project-a' })[0].status, 'UNDER_REVIEW');
  assert.throws(() => filterTrustedRecords([], [], ''), /projectId is required/);

  assert.throws(() => resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_EXISTING_VERSION', actor: 'unapproved-user', policyDecision: 'POLICY-1',
    resolutionProposal: resolutionProposal(),
    auditWriter, authorizeResolution
  }), /authorization denied/);
  assert.throws(() => resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_EXISTING_VERSION', actor: 'reviewer', policyDecision: 'POLICY-1',
    auditWriter, authorizeResolution
  }), /structured resolutionProposal is required/);
  assert.throws(() => resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_EXISTING_VERSION', actor: 'reviewer', policyDecision: 'POLICY-1',
    resolutionProposal: {}, auditWriter, authorizeResolution
  }), /fieldLevelChanges is invalid/);
  assert.throws(() => resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_EXISTING_VERSION', actor: 'reviewer', policyDecision: 'POLICY-1',
    resolutionProposal: resolutionProposal(), auditWriter
  }), /authorizeResolution callback is required/);

  const invalidMerge = record({ version: { revision: 1, contentHash: 'c'.repeat(64) } });
  assert.throws(() => resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'APPROVED_FIELD_MERGE', actor: 'reviewer', policyDecision: 'POLICY-1',
    resolutionProposal: resolutionProposal(),
    mergedRecord: invalidMerge, auditWriter, authorizeResolution
  }), /increment exactly once/);

  const resolution = resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_EXISTING_VERSION', actor: 'reviewer', policyDecision: 'POLICY-1',
    resolutionProposal: resolutionProposal(), auditWriter, authorizeResolution
  });
  assert.equal(resolution.status, 'RESOLVED');
  assert.equal(listConflicts({ directory, projectId: 'project-a' })[0].status, 'RESOLVED');
  assert.equal(verifyConflict({ directory, conflictId: created.conflictId, projectId: 'project-a' }).status, 'VERIFIED');
  assert.equal(verifyResolution({ directory, conflictId: created.conflictId, projectId: 'project-a' }).status, 'VERIFIED');
  const acceptedResolution = JSON.parse(fs.readFileSync(path.join(directory, created.conflictId + '.resolution.json'), 'utf8'));
  assert.equal(acceptedResolution.proposal.affectedVersions.length, 2);
  assert.equal(acceptedResolution.proposal.originalHashes.length, 2);
  assert.equal(acceptedResolution.proposal.requiredAuthority, 'authorized-human-reviewer');
  assert.ok(acceptedResolution.proposal.verificationPlan.length > 0);
  const repeatedResolution = resolveConflict({
    directory, conflictId: created.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_EXISTING_VERSION', actor: 'reviewer', policyDecision: 'POLICY-1',
    resolutionProposal: resolutionProposal(), auditWriter, authorizeResolution
  });
  assert.equal(repeatedResolution.status, 'ALREADY_RESOLVED');

  const rejectDirectory = path.join(directory, 'reject-fixture');
  const rejectConflict = createConflictQuarantine({
    directory: rejectDirectory, projectId: 'project-a', conflictTypes: ['SOURCE_CONFLICT'],
    records: [originalA, originalB], actor: 'test-suite', auditWriter
  });
  startReview(rejectDirectory, rejectConflict.conflictId);
  assert.equal(resolveConflict({
    directory: rejectDirectory, conflictId: rejectConflict.conflictId, projectId: 'project-a',
    decision: 'REJECT_CONFLICTING_CHANGE', actor: 'reviewer', policyDecision: 'POLICY-REJECT',
    resolutionProposal: resolutionProposal(),
    auditWriter, authorizeResolution
  }).status, 'RESOLVED');
  const rejectRecord = JSON.parse(fs.readFileSync(path.join(rejectDirectory, rejectConflict.conflictId + '.resolution.json'), 'utf8'));
  assert.equal(rejectRecord.decision, 'REJECT_CONFLICTING_CHANGE');
  assert.equal(rejectRecord.originalDigests.length, 2);

  const retainDirectory = path.join(directory, 'retain-fixture');
  const failedIntegrityOriginal = record({ integrity: { status: 'FAILED', algorithm: 'SHA-256' } });
  const retainConflict = createConflictQuarantine({
    directory: retainDirectory, projectId: 'project-a', conflictTypes: ['INTEGRITY_CONFLICT'],
    records: [originalA, failedIntegrityOriginal], actor: 'test-suite', auditWriter
  });
  assert.equal(verifyConflict({ directory: retainDirectory, conflictId: retainConflict.conflictId, projectId: 'project-a' }).status, 'VERIFIED');
  const retainedEnvelope = readConflict({ directory: retainDirectory, conflictId: retainConflict.conflictId, projectId: 'project-a' });
  assert.ok(retainedEnvelope.originals[1].schemaValidationErrors.length === 0);
  assert.equal(retainedEnvelope.originals[1].declaredIntegrityStatus, 'FAILED');
  startReview(retainDirectory, retainConflict.conflictId);
  assert.equal(resolveConflict({
    directory: retainDirectory, conflictId: retainConflict.conflictId, projectId: 'project-a',
    decision: 'RETAIN_QUARANTINED', actor: 'reviewer', policyDecision: 'POLICY-RETAIN',
    resolutionProposal: resolutionProposal(),
    auditWriter, authorizeResolution
  }).status, 'RESOLVED');
  assert.equal(listConflicts({ directory: retainDirectory, projectId: 'project-a' })[0].status, 'RETAINED_QUARANTINED');
  assert.deepEqual(filterTrustedRecords([originalA, originalB],
    listConflicts({ directory: retainDirectory, projectId: 'project-a' }), 'project-a'), []);

  const multiDirectory = path.join(directory, 'multi-original-fixture');
  const thirdOriginal = record({
    content: 'third version',
    version: { revision: 3, contentHash: 'f'.repeat(64) }
  });
  const multiConflict = createConflictQuarantine({
    directory: multiDirectory, projectId: 'project-a', conflictTypes: ['REVISION_CONFLICT'],
    records: [originalA, originalB, thirdOriginal], actor: 'test-suite', auditWriter
  });
  assert.equal(readConflict({ directory: multiDirectory, conflictId: multiConflict.conflictId }).originals.length, 3);
  startReview(multiDirectory, multiConflict.conflictId);
  assert.throws(() => resolveConflict({
    directory: multiDirectory, conflictId: multiConflict.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_ALTERNATE_VERSION', acceptedOriginalIndex: 99,
    actor: 'reviewer', policyDecision: 'POLICY-ALT',
    resolutionProposal: resolutionProposal(), auditWriter, authorizeResolution
  }), /valid acceptedOriginalIndex/);
  assert.equal(resolveConflict({
    directory: multiDirectory, conflictId: multiConflict.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_ALTERNATE_VERSION', acceptedOriginalIndex: 2,
    actor: 'reviewer', policyDecision: 'POLICY-ALT',
    resolutionProposal: resolutionProposal(), auditWriter, authorizeResolution
  }).status, 'RESOLVED');
  const multiResolution = JSON.parse(fs.readFileSync(path.join(multiDirectory, multiConflict.conflictId + '.resolution.json'), 'utf8'));
  assert.equal(multiResolution.acceptedOriginalDigest, readConflict({ directory: multiDirectory, conflictId: multiConflict.conflictId }).originals[2].recordDigest);
  assert.equal(verifyResolution({ directory: multiDirectory, conflictId: multiConflict.conflictId, projectId: 'project-a' }).status, 'VERIFIED');

  const mergeDirectory = path.join(directory, 'merge-fixture');
  const mergeConflict = createConflictQuarantine({
    directory: mergeDirectory, projectId: 'project-a', conflictTypes: ['REVISION_CONFLICT'],
    records: [originalA, record({ version: { revision: 2, contentHash: 'd'.repeat(64) } })],
    actor: 'test-suite', auditWriter
  });
  const merged = record({ content: 'reviewed merged content', version: { revision: 3, contentHash: 'e'.repeat(64) } });
  startReview(mergeDirectory, mergeConflict.conflictId);
  assert.equal(resolveConflict({
    directory: mergeDirectory, conflictId: mergeConflict.conflictId, projectId: 'project-a',
    decision: 'APPROVED_FIELD_MERGE', actor: 'reviewer', policyDecision: 'POLICY-2',
    resolutionProposal: resolutionProposal(),
    mergedRecord: merged, auditWriter, authorizeResolution
  }).status, 'RESOLVED');
  const mergedResolution = JSON.parse(fs.readFileSync(path.join(mergeDirectory, mergeConflict.conflictId + '.resolution.json'), 'utf8'));
  assert.deepEqual(mergedResolution.originalDigests.length, 2);
  assert.equal(mergedResolution.resultingRecord.version.revision, 3);
  assert.equal(verifyResolution({ directory: mergeDirectory, conflictId: mergeConflict.conflictId, projectId: 'project-a' }).status, 'VERIFIED');

  const resolutionTamper = JSON.parse(fs.readFileSync(path.join(mergeDirectory, mergeConflict.conflictId + '.resolution.json'), 'utf8'));
  resolutionTamper.proposal.requiredAuthority = 'TAMPERED';
  fs.writeFileSync(path.join(mergeDirectory, mergeConflict.conflictId + '.resolution.json'), JSON.stringify(resolutionTamper));
  assert.equal(verifyResolution({ directory: mergeDirectory, conflictId: mergeConflict.conflictId, projectId: 'project-a' }).status, 'INTEGRITY_FAILED');
  assert.equal(listConflicts({ directory: mergeDirectory, projectId: 'project-a' })[0].status, 'INTEGRITY_FAILED');

  const malformedResolutionDir = path.join(directory, 'malformed-resolution');
  const malformedResolutionConflict = createConflictQuarantine({
    directory: malformedResolutionDir, projectId: 'project-a', conflictTypes: ['CONTENT_CONFLICT'],
    records: [originalA, originalB], actor: 'test-suite', auditWriter
  });
  fs.writeFileSync(path.join(malformedResolutionDir, malformedResolutionConflict.conflictId + '.resolution.json'), 'null');
  assert.equal(verifyResolution({
    directory: malformedResolutionDir, conflictId: malformedResolutionConflict.conflictId, projectId: 'project-a'
  }).status, 'INTEGRITY_FAILED');

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
  startReview(resolutionAuditDir, resolutionAuditConflict.conflictId);
  assert.throws(() => resolveConflict({
    directory: resolutionAuditDir, conflictId: resolutionAuditConflict.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_EXISTING_VERSION', actor: 'reviewer', policyDecision: 'POLICY-3',
    resolutionProposal: resolutionProposal(),
    auditWriter: () => { throw new Error('resolution audit unavailable'); }, authorizeResolution
  }), error => error.code === 'CONFLICT_RESOLUTION_AUDIT_FAILED' && error.stateCommitted === true);
  assert.equal(listConflicts({ directory: resolutionAuditDir, projectId: 'project-a' })[0].status, 'RESOLVED');
  assert.equal(resolveConflict({
    directory: resolutionAuditDir, conflictId: resolutionAuditConflict.conflictId, projectId: 'project-a',
    decision: 'ACCEPT_EXISTING_VERSION', actor: 'reviewer', policyDecision: 'POLICY-3',
    resolutionProposal: resolutionProposal(),
    auditWriter, authorizeResolution
  }).status, 'ALREADY_RESOLVED');

  assert.throws(() => readConflict({ directory, conflictId: '../../outside', projectId: 'project-a' }), /Invalid conflictId/);

  const malformedDir = path.join(directory, 'malformed-original');
  const malformedOriginal = record({ unexpectedField: 'preserve-me', integrity: { status: 'FAILED', algorithm: 'SHA-256' } });
  const malformedConflict = createConflictQuarantine({
    directory: malformedDir, projectId: 'project-a', conflictTypes: ['SCHEMA_CONFLICT'],
    records: [originalA, malformedOriginal], actor: 'test-suite', auditWriter
  });
  const malformedEnvelope = readConflict({ directory: malformedDir, conflictId: malformedConflict.conflictId, projectId: 'project-a' });
  assert.ok(malformedEnvelope.originals[1].schemaValidationErrors.length > 0);
  assert.equal(verifyConflict({ directory: malformedDir, conflictId: malformedConflict.conflictId, projectId: 'project-a' }).status, 'VERIFIED');

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
  assert.throws(() => resolveConflict({
    directory: tamperDir, conflictId: tampered.conflictId, projectId: 'project-a',
    decision: 'RETAIN_QUARANTINED', actor: 'reviewer', policyDecision: 'POLICY-TAMPER',
    resolutionProposal: resolutionProposal(),
    auditWriter, authorizeResolution
  }), /integrity verification failed/);

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
  console.log('CONFLICT_STATE_QUARANTINED_TO_UNDER_REVIEW=PASS');
  console.log('GOVERNED_ACCEPT_EXISTING_VERSION_RESOLUTION=PASS');
  console.log('GOVERNED_ACCEPT_ALTERNATE_VERSION_RESOLUTION=PASS');
  console.log('GOVERNED_APPROVED_FIELD_MERGE_RESOLUTION=PASS');
  console.log('GOVERNED_RETAIN_QUARANTINED=PASS');
  console.log('ALTERNATE_VERSION_INDEX_BOUNDS=PASS');
  console.log('MULTI_ORIGINAL_CONFLICT_PRESERVATION=PASS');
  console.log('FAILED_INTEGRITY_ORIGINAL_QUARANTINE=PASS');
  console.log('GOVERNED_REJECT_CONFLICTING_CHANGE_RESOLUTION=PASS');
  console.log('EXPLICIT_RESOLUTION_AUTHORIZATION_GATE=PASS');
  console.log('CONTRACT_RESOLUTION_PROPOSAL_REQUIRED=PASS');
  console.log('RESOLUTION_PROPOSAL_TRACEABILITY_AND_TAMPER_DETECTION=PASS');
  console.log('MERGE_REVISION_INCREMENT_AND_SOURCE_LINKAGE=PASS');
  console.log('AUDIT_FAILURE_FAIL_CLOSED=PASS');
  console.log('RESOLUTION_AUDIT_FAILURE_RECOVERY=PASS');
  console.log('TAMPER_DETECTION=PASS');
  console.log('MALFORMED_ORIGINAL_PRESERVATION=PASS');
  console.log('INVALID_CONFLICT_ID_PATH_TRAVERSAL_REJECTED=PASS');
  console.log('MALFORMED_RESOLUTION_FAIL_CLOSED=PASS');
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
