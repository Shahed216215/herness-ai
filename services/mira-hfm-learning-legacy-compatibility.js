'use strict';

const crypto = require('node:crypto');

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function boundedCount(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    fail('HFM_LEGACY_COMPATIBILITY_INVALID', label + ' is outside the supported range.');
  }
  return value;
}

/**
 * Read-only compatibility inspection for the existing Learning, Experience,
 * Knowledge Consolidation and Evolution Snapshot subsystems.
 *
 * This function deliberately does not call any write, proposal, restore,
 * rollback, Drive, or network operation. It creates an evidence inventory
 * only; it is not a migration or a canonical HFM import.
 */
async function inspectLegacyLearningCompatibility({
  learningEngine,
  experienceMemory,
  experienceRetrievalEngine,
  knowledgeConsolidation,
  snapshotManager,
  evolution
} = {}) {
  const required = [
    [learningEngine, ['listLearningRecords', 'verifyLearningRecordIntegrity']],
    [experienceMemory, ['listExperiences', 'verifyExperienceIntegrity']],
    [experienceRetrievalEngine, ['getRetrievalStats']],
    [knowledgeConsolidation, ['verifyStoreIntegrity', 'getConsolidatedKnowledge']],
    [snapshotManager, ['listSnapshots', 'verifySnapshot']],
    [evolution, ['rollbackEvolution', 'verifyEvolutionState']]
  ];
  for (const [source, methods] of required) {
    if (!source || methods.some(name => typeof source[name] !== 'function')) {
      fail('HFM_LEGACY_COMPATIBILITY_SOURCE_UNAVAILABLE',
        'A required legacy subsystem read/verification interface is unavailable.');
    }
  }

  const learningRecords = learningEngine.listLearningRecords({ limit: 5000 });
  if (!Array.isArray(learningRecords)) fail('HFM_LEGACY_COMPATIBILITY_INVALID', 'Learning Engine returned an invalid record collection.');
  boundedCount(learningRecords.length, 'learning record count');
  let learningValid = 0, learningInvalid = 0;
  const learningIds = [];
  for (const record of learningRecords) {
    if (!record || typeof record.learningId !== 'string' || !record.learningId.trim()) {
      learningInvalid++;
      continue;
    }
    learningIds.push(record.learningId);
    const result = learningEngine.verifyLearningRecordIntegrity(record.learningId);
    if (result && result.found === true && result.valid === true) learningValid++;
    else learningInvalid++;
  }

  const experiences = experienceMemory.listExperiences({ limit: 5000 });
  if (!Array.isArray(experiences)) fail('HFM_LEGACY_COMPATIBILITY_INVALID', 'Experience Memory returned an invalid collection.');
  boundedCount(experiences.length, 'experience count');
  let experienceValid = 0, experienceInvalid = 0;
  for (const experience of experiences) {
    if (experienceMemory.verifyExperienceIntegrity(experience) === true) experienceValid++;
    else experienceInvalid++;
  }

  const retrievalStats = experienceRetrievalEngine.getRetrievalStats();
  const retrievalReadOnly = !!retrievalStats &&
    retrievalStats.retrievalIsReadOnly === true &&
    retrievalStats.autonomousExecution === false &&
    retrievalStats.sourceWritable === false &&
    retrievalStats.governanceBypass === false;

  const consolidationIntegrity = knowledgeConsolidation.verifyStoreIntegrity();
  let consolidatedCount = null;
  if (consolidationIntegrity && consolidationIntegrity.valid === true) {
    const consolidated = knowledgeConsolidation.getConsolidatedKnowledge();
    if (!Array.isArray(consolidated)) fail('HFM_LEGACY_COMPATIBILITY_INVALID', 'Knowledge Consolidation returned an invalid collection.');
    consolidatedCount = boundedCount(consolidated.length, 'consolidated knowledge count');
  }

  const snapshotList = snapshotManager.listSnapshots();
  if (!snapshotList || snapshotList.ok !== true || !Array.isArray(snapshotList.snapshots)) {
    fail('HFM_LEGACY_COMPATIBILITY_SNAPSHOT_LIST_FAILED', 'Evolution snapshot inventory could not be verified.');
  }
  boundedCount(snapshotList.snapshots.length, 'snapshot count');
  let snapshotsVerified = 0, snapshotsInvalid = 0;
  const snapshotRefs = [];
  for (const snapshot of snapshotList.snapshots) {
    if (!snapshot || typeof snapshot.changeId !== 'string' || typeof snapshot.snapshotId !== 'string') {
      snapshotsInvalid++;
      continue;
    }
    const verification = snapshotManager.verifySnapshot(snapshot.changeId, snapshot.snapshotId);
    if (verification && verification.ok === true) {
      snapshotsVerified++;
      snapshotRefs.push({
        changeId: snapshot.changeId,
        snapshotId: snapshot.snapshotId,
        createdAt: typeof snapshot.createdAt === 'string' ? snapshot.createdAt : null
      });
    } else {
      snapshotsInvalid++;
    }
  }

  const checks = {
    learningIntegrity: learningInvalid === 0,
    experienceIntegrity: experienceInvalid === 0,
    retrievalReadOnly,
    consolidationIntegrity: !!(consolidationIntegrity && consolidationIntegrity.valid === true),
    evolutionSnapshots: snapshotsInvalid === 0,
    rollbackInterfaceAvailable: typeof evolution.rollbackEvolution === 'function',
    evolutionStateVerificationInterfaceAvailable: typeof evolution.verifyEvolutionState === 'function'
  };
  const passed = Object.values(checks).every(value => value === true);
  const inventory = {
    learningRecords: { total: learningRecords.length, integrityVerified: learningValid, integrityFailed: learningInvalid },
    experiences: { total: experiences.length, integrityVerified: experienceValid, integrityFailed: experienceInvalid },
    retrieval: { readOnly: retrievalReadOnly, sourceExperienceCount: retrievalStats.sourceExperienceCount || 0 },
    knowledgeConsolidation: {
      integrityVerified: checks.consolidationIntegrity,
      itemCount: consolidatedCount,
      integrityReason: consolidationIntegrity && consolidationIntegrity.reason || null
    },
    evolutionRecovery: {
      snapshotsFound: snapshotList.snapshots.length,
      snapshotsVerified,
      snapshotsFailed: snapshotsInvalid,
      rollbackInterfaceAvailable: checks.rollbackInterfaceAvailable,
      stateVerificationInterfaceAvailable: checks.evolutionStateVerificationInterfaceAvailable,
      verifiedSnapshotRefs: snapshotRefs
    }
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    learningIds, inventory, checks
  }), 'utf8').digest('hex');
  return Object.freeze({
    schemaVersion: '1.0.0',
    status: passed ? 'READ_ONLY_COMPATIBILITY_VERIFIED' : 'REVIEW_REQUIRED',
    checks: Object.freeze(checks),
    inventory: Object.freeze(inventory),
    evidenceDigest: digest,
    migrationPerformed: false,
    canonicalMemoryWrites: 0,
    legacySourceWrites: 0,
    sourceFilesDeleted: 0,
    sourceFilesOverwritten: 0,
    rollbackExecuted: false,
    driveOrNetworkCalls: 0,
    automaticPromotion: false,
    automaticExecution: false
  });
}

module.exports = { inspectLegacyLearningCompatibility };
