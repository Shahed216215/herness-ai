'use strict';

const assert = require('node:assert/strict');
const { inspectLegacyLearningCompatibility } = require('../services/mira-hfm-learning-legacy-compatibility');
const {
  fromLegacyLearningRecord, fromLegacyExperiences, fromLegacyConsolidatedKnowledge
} = require('../services/mira-hfm-legacy-learning-evidence-adapter');

function fixtures(overrides = {}) {
  const calls = { writes: 0, rollback: 0, drive: 0 };
  const base = {
    learningEngine: {
      listLearningRecords: () => [{ learningId: 'learning-0001' }, { learningId: 'learning-0002' }],
      verifyLearningRecordIntegrity: id => ({ found: true, valid: id !== 'learning-0002' })
    },
    experienceMemory: {
      listExperiences: () => [{ experienceId: 'experience-0001' }, { experienceId: 'experience-0002' }],
      verifyExperienceIntegrity: item => item.experienceId === 'experience-0001'
    },
    experienceRetrievalEngine: {
      getRetrievalStats: () => ({
        retrievalIsReadOnly: true, autonomousExecution: false,
        sourceWritable: false, governanceBypass: false, sourceExperienceCount: 2
      })
    },
    knowledgeConsolidation: {
      verifyStoreIntegrity: () => ({ valid: true, itemCount: 3 }),
      getConsolidatedKnowledge: () => [{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }]
    },
    snapshotManager: {
      listSnapshots: () => ({ ok: true, snapshots: [
        { changeId: 'change-0001', snapshotId: 'snapshot-100-abc123', createdAt: '2026-10-01T00:00:00.000Z' },
        { changeId: 'change-0002', snapshotId: 'snapshot-200-def456', createdAt: '2026-10-02T00:00:00.000Z' }
      ] }),
      verifySnapshot: (changeId, snapshotId) => ({ ok: changeId === 'change-0001' && snapshotId === 'snapshot-100-abc123' })
    },
    evolution: {
      rollbackEvolution: () => { calls.rollback++; return { ok: false }; },
      verifyEvolutionState: async () => { calls.drive++; return { ok: false }; }
    }
  };
  return { sources: { ...base, ...overrides }, calls };
}

