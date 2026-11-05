'use strict';

const assert = require('node:assert/strict');
const { inspectLegacyLearningCompatibility } = require('../services/mira-hfm-learning-legacy-compatibility');

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
