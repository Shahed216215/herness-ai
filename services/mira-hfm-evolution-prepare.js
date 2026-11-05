'use strict';

// Prepare-only Evolution bridge. It never applies proposals or writes state.
const crypto = require('node:crypto');
const { retrieveCanonicalRecordsWithReport } = require('./mira-memory-unified-facade');
const { assertNoSecretFields } = require('./mira-hfm-work-learning-adapter');

const RECOVERY_EVIDENCE_KEYS = [
  'decision', 'backupId', 'backupDigest', 'projectId',
  'sourceMemoryId', 'sourceRecordDigest', 'sourceRevision',
  'verifiedAt', 'expiresAt'
];
function fail(message, code = 'HFM_EVOLUTION_PREPARE_BLOCKED') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function text(value, label, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(label + ' is required and must be bounded text.');
  }
  return value.trim();
}
function timestamp(value, label) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    fail(label + ' must be an RFC 3339 timestamp.');
  }
  return Date.parse(value);
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function validateRecoveryEvidence({ evidence, recoveryPoint, source, projectId, now }) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
      Object.keys(evidence).length !== RECOVERY_EVIDENCE_KEYS.length ||
      RECOVERY_EVIDENCE_KEYS.some(key => !Object.prototype.hasOwnProperty.call(evidence, key))) {
    fail('Trusted recovery verifier returned an invalid evidence shape.');
  }
  if (evidence.decision !== 'VERIFIED' ||
      evidence.backupId !== recoveryPoint.backupId ||
      evidence.backupDigest !== recoveryPoint.backupDigest ||
      evidence.projectId !== projectId ||
      evidence.sourceMemoryId !== source.memoryId ||
      evidence.sourceRecordDigest !== source.recordDigest ||
      evidence.sourceRevision !== source.revision) {
    fail('Verified recovery point does not bind the exact project and source revision.');
  }
  const verifiedAt = timestamp(evidence.verifiedAt, 'recovery verifiedAt');
  const expiresAt = timestamp(evidence.expiresAt, 'recovery expiresAt');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs) || verifiedAt > nowMs || expiresAt <= nowMs || expiresAt <= verifiedAt) {
    fail('Recovery verification evidence is future-dated or expired.');
  }
  return Object.freeze({ ...evidence });
}
function prepareGovernedEvolution({
  records, pendingConflicts, projectId, requestContext, authorizeRequest,
  sourceMemoryId, expectedSourceRevision, expectedSourceDigest,
  proposal, recoveryPoint, verifyRecoveryPoint, now = new Date()
}) {
  text(projectId, 'projectId', 128);
  text(sourceMemoryId, 'sourceMemoryId', 128);
  if (!Number.isInteger(expectedSourceRevision) || expectedSourceRevision < 1) {
    fail('expectedSourceRevision must be a positive integer.');
  }
  if (typeof expectedSourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSourceDigest)) {
    fail('expectedSourceDigest must be SHA-256.');
  }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    fail('A structured Evolution proposal is required.');
  }
  const proposalKeys = [
    'proposalId', 'title', 'category', 'risk', 'instruction',
    'requestedChanges', 'idempotencyKey'
  ];
  if (Object.keys(proposal).length !== proposalKeys.length ||
      proposalKeys.some(key => !Object.prototype.hasOwnProperty.call(proposal, key))) {
    fail('Evolution proposal must contain the exact supported fields.');
  }
  text(proposal.proposalId, 'proposalId', 128);
  text(proposal.title, 'proposal.title', 300);
  text(proposal.category, 'proposal.category', 64);
  text(proposal.risk, 'proposal.risk', 32);
  text(proposal.instruction, 'proposal.instruction', 3000);
  text(proposal.idempotencyKey, 'proposal.idempotencyKey', 256);
  if (!Array.isArray(proposal.requestedChanges) ||
      proposal.requestedChanges.length < 1 ||
      proposal.requestedChanges.length > 20 ||
      proposal.requestedChanges.some(item => typeof item !== 'string' || !item.trim() || item.length > 1000)) {
    fail('proposal.requestedChanges must contain 1-20 bounded descriptions.');
  }
  if (!recoveryPoint || typeof recoveryPoint !== 'object' || Array.isArray(recoveryPoint)) {
    fail('A verified recovery-point reference is required before Evolution preparation.');
  }
  for (const key of ['backupId', 'backupDigest']) text(recoveryPoint[key], 'recoveryPoint.' + key, 512);
  if (!/^[a-f0-9]{64}$/.test(recoveryPoint.backupDigest)) fail('recoveryPoint.backupDigest must be SHA-256.');
  if (typeof verifyRecoveryPoint !== 'function') {
    fail('A trusted recovery-point verifier is required; caller-supplied status is not trusted.');
  }

  const report = retrieveCanonicalRecordsWithReport({
    records, pendingConflicts, projectId, requestContext, authorizeRequest, now
  });
  const source = report.records.find(record => record.memoryId === sourceMemoryId);
  if (!source) fail('Source Memory is not eligible for authorized project-scoped retrieval.');
  if (source.version.revision !== expectedSourceRevision) fail('Evolution source revision is stale.');
  const provenance = report.provenance.find(item => item.memoryId === sourceMemoryId);
  if (!provenance || provenance.recordDigest !== expectedSourceDigest) {
    fail('Evolution source digest does not match the verified canonical record.');
  }
  if (source.recordType !== 'lesson' || source.source?.sourceType !== 'legacy_import') {
    fail('Evolution preparation requires a canonical Work Learning lesson source.');
  }
  let payload;
  try { payload = JSON.parse(source.content); } catch { fail('Work Learning source payload is invalid JSON.'); }
  if (!payload || payload.domain !== 'work_learning' ||
      !payload.record || payload.record.learningId !== source.source.sourceId) {
    fail('Work Learning source lineage is invalid.');
  }
  try { assertNoSecretFields(payload.record); } catch { fail('Work Learning source contains a prohibited secret-like field.'); }

  const recoveryEvidence = validateRecoveryEvidence({
    evidence: verifyRecoveryPoint(Object.freeze({
      backupId: recoveryPoint.backupId,
      backupDigest: recoveryPoint.backupDigest,
      projectId,
      sourceMemoryId,
      sourceRecordDigest: provenance.recordDigest,
      sourceRevision: source.version.revision
    })),
    recoveryPoint, source: {
      memoryId: sourceMemoryId,
      revision: source.version.revision,
      recordDigest: provenance.recordDigest
    },
    projectId, now
  });

  const sourceLineage = Object.freeze({
    memoryId: sourceMemoryId,
    projectId,
    revision: source.version.revision,
    recordDigest: provenance.recordDigest,
    sourceId: source.source.sourceId
  });
  const idempotencyPlan = Object.freeze({
    key: proposal.idempotencyKey,
    actorId: requestContext.actorId,
    projectId,
    proposalId: proposal.proposalId,
    sourceMemoryId,
    requiredAtomicity: 'HOST_ATOMIC_UNIQUE_CLAIM',
    status: 'NOT_RESERVED_PREPARE_ONLY'
  });
  const auditPlan = Object.freeze({
    event: 'hfm_evolution_proposal_prepared',
    actorId: requestContext.actorId,
    projectId,
    requestId: requestContext.requestId,
    proposalId: proposal.proposalId,
    sourceMemoryId,
    sourceRevision: source.version.revision,
    eventRequiredBeforeAnyCommit: true,
    status: 'PLAN_ONLY_NOT_EMITTED'
  });
  const envelope = {
    schemaVersion: '1.0.0',
    status: 'PREPARED_NOT_COMMITTED',
    proposal: {
      proposalId: proposal.proposalId,
      title: proposal.title,
      category: proposal.category,
      risk: proposal.risk,
      instruction: proposal.instruction,
      requestedChanges: [...proposal.requestedChanges]
    },
    sourceLineage,
    recoveryEvidence,
    idempotencyPlan,
    auditPlan,
    governance: {
      approvalRequired: true,
      autoApplied: false,
      executionAllowed: false,
      applyAllowed: false,
      persistentWrite: false,
      requiresHumanApproval: true,
      requiresVerifiedRecoveryPoint: true,
      rollbackRequiredBeforeApply: true
    }
  };
  envelope.envelopeDigest = digest(envelope);
  return Object.freeze({
    ...envelope,
    proposal: Object.freeze({
      ...envelope.proposal,
      requestedChanges: Object.freeze([...envelope.proposal.requestedChanges])
    })
  });
}
module.exports = { prepareGovernedEvolution, validateRecoveryEvidence, digest };