(async () => {
  const legacyRecord = {
    learningId: 'learning-legacy-001', schemaVersion: 2,
    lessons: ['Check requirements before marking work complete.'],
    knowledgeCandidates: [{ lesson: 'Preserve provenance on imported evidence.' }],
    skillUpdateCandidates: [{ improvement: 'Run independent regression checks.' }]
  };
  const legacyInput = fromLegacyLearningRecord({
    projectId: 'project-mira-v02', proposalId: 'proposal-legacy-001',
    title: 'Legacy learning review', rationale: 'Review verified historical learning.',
    proposedChange: 'Create a human-reviewed proposal only.',
    record: legacyRecord,
    integrity: { found: true, valid: true, learningId: legacyRecord.learningId, schemaVersion: 2 }
  });
  assert.equal(legacyInput.evidenceOrigin, 'LEGACY_LEARNING_ENGINE_INTEGRITY_VERIFIED_UNTRUSTED');
  assert.equal(legacyInput.evidence.length, 3);
  assert.ok(legacyInput.evidence.every(item => item.projectId === 'project-mira-v02' && item.trustState === 'UNVERIFIED'));
  assert.ok(legacyInput.evidence.every(item => item.sourceRef.startsWith('mira://legacy-learning/')));
  assert.throws(() => fromLegacyLearningRecord({
    projectId: 'project-mira-v02', proposalId: 'proposal-legacy-002',
    title: 'Unverified legacy record', rationale: 'Must fail.', proposedChange: 'No changes.',
    record: legacyRecord,
    integrity: { found: true, valid: false, learningId: legacyRecord.learningId, schemaVersion: 2 }
  }), error => error.code === 'HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED');
  assert.throws(() => fromLegacyLearningRecord({
    projectId: 'project-mira-v02', proposalId: 'proposal-legacy-003',
    title: 'Secret-bearing legacy record', rationale: 'Must fail.', proposedChange: 'No changes.',
    record: { ...legacyRecord, lessons: ['api_key=sk-very-secret-value'] },
    integrity: { found: true, valid: true, learningId: legacyRecord.learningId, schemaVersion: 2 }
  }), error => error.code === 'HFM_LEARNING_LEGACY_SECRET_SUSPECTED');
  console.log('HFM_PHASE8_LEGACY_LEARNING_TO_UNTRUSTED_PROPOSAL_ADAPTER=PASS');

  const experience = {
    experienceId: 'learning-experience-001',
    integrity: 'a'.repeat(64),
    source: { type: 'work-learning-record', learningId: 'learning-experience-001' },
    lesson: ['Use independent QA before declaring success.'],
    feedback: { requestedChanges: ['Keep project scope explicit.'] },
    error: { reasons: ['Previous attempt missed a requirement.'] },
    performance: { failedChecks: ['requirements'] }
  };
  const experienceInput = fromLegacyExperiences({
    projectId: 'project-mira-v02', proposalId: 'proposal-experience-001',
    title: 'Experience retrieval review', rationale: 'Review verified related experiences.',
    proposedChange: 'Create a human-reviewed proposal only.',
    experiences: [{ experience, integrityVerified: true }]
  });
  assert.equal(experienceInput.evidence.length, 4);
  assert.ok(experienceInput.evidence.every(item => item.trustState === 'UNVERIFIED'));
  assert.throws(() => fromLegacyExperiences({
    projectId: 'project-mira-v02', proposalId: 'proposal-experience-002',
    title: 'Unverified experience', rationale: 'Must fail.', proposedChange: 'No changes.',
    experiences: [{ experience, integrityVerified: false }]
  }), error => error.code === 'HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED');
  console.log('HFM_PHASE8_EXPERIENCE_RETRIEVAL_TO_UNTRUSTED_PROPOSAL=PASS');

  const consolidatedInput = fromLegacyConsolidatedKnowledge({
    projectId: 'project-mira-v02', proposalId: 'proposal-knowledge-001',
    title: 'Consolidated knowledge review', rationale: 'Review store-integrity-verified knowledge.',
    proposedChange: 'Prepare a human-reviewed knowledge proposal.',
    storeIntegrity: { valid: true },
    item: { id: 'wk_abcdef1234567890', fingerprint: 'b'.repeat(64),
      lesson: 'Keep evidence provenance attached to each reusable knowledge item.',
      sourceRecords: [{ recordId: 'learning-001' }] }
  });
  assert.equal(consolidatedInput.evidence.length, 1);
  assert.equal(consolidatedInput.evidence[0].trustState, 'UNVERIFIED');
  assert.throws(() => fromLegacyConsolidatedKnowledge({
    projectId: 'project-mira-v02', proposalId: 'proposal-knowledge-002',
    title: 'Corrupt knowledge store', rationale: 'Must fail.', proposedChange: 'No changes.',
    storeIntegrity: { valid: false },
    item: { id: 'wk_abcdef1234567890', fingerprint: 'b'.repeat(64),
      lesson: 'Do not import corrupt store data.', sourceRecords: [{ recordId: 'learning-001' }] }
  }), error => error.code === 'HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED');
  console.log('HFM_PHASE8_KNOWLEDGE_CONSOLIDATION_TO_UNTRUSTED_PROPOSAL=PASS');

  const { sources, calls } = fixtures();
  const report = await inspectLegacyLearningCompatibility(sources);
  assert.equal(report.status, 'REVIEW_REQUIRED');
  assert.equal(report.checks.learningIntegrity, false);
  assert.equal(report.checks.experienceIntegrity, false);
  assert.equal(report.checks.retrievalReadOnly, true);
  assert.equal(report.checks.consolidationIntegrity, true);
  assert.equal(report.inventory.knowledgeConsolidation.itemCount, 3);
  assert.equal(report.inventory.evolutionRecovery.snapshotsFound, 2);
  assert.equal(report.inventory.evolutionRecovery.snapshotsVerified, 1);
  assert.equal(report.inventory.evolutionRecovery.snapshotsFailed, 1);
  assert.equal(report.migrationPerformed, false);
  assert.equal(report.canonicalMemoryWrites, 0);
  assert.equal(report.legacySourceWrites, 0);
  assert.equal(report.sourceFilesDeleted, 0);
  assert.equal(report.sourceFilesOverwritten, 0);
  assert.equal(report.rollbackExecuted, false);
  assert.equal(report.driveOrNetworkCalls, 0);
  assert.equal(calls.rollback, 0);
  assert.equal(calls.drive, 0);
  console.log('HFM_PHASE8_LEGACY_INTEGRITY_AND_SNAPSHOT_AUDIT=PASS');

  const clean = fixtures({
    learningEngine: {
      listLearningRecords: () => [{ learningId: 'learning-0001' }],
      verifyLearningRecordIntegrity: () => ({ found: true, valid: true })
    },
    experienceMemory: {
      listExperiences: () => [{ experienceId: 'experience-0001' }],
      verifyExperienceIntegrity: () => true
    },
    snapshotManager: {
      listSnapshots: () => ({ ok: true, snapshots: [] }),
      verifySnapshot: () => ({ ok: true })
    }
  });
  const cleanReport = await inspectLegacyLearningCompatibility(clean.sources);
  assert.equal(cleanReport.status, 'READ_ONLY_COMPATIBILITY_VERIFIED');
  assert.equal(cleanReport.inventory.learningRecords.integrityVerified, 1);
  assert.equal(cleanReport.inventory.experiences.integrityVerified, 1);
  console.log('HFM_PHASE8_READ_ONLY_LEARNING_EXPERIENCE_COMPATIBILITY=PASS');

  let corruptKnowledgeRead = 0;
  const corrupt = fixtures({
    knowledgeConsolidation: {
      verifyStoreIntegrity: () => ({ valid: false, reason: 'HASH_MISMATCH' }),
      getConsolidatedKnowledge: () => { corruptKnowledgeRead++; throw new Error('must not read corrupt store'); }
    }
  });
  const corruptReport = await inspectLegacyLearningCompatibility(corrupt.sources);
  assert.equal(corruptReport.status, 'REVIEW_REQUIRED');
  assert.equal(corruptReport.inventory.knowledgeConsolidation.itemCount, null);
  assert.equal(corruptKnowledgeRead, 0);
  console.log('HFM_PHASE8_CORRUPT_CONSOLIDATION_FAIL_CLOSED=PASS');

  await assert.rejects(() => inspectLegacyLearningCompatibility({}),
    error => error.code === 'HFM_LEGACY_COMPATIBILITY_SOURCE_UNAVAILABLE');
  console.log('HFM_PHASE8_REQUIRED_LEGACY_INTERFACES_FAIL_CLOSED=PASS');
  console.log('HFM_PHASE8_NO_MIGRATION_NO_ROLLBACK_NO_NETWORK=PASS');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  process.stderr.write(String(error.stack || error) + '\n');
  process.exitCode = 1;
});
