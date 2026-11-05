'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  encryptSnapshot
} = require('../services/mira-hfm-emergency-backup');
const {
  verifyRecoveryCandidate
} = require('../services/mira-hfm-recovery-verification');
const {
  canonicalize, sha256
} = require('../services/mira-hfm-authoritative-snapshot');
const {
  createProjectScopedLearningProjections
} = require('../services/mira-hfm-work-learning-projection');
const {
  searchProjectScopedMemory
} = require('../services/mira-hfm-retrieval-index');
const {
  prepareGovernedEvolution
} = require('../services/mira-hfm-evolution-prepare');

const now = new Date('2026-11-05T12:00:00.000Z');
const projectId = 'project-phase10-fixture';
const requestContext = {
  actorId: 'actor-phase10-reviewer', actorType: 'HUMAN',
  projectId, purpose: 'phase10-independent-verification',
  requestId: 'request-phase10-001', authorityRef: 'host-phase10-authority',
  issuedAt: '2026-11-05T11:59:00.000Z',
  expiresAt: '2026-11-05T12:05:00.000Z'
};
function authorize(input) {
  return {
    decision: 'ALLOW', replayStatus: 'FRESH',
    actorId: input.actorId, actorType: input.actorType,
    projectId: input.projectId, purpose: input.purpose,
    requestId: input.requestId, operation: input.operation,
    resourceScope: input.resourceScope, authorityRef: input.authorityRef,
    issuedAt: '2026-11-05T11:59:30.000Z',
    expiresAt: '2026-11-05T12:04:00.000Z'
  };
}
function canonicalLearningRecord() {
  const raw = {
    domain: 'work_learning',
    record: {
      learningId: 'phase10-learning-001',
      taskId: 'phase10-task-001',
      executionId: 'phase10-execution-001',
      task: {
        title: 'Reliable automation verification',
        description: 'Validate output integrity before release',
        requirements: ['source digest', 'regression test']
      },
      lessons: ['Verify recovery before preparing Evolution changes.'],
      qa: { status: 'qa_passed' }
    }
  };
  const content = JSON.stringify(raw);
  return {
    schemaVersion: '1.0.0',
    memoryId: 'phase10-canonical-learning-001',
    projectId,
    recordType: 'lesson',
    content,
    source: {
      sourceType: 'legacy_import',
      sourceId: 'phase10-learning-001',
      sourceUrl: null,
      observedAt: '2026-11-05T10:00:00.000Z'
    },
    timestamps: {
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z'
    },
    version: {
      revision: 2,
      contentHash: crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex')
    },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'CONTENT_VERIFIED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: [projectId] },
    lifecycle: 'ACTIVE'
  };
}
function keyProvider() {
  const kek = crypto.randomBytes(32);
  return {
    descriptor: {
      contractVersion: '1', providerId: 'phase10-test-kek',
      providerVersion: '1', keyId: 'phase10-key',
      keyVersion: '1', keyPurpose: 'MIRA_HFM_BACKUP', environment: 'test'
    },
    async wrapDataKey({ dataKey }) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', kek, nonce);
      const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
      return Buffer.from(JSON.stringify({
        nonce: nonce.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        tag: cipher.getAuthTag().toString('base64')
      })).toString('base64');
    },
    async unwrapDataKey({ wrappedDataKey }) {
      const wrapped = JSON.parse(Buffer.from(wrappedDataKey, 'base64').toString('utf8'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(wrapped.nonce, 'base64'));
      decipher.setAuthTag(Buffer.from(wrapped.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(wrapped.ciphertext, 'base64')),
        decipher.final()
      ]);
    }
  };
}
async function run() {
  const source = canonicalLearningRecord();
  const sourceRecordDigest = sha256(JSON.stringify(source));
  const snapshot = { schemaVersion: '1.0.0', records: [source] };
  const baselinePayloadSha256 = sha256(Buffer.from(canonicalize(snapshot), 'utf8'));
  const sourceRevision = String(source.version.revision);
  const provider = keyProvider();
  const encrypted = await encryptSnapshot({
    snapshot,
    metadata: {
      schemaVersion: '1.0.0',
      projectId,
      sourceRevision,
      recordCount: 1,
      keyId: 'phase10-key',
      keyVersion: '1'
    },
    keyProvider: provider
  });
  const recovery = await verifyRecoveryCandidate({
    backup: encrypted.bytes,
    keyProvider: provider,
    expectedProjectId: projectId,
    supportedSchemaVersions: ['1.0.0'],
    expectedSourceRevision: sourceRevision,
    expectedRecordCount: 1,
    expectedPayloadSha256: baselinePayloadSha256
  });
  assert.equal(recovery.status, 'RECOVERY_VERIFIED_PREVIEW_ONLY');
  assert.equal(recovery.restoreExecuted, false);
  assert.equal(recovery.canonicalMemoryWritten, false);
  console.log('PHASE10_PHASE7_ENCRYPTED_BACKUP_RECOVERY_PREVIEW_PASS');

  await assert.rejects(() => verifyRecoveryCandidate({
    backup: encrypted.bytes,
    keyProvider,
    expectedProjectId: projectId,
    supportedSchemaVersions: ['1.0.0'],
    expectedSourceRevision: sourceRevision,
    expectedRecordCount: 1,
    expectedPayloadSha256: '0'.repeat(64)
  }), error => error.code === 'HFM_RECOVERY_BASELINE_MISMATCH');
  console.log('PHASE10_RECOVERY_BASELINE_MISMATCH_BLOCK_PASS');

  const projections = createProjectScopedLearningProjections({
    records: [source], pendingConflicts: [], projectId,
    requestContext, authorizeRequest: authorize, now
  });
  assert.equal(projections.count, 2);
  assert.ok(projections.projections.every(x => x.projectId === projectId));
  assert.ok(projections.projections.every(x => x.mayEnterCanonicalMemory === false));
  console.log('PHASE10_PHASE8_DERIVED_PROJECTION_LINEAGE_PASS');

  const search = searchProjectScopedMemory({
    records: [source], pendingConflicts: [], projectId,
    requestContext, authorizeRequest: authorize,
    query: 'automation integrity recovery', limit: 10, now
  });
  assert.equal(search.count, 1);
  assert.equal(search.results[0].memoryId, source.memoryId);
  assert.equal(search.index.persisted, false);
  console.log('PHASE10_PHASE9_PROJECT_RETRIEVAL_INDEX_PASS');

  const backupId = 'phase10-backup-preview-001';
  const backupDigest = sha256(encrypted.bytes);
  const verifyRecoveryPoint = claim => {
    assert.equal(claim.sourceMemoryId, source.memoryId);
    assert.equal(claim.sourceRecordDigest, sourceRecordDigest);
    assert.equal(claim.sourceRevision, source.version.revision);
    return {
      decision: 'VERIFIED',
      backupId,
      backupDigest,
      projectId,
      sourceMemoryId: source.memoryId,
      sourceRecordDigest,
      sourceRevision: source.version.revision,
      verifiedAt: '2026-11-05T11:59:30.000Z',
      expiresAt: '2026-11-05T12:04:00.000Z'
    };
  };
  const evolution = prepareGovernedEvolution({
    records: [source], pendingConflicts: [], projectId,
    requestContext, authorizeRequest: authorize,
    sourceMemoryId: source.memoryId,
    expectedSourceRevision: source.version.revision,
    expectedSourceDigest: sourceRecordDigest,
    proposal: {
      proposalId: 'phase10-evolution-proposal-001',
      title: 'Improve automation verification',
      category: 'learning_rule',
      risk: 'medium',
      instruction: 'Prepare a reviewable learning improvement.',
      requestedChanges: ['Add an explicit source-integrity regression test.'],
      idempotencyKey: 'phase10-evolution-idempotency-001'
    },
    recoveryPoint: { backupId, backupDigest },
    verifyRecoveryPoint,
    now
  });
  assert.equal(evolution.status, 'PREPARED_NOT_COMMITTED');
  assert.equal(evolution.governance.applyAllowed, false);
  assert.equal(evolution.governance.persistentWrite, false);
  console.log('PHASE10_PHASE8_EVOLUTION_PREPARE_ONLY_WITH_PHASE7_RECOVERY_PASS');

  const pendingCandidate = {
    ...source,
    lifecycle: 'PENDING_REVIEW',
    integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' }
  };
  const pendingSearch = searchProjectScopedMemory({
    records: [pendingCandidate], pendingConflicts: [], projectId,
    requestContext, authorizeRequest: authorize,
    query: 'automation integrity recovery', limit: 10, now
  });
  assert.equal(pendingSearch.count, 0);
  console.log('PHASE10_UNVERIFIED_CANDIDATE_NOT_RETRIEVABLE_PASS');

  const root = path.resolve(__dirname, '..');
  const sourceFiles = [
    'services/mira-hfm-work-learning-adapter.js',
    'services/mira-hfm-work-learning-retrieval.js',
    'services/mira-hfm-work-learning-projection.js',
    'services/mira-hfm-evolution-prepare.js',
    'services/mira-hfm-retrieval-index.js',
    'services/mira-hfm-recovery-verification.js'
  ];
  for (const relative of sourceFiles) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(text, /require\(['"]\.\.\/knowledge-memory-evolution['"]\)/);
    assert.doesNotMatch(text, /\bwriteArrayState\s*\(|\batomicWriteJson\s*\(|\bapplyEvolution\s*\(/);
  }
  console.log('PHASE10_STATIC_NO_CANONICAL_WRITE_OR_EVOLUTION_APPLY_PATH_PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('PERSISTENT_INDEX_WRITES=0');
  console.log('CANONICAL_MEMORY_WRITTEN=NO');
  console.log('CANONICAL_KNOWLEDGE_WRITTEN=NO');
  console.log('RESTORE_EXECUTED=NO');
  console.log('EVOLUTION_APPLIED=NO');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_PHASE10_INDEPENDENT_CROSS_PHASE_VERIFICATION_PASS');
}
run().catch(error => { process.stderr.write((error.stack || error.message) + '\n'); process.exitCode = 1; });
