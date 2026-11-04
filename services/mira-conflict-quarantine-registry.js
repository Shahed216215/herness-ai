'use strict';

// Additive, local-only conflict quarantine lifecycle.
// This module is not wired into production Memory/Knowledge/provider adapters.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  validateCanonicalMemoryRecord
} = require('./mira-memory-conflict-assessment');

const CONFLICT_TYPES = new Set([
  'IDENTITY_CONFLICT', 'REVISION_CONFLICT', 'CONTENT_CONFLICT',
  'SOURCE_CONFLICT', 'ACCESS_CONFLICT', 'SCHEMA_CONFLICT',
  'INTEGRITY_CONFLICT'
]);
const DECISIONS = new Set(['ACCEPT_EXISTING_VERSION', 'ACCEPT_ALTERNATE_VERSION', 'APPROVED_FIELD_MERGE', 'REJECT_CONFLICTING_CHANGE', 'RETAIN_QUARANTINED']);

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function safeDirectory(directory) {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  if (resolved === root) throw new Error('Filesystem root cannot be used as a conflict quarantine directory.');
  let current = root;
  const segments = resolved.slice(root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      fs.lstatSync(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Conflict quarantine path contains an unsafe directory component.');
    }
  }
}
function readRegularJson(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Quarantine entry is not a safe regular file.');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
function writeImmutableJson(filePath, value) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    '.mira-quarantine-tmp-' + process.pid + '-' + crypto.randomBytes(12).toString('hex')
  );
  let fd;
  let linked = false;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, bytes, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    // Hard-link publication is atomic and refuses to overwrite an existing
    // immutable destination. The final name is visible only after full write+fsync.
    fs.linkSync(tempPath, filePath);
    linked = true;
    fs.unlinkSync(tempPath);

    const dirFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    const readback = readRegularJson(filePath);
    if (digest(readback) !== digest(value)) throw new Error('Quarantine immutable-write readback mismatch.');
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(tempPath); } catch {}
    if (linked) {
      error.stateCommitted = true;
      error.code = error.code || 'IMMUTABLE_WRITE_COMMITTED_VERIFY_FAILED';
    }
    throw error;
  }
}
function validateRecord(record, projectId) {
  const errors = validateCanonicalMemoryRecord(record);
  if (errors.length) throw new Error('Conflict source record is invalid: ' + errors.join('; '));
  if (record.projectId !== projectId) throw new Error('Cross-project conflict record rejected.');
  if (record.integrity.status !== 'VERIFIED') throw new Error('Conflict source record must declare VERIFIED integrity.');
}
function validateQuarantinableRecord(record, projectId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Conflict source record must be an object.');
  }
  if (record.projectId !== projectId) throw new Error('Cross-project conflict record rejected.');
  if (typeof record.memoryId !== 'string' || record.memoryId.length < 8 || record.memoryId.length > 128) {
    throw new Error('Conflict source record must retain a valid memoryId for project-scoped quarantine.');
  }
}
function buildResolutionProposal(envelope, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('A structured resolutionProposal is required.');
  }
  const allowed = ['fieldLevelChanges', 'dataLossRisks', 'requiredAuthority', 'recoveryPoint', 'verificationPlan'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Unsupported resolutionProposal field.');
  if (!Array.isArray(input.fieldLevelChanges) ||
      input.fieldLevelChanges.some(change => !change || typeof change !== 'object' ||
        typeof change.path !== 'string' || !change.path.trim() ||
        typeof change.change !== 'string' || !change.change.trim() ||
        ![null, undefined].includes(change.beforeDigest) && !/^[a-f0-9]{64}$/.test(change.beforeDigest) ||
        ![null, undefined].includes(change.afterDigest) && !/^[a-f0-9]{64}$/.test(change.afterDigest) ||
        Object.keys(change).some(key => !['path', 'change', 'beforeDigest', 'afterDigest'].includes(key)))) {
    throw new Error('resolutionProposal.fieldLevelChanges is invalid.');
  }
  if (!Array.isArray(input.dataLossRisks) || !input.dataLossRisks.length ||
      input.dataLossRisks.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error('resolutionProposal.dataLossRisks must document identified risks or NONE_IDENTIFIED.');
  }
  if (typeof input.requiredAuthority !== 'string' || !input.requiredAuthority.trim()) {
    throw new Error('resolutionProposal.requiredAuthority is required.');
  }
  if (typeof input.recoveryPoint !== 'string' || !input.recoveryPoint.trim()) {
    throw new Error('resolutionProposal.recoveryPoint is required.');
  }
  if (!Array.isArray(input.verificationPlan) || !input.verificationPlan.length ||
      input.verificationPlan.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error('resolutionProposal.verificationPlan must contain verification steps.');
  }
  return {
    affectedVersions: envelope.originals.map(item => ({
      memoryId: item.memoryId, revision: item.revision
    })),
    sourceReferences: envelope.originals.map(item => ({
      sourceType: item.record.source?.sourceType || null,
      sourceId: item.record.source?.sourceId || null,
      sourceUrl: item.record.source?.sourceUrl || null
    })),
    originalHashes: envelope.originals.map(item => item.recordDigest),
    accessClasses: envelope.originals.map(item => item.record.access?.classification || 'MISSING'),
    trustStates: envelope.originals.map(item => item.record.trust?.status || 'MISSING'),
    fieldLevelChanges: input.fieldLevelChanges,
    dataLossRisks: input.dataLossRisks,
    requiredAuthority: input.requiredAuthority,
    recoveryPoint: input.recoveryPoint,
    verificationPlan: input.verificationPlan
  };
}
function requireAudit(auditWriter, event) {
  if (typeof auditWriter !== 'function') throw new Error('An explicit auditWriter is required.');
  return auditWriter(event);
}
function validateConflictId(conflictId) {
  if (typeof conflictId !== 'string' || !/^mira-conflict-[a-f0-9]{64}$/.test(conflictId)) {
    throw new Error('Invalid conflictId.');
  }
}
function conflictPath(directory, conflictId) {
  validateConflictId(conflictId);
  return path.join(directory, conflictId + '.conflict.json');
}
function resolutionPath(directory, conflictId) {
  validateConflictId(conflictId);
  return path.join(directory, conflictId + '.resolution.json');
}
function reviewPath(directory, conflictId) {
  validateConflictId(conflictId);
  return path.join(directory, conflictId + '.review.json');
}
function createConflictQuarantine({
  directory, projectId, conflictTypes, records, reason, actor, auditWriter
}) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('projectId is required.');
  if (!Array.isArray(records) || records.length < 2) throw new Error('At least two competing original records are required.');
  if (!Array.isArray(conflictTypes) || !conflictTypes.length ||
      conflictTypes.some(type => !CONFLICT_TYPES.has(type))) throw new Error('Unsupported conflict type.');
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('Actor identity is required.');
  for (const record of records) validateQuarantinableRecord(record, projectId);

  const originals = records.map(record => ({
    memoryId: record.memoryId,
    revision: Number.isInteger(record.version?.revision) ? record.version.revision : null,
    recordDigest: digest(record),
    schemaValidationErrors: validateCanonicalMemoryRecord(record),
    declaredIntegrityStatus: record.integrity?.status || 'MISSING',
    declaredTrustStatus: record.trust?.status || 'MISSING',
    record
  }));
  const identity = {
    quarantineSchemaVersion: '1.0.0',
    projectId,
    conflictTypes: [...new Set(conflictTypes)].sort(),
    originals: originals.map(({ memoryId, revision, recordDigest }) => ({ memoryId, revision, recordDigest }))
  };
  const conflictId = 'mira-conflict-' + digest(identity);
  const envelope = {
    ...identity,
    conflictId,
    reason: String(reason || 'CONFLICT_REQUIRES_REVIEW'),
    createdAt: new Date().toISOString(),
    createdBy: actor,
    originals
  };
  envelope.envelopeDigest = digest(envelope);
  safeDirectory(directory);
  const target = conflictPath(directory, conflictId);
  let alreadyExists = false;
  try {
    const existing = readRegularJson(target);
    if (digest(existing) !== digest(envelope) &&
        (digest(existing.originals.map(item => item.record)) !== digest(records) ||
         existing.projectId !== projectId ||
         digest(existing.conflictTypes) !== digest(identity.conflictTypes) ||
         existing.reason !== envelope.reason)) {
      throw new Error('Conflict ID collision with different immutable content.');
    }
    alreadyExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!alreadyExists) {
    try {
      writeImmutableJson(target, envelope);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = readRegularJson(target);
      if (digest(existing.originals.map(item => item.record)) !== digest(records) ||
          existing.projectId !== projectId ||
          digest(existing.conflictTypes) !== digest(identity.conflictTypes) ||
          existing.reason !== envelope.reason) throw new Error('Concurrent conflict ID collision.');
      alreadyExists = true;
    }
  }
  try {
    requireAudit(auditWriter, {
      action: 'memory_conflict_quarantined',
      conflictId, projectId, actor, envelopeDigest: alreadyExists
        ? readRegularJson(target).envelopeDigest : envelope.envelopeDigest
    });
  } catch (error) {
    error.code = 'CONFLICT_QUARANTINED_AUDIT_FAILED';
    error.stateCommitted = true;
    throw error;
  }
  return {
    status: alreadyExists ? 'ALREADY_EXISTS' : 'QUARANTINED',
    conflictId,
    envelopeDigest: readRegularJson(target).envelopeDigest
  };
}
function readConflict({ directory, conflictId, projectId }) {
  safeDirectory(directory);
  const envelope = readRegularJson(conflictPath(directory, conflictId));
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Conflict envelope is malformed.');
  }
  if (envelope.conflictId !== conflictId) throw new Error('Conflict identity mismatch.');
  if (projectId && envelope.projectId !== projectId) throw new Error('Cross-project conflict access denied.');
  return envelope;
}
function verifyConflict({ directory, conflictId, projectId }) {
  const envelope = readConflict({ directory, conflictId, projectId });
  const { envelopeDigest, ...rest } = envelope;
  const expected = digest(rest);
  const originalsValid = Array.isArray(rest.originals) && rest.originals.length >= 2 &&
    rest.originals.every(item =>
      item && item.record && typeof item.record === 'object' && !Array.isArray(item.record) &&
      digest(item.record) === item.recordDigest &&
      item.record.memoryId === item.memoryId &&
      (Number.isInteger(item.record.version?.revision) ? item.record.version.revision : null) === item.revision &&
      item.record.projectId === rest.projectId
    );
  return {
    status: envelopeDigest === expected && originalsValid ? 'VERIFIED' : 'INTEGRITY_FAILED',
    conflictId, envelopeDigest, originalsValid,
    cryptographicVerification: 'SHA-256_LOCAL_ENVELOPE_AND_ORIGINALS'
  };
}
function verifyResolution({ directory, conflictId, projectId }) {
  const envelope = readConflict({ directory, conflictId, projectId });
  if (verifyConflict({ directory, conflictId, projectId }).status !== 'VERIFIED') {
    return { status: 'INTEGRITY_FAILED', conflictId, reason: 'CONFLICT_ENVELOPE_NOT_VERIFIED' };
  }
  let resolution;
  try {
    resolution = readRegularJson(resolutionPath(directory, conflictId));
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'NOT_RESOLVED', conflictId };
    throw error;
  }
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) {
    return { status: 'INTEGRITY_FAILED', conflictId, reason: 'INVALID_RESOLUTION_ENVELOPE' };
  }
  const review = verifyReview({ directory, conflictId, projectId });
  if (review.status !== 'VERIFIED') {
    return { status: 'INTEGRITY_FAILED', conflictId, reason: 'REVIEW_STATE_NOT_VERIFIED' };
  }
  const { resolutionDigest, ...body } = resolution;
  const expectedOriginals = envelope.originals.map(item => item.recordDigest);
  const originalsMatch = Array.isArray(resolution.originalDigests) &&
    digest(resolution.originalDigests) === digest(expectedOriginals);
  let proposalValid = false;
  try {
    const proposalInput = resolution.proposal;
    const rebuiltProposal = buildResolutionProposal(envelope, {
      fieldLevelChanges: proposalInput.fieldLevelChanges,
      dataLossRisks: proposalInput.dataLossRisks,
      requiredAuthority: proposalInput.requiredAuthority,
      recoveryPoint: proposalInput.recoveryPoint,
      verificationPlan: proposalInput.verificationPlan
    });
    proposalValid = digest(rebuiltProposal) === digest(proposalInput);
  } catch {}
  const acceptedIndex = resolution.decision === 'ACCEPT_EXISTING_VERSION' ||
    resolution.decision === 'ACCEPT_ALTERNATE_VERSION' ||
    resolution.decision === 'REJECT_CONFLICTING_CHANGE'
      ? resolution.acceptedOriginalIndex : null;
  const acceptedIndexValid = resolution.decision === 'ACCEPT_ALTERNATE_VERSION'
    ? Number.isInteger(acceptedIndex) && acceptedIndex >= 1 && acceptedIndex < expectedOriginals.length
    : (resolution.decision === 'ACCEPT_EXISTING_VERSION' || resolution.decision === 'REJECT_CONFLICTING_CHANGE'
      ? Number.isInteger(acceptedIndex) && acceptedIndex >= 0 && acceptedIndex < expectedOriginals.length
      : acceptedIndex === null);
  const acceptedDigest = Number.isInteger(acceptedIndex) && acceptedIndex >= 0 &&
    acceptedIndex < expectedOriginals.length ? expectedOriginals[acceptedIndex] : null;
  const resultValid = resolution.decision === 'APPROVED_FIELD_MERGE'
    ? (resolution.resultingRecord &&
       resolution.acceptedOriginalDigest === null &&
       resolution.acceptedOriginalIndex === null &&
       validateCanonicalMemoryRecord(resolution.resultingRecord).length === 0 &&
       resolution.resultingRecord.projectId === envelope.projectId &&
       resolution.resultingRecord.memoryId === envelope.originals[0].memoryId &&
       envelope.originals.every(item => item.memoryId === envelope.originals[0].memoryId) &&
       resolution.resultingRecord.version.revision ===
         Math.max(...envelope.originals.map(item => item.revision)) + 1 &&
       (envelope.originals.some(item => digest(item.record.access || null) !== digest(resolution.resultingRecord.access || null))
         ? (typeof resolution.broaderAccessAuthorization === 'string' && resolution.broaderAccessAuthorization.trim().length > 0)
         : resolution.broaderAccessAuthorization === null))
    : resolution.decision === 'RETAIN_QUARANTINED'
      ? (!resolution.resultingRecord && resolution.acceptedOriginalDigest === null && resolution.acceptedOriginalIndex === null && resolution.broaderAccessAuthorization === null)
      : (DECISIONS.has(resolution.decision) && acceptedIndexValid && !resolution.resultingRecord &&
         resolution.broaderAccessAuthorization === null &&
         resolution.acceptedOriginalIndex === acceptedIndex &&
         resolution.acceptedOriginalDigest === acceptedDigest);
  return {
    status: resolutionDigest === digest(body) && resolution.reviewDigest === review.reviewDigest && originalsMatch && proposalValid && resultValid
      ? 'VERIFIED' : 'INTEGRITY_FAILED',
    conflictId, resolutionDigest, originalsMatch, resultValid
  };
}
function verifyReview({ directory, conflictId, projectId }) {
  const envelope = readConflict({ directory, conflictId, projectId });
  if (verifyConflict({ directory, conflictId, projectId }).status !== 'VERIFIED') {
    return { status: 'INTEGRITY_FAILED', conflictId };
  }
  let review;
  try {
    review = readRegularJson(reviewPath(directory, conflictId));
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'NOT_STARTED', conflictId };
    throw error;
  }
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return { status: 'INTEGRITY_FAILED', conflictId };
  }
  const { reviewDigest, ...body } = review;
  const originals = envelope.originals.map(item => item.recordDigest);
  const valid = review.conflictId === conflictId &&
    review.projectId === envelope.projectId &&
    review.state === 'UNDER_REVIEW' &&
    typeof review.actor === 'string' && review.actor.trim() &&
    typeof review.policyDecision === 'string' && review.policyDecision.trim() &&
    typeof review.startedAt === 'string' && Number.isFinite(Date.parse(review.startedAt)) &&
    Array.isArray(review.originalDigests) &&
    digest(review.originalDigests) === digest(originals) &&
    reviewDigest === digest(body);
  return { status: valid ? 'VERIFIED' : 'INTEGRITY_FAILED', conflictId, reviewDigest };
}
function beginConflictReview({
  directory, conflictId, projectId, actor, policyDecision,
  authorizeReview, auditWriter
}) {
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('Review actor is required.');
  if (typeof policyDecision !== 'string' || !policyDecision.trim()) throw new Error('Review policy decision is required.');
  const envelope = readConflict({ directory, conflictId, projectId });
  if (verifyConflict({ directory, conflictId, projectId }).status !== 'VERIFIED') {
    throw new Error('Conflict envelope integrity verification failed; review is blocked.');
  }
  if (fs.existsSync(resolutionPath(directory, conflictId))) {
    throw new Error('A resolved conflict cannot enter review again.');
  }
  const target = reviewPath(directory, conflictId);
  if (fs.existsSync(target)) {
    const existing = verifyReview({ directory, conflictId, projectId });
    const stored = readRegularJson(target);
    if (existing.status !== 'VERIFIED') throw new Error('Existing review record failed integrity verification.');
    if (stored.actor !== actor || stored.policyDecision !== policyDecision) {
      throw new Error('Conflict is already under review by a different review authority.');
    }
    try {
      requireAudit(auditWriter, {
        action: 'memory_conflict_review_started', conflictId, projectId,
        actor, policyDecision, reviewDigest: stored.reviewDigest
      });
    } catch (error) {
      error.code = 'CONFLICT_REVIEW_AUDIT_FAILED';
      error.stateCommitted = true;
      throw error;
    }
    return { status: 'ALREADY_UNDER_REVIEW', conflictId, reviewDigest: stored.reviewDigest };
  }
  if (typeof authorizeReview !== 'function') throw new Error('An explicit authorizeReview callback is required.');
  const reviewRequest = {
    conflictId, projectId: envelope.projectId, actor, policyDecision,
    originalDigests: envelope.originals.map(item => item.recordDigest)
  };
  if (authorizeReview(reviewRequest) !== true) throw new Error('Conflict review authorization denied.');
  const review = {
    reviewSchemaVersion: '1.0.0',
    conflictId, projectId: envelope.projectId, state: 'UNDER_REVIEW',
    actor, policyDecision,
    originalDigests: envelope.originals.map(item => item.recordDigest),
    startedAt: new Date().toISOString()
  };
  review.reviewDigest = digest(review);
  try {
    writeImmutableJson(target, review);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = verifyReview({ directory, conflictId, projectId });
    if (existing.status !== 'VERIFIED') throw new Error('Concurrent review record collision.');
    const stored = readRegularJson(target);
    if (stored.actor !== actor || stored.policyDecision !== policyDecision) {
      throw new Error('Concurrent review was claimed by a different review authority.');
    }
    try {
      requireAudit(auditWriter, {
        action: 'memory_conflict_review_started', conflictId, projectId,
        actor, policyDecision, reviewDigest: stored.reviewDigest
      });
    } catch (auditError) {
      auditError.code = 'CONFLICT_REVIEW_AUDIT_FAILED';
      auditError.stateCommitted = true;
      throw auditError;
    }
    return { status: 'ALREADY_UNDER_REVIEW', conflictId, reviewDigest: existing.reviewDigest };
  }
  try {
    requireAudit(auditWriter, {
      action: 'memory_conflict_review_started', conflictId, projectId,
      actor, policyDecision, reviewDigest: review.reviewDigest
    });
  } catch (error) {
    error.code = 'CONFLICT_REVIEW_AUDIT_FAILED';
    error.stateCommitted = true;
    throw error;
  }
  return { status: 'UNDER_REVIEW', conflictId, reviewDigest: review.reviewDigest };
}
function listConflicts({ directory, projectId }) {
  safeDirectory(directory);
  return fs.readdirSync(directory)
    .filter(name => name.endsWith('.conflict.json'))
    .sort()
    .map(name => {
      const envelope = readRegularJson(path.join(directory, name));
      if (projectId && envelope.projectId !== projectId) return null;
      const integrity = verifyConflict({
        directory, conflictId: envelope.conflictId, projectId: envelope.projectId
      }).status;
      const review = verifyReview({
        directory, conflictId: envelope.conflictId, projectId: envelope.projectId
      });
      const resolution = verifyResolution({
        directory, conflictId: envelope.conflictId, projectId: envelope.projectId
      });
      const resolutionRecord = resolution.status === 'VERIFIED'
        ? readRegularJson(resolutionPath(directory, envelope.conflictId)) : null;
      let status = 'QUARANTINED';
      if (integrity !== 'VERIFIED' || review.status === 'INTEGRITY_FAILED' ||
          resolution.status === 'INTEGRITY_FAILED') status = 'INTEGRITY_FAILED';
      else if (resolution.status === 'VERIFIED') {
        if (resolutionRecord.decision === 'RETAIN_QUARANTINED') status = 'RETAINED_QUARANTINED';
        else if (resolutionRecord.decision === 'REJECT_CONFLICTING_CHANGE') status = 'REJECTED';
        else status = 'RESOLVED';
      } else if (review.status === 'VERIFIED') status = 'UNDER_REVIEW';
      return {
        conflictId: envelope.conflictId,
        projectId: envelope.projectId,
        conflictTypes: envelope.conflictTypes,
        status, state: ['INTEGRITY_FAILED', 'RETAINED_QUARANTINED'].includes(status) ? 'QUARANTINED' : status,
        integrity, reviewIntegrity: review.status, resolutionIntegrity: resolution.status,
        originalMemoryIds: envelope.originals.map(item => item.memoryId)
      };
    }).filter(Boolean);
}
function resolveConflict({
  directory, conflictId, projectId, decision, actor, policyDecision,
  mergedRecord, acceptedOriginalIndex, resolutionProposal, auditWriter, authorizeResolution,
  authorizeBroaderAccess, broaderAccessAuthorization
}) {
  if (!DECISIONS.has(decision)) throw new Error('Unsupported conflict resolution decision.');
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('Resolution actor is required.');
  if (typeof policyDecision !== 'string' || !policyDecision.trim()) throw new Error('Policy decision reference is required.');
  const envelope = readConflict({ directory, conflictId, projectId });
  if (verifyConflict({ directory, conflictId, projectId }).status !== 'VERIFIED') {
    throw new Error('Conflict envelope integrity verification failed; resolution is blocked.');
  }
  const review = verifyReview({ directory, conflictId, projectId });
  if (review.status !== 'VERIFIED') throw new Error('Conflict must be in verified UNDER_REVIEW state before resolution.');
  const proposal = buildResolutionProposal(envelope, resolutionProposal);
  if (typeof authorizeResolution !== 'function') throw new Error('An explicit authorizeResolution callback is required.');
  const authorized = authorizeResolution({
    conflictId, projectId: envelope.projectId, decision, actor, policyDecision,
    originalDigests: envelope.originals.map(item => item.recordDigest),
    resolutionProposal: proposal
  });
  if (authorized !== true) throw new Error('Conflict resolution authorization denied.');
  const originals = envelope.originals.map(item => item.record);
  let resultRecord = null;
  let acceptedOriginalDigest = null;
  if (decision === 'APPROVED_FIELD_MERGE') {
    if (acceptedOriginalIndex !== undefined && acceptedOriginalIndex !== null) {
      throw new Error('APPROVED_FIELD_MERGE cannot select one original version.');
    }
    if (!mergedRecord) throw new Error('APPROVED_FIELD_MERGE requires an explicit mergedRecord.');
    validateRecord(mergedRecord, envelope.projectId);
    if (originals.some(record => record.memoryId !== originals[0].memoryId)) {
      throw new Error('APPROVED_FIELD_MERGE requires all originals to share one memoryId.');
    }
    if (originals.some(record => !Number.isInteger(record.version?.revision))) {
      throw new Error('APPROVED_FIELD_MERGE requires valid revision numbers on every original.');
    }
    if (mergedRecord.memoryId !== originals[0].memoryId) throw new Error('Merged record must preserve the shared original memoryId.');
    if (mergedRecord.version.revision !== Math.max(...originals.map(r => r.version.revision)) + 1) {
      throw new Error('Merged record revision must increment exactly once above the highest original revision.');
    }
    const accessChanged = originals.some(record => digest(record.access || null) !== digest(mergedRecord.access || null));
    if (accessChanged) {
      if (typeof authorizeBroaderAccess !== 'function' || authorizeBroaderAccess({
        conflictId, projectId: envelope.projectId, actor, policyDecision,
        originalAccessClasses: originals.map(record => record.access?.classification || 'MISSING'),
        originalAccessPolicies: originals.map(record => record.access || null),
        resultingAccessClass: mergedRecord.access?.classification || 'MISSING',
        resultingAccessPolicy: mergedRecord.access || null,
        originalAccessPolicyDigests: originals.map(record => digest(record.access || null)),
        resultingAccessPolicyDigest: digest(mergedRecord.access || null),
        originalDigests: envelope.originals.map(item => item.recordDigest)
      }) !== true || typeof broaderAccessAuthorization !== 'string' || !broaderAccessAuthorization.trim()) {
        throw new Error('Changed access classification or policy requires separate broader-access authorization evidence.');
      }
    } else if (broaderAccessAuthorization !== undefined && broaderAccessAuthorization !== null) {
      throw new Error('Unnecessary broader-access authorization evidence is not accepted.');
    }
    resultRecord = mergedRecord;
  } else {
    if (mergedRecord) throw new Error('Only APPROVED_FIELD_MERGE may include a mergedRecord.');
    if (decision === 'RETAIN_QUARANTINED' && acceptedOriginalIndex !== undefined && acceptedOriginalIndex !== null) {
      throw new Error('RETAIN_QUARANTINED cannot select an accepted original version.');
    }
    if (decision === 'ACCEPT_EXISTING_VERSION' || decision === 'REJECT_CONFLICTING_CHANGE') {
      if (acceptedOriginalIndex === undefined) {
        throw new Error(decision + ' requires an explicit acceptedOriginalIndex; original ordering is not authority.');
      }
      if (!Number.isInteger(acceptedOriginalIndex) || acceptedOriginalIndex < 0 || acceptedOriginalIndex >= envelope.originals.length) {
        throw new Error(decision + ' requires a valid acceptedOriginalIndex.');
      }
      acceptedOriginalDigest = envelope.originals[acceptedOriginalIndex].recordDigest;
    } else if (decision === 'ACCEPT_ALTERNATE_VERSION') {
      if (!Number.isInteger(acceptedOriginalIndex) || acceptedOriginalIndex < 1 || acceptedOriginalIndex >= envelope.originals.length) {
        throw new Error('ACCEPT_ALTERNATE_VERSION requires a valid acceptedOriginalIndex from 1 through the final original index.');
      }
      acceptedOriginalDigest = envelope.originals[acceptedOriginalIndex].recordDigest;
    } else {
      acceptedOriginalIndex = null;
    }
  }
  const resolution = {
    resolutionSchemaVersion: '1.0.0',
    conflictId, projectId: envelope.projectId, decision, actor,
    policyDecision, originalDigests: envelope.originals.map(item => item.recordDigest),
    proposal,
    reviewDigest: review.reviewDigest,
    acceptedOriginalIndex: acceptedOriginalIndex ?? null,
    acceptedOriginalDigest,
    broaderAccessAuthorization: broaderAccessAuthorization || null,
    resultingRecord: resultRecord,
    resolvedAt: new Date().toISOString()
  };
  resolution.resolutionDigest = digest(resolution);
  const target = resolutionPath(directory, conflictId);
  let alreadyResolved = false;
  try {
    const existing = readRegularJson(target);
    if (existing.conflictId !== conflictId || existing.projectId !== projectId ||
        existing.decision !== decision || existing.actor !== actor ||
        existing.policyDecision !== policyDecision ||
        existing.acceptedOriginalIndex !== resolution.acceptedOriginalIndex ||
        existing.broaderAccessAuthorization !== resolution.broaderAccessAuthorization ||
        existing.reviewDigest !== resolution.reviewDigest ||
        digest(existing.proposal) !== digest(resolution.proposal) ||
        digest(existing.originalDigests) !== digest(resolution.originalDigests) ||
        digest(existing.resultingRecord) !== digest(resolution.resultingRecord)) {
      throw new Error('Conflict already has a different immutable resolution.');
    }
    alreadyResolved = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!alreadyResolved) {
    try {
      writeImmutableJson(target, resolution);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = readRegularJson(target);
      if (existing.conflictId !== conflictId || existing.decision !== decision ||
          existing.actor !== actor || existing.policyDecision !== policyDecision ||
          existing.acceptedOriginalIndex !== resolution.acceptedOriginalIndex ||
          existing.broaderAccessAuthorization !== resolution.broaderAccessAuthorization ||
          existing.reviewDigest !== resolution.reviewDigest ||
          digest(existing.proposal) !== digest(resolution.proposal) ||
          digest(existing.originalDigests) !== digest(resolution.originalDigests) ||
          digest(existing.resultingRecord) !== digest(resolution.resultingRecord)) {
        throw new Error('Concurrent conflicting resolution rejected.');
      }
      alreadyResolved = true;
    }
  }
  try {
    requireAudit(auditWriter, {
      action: 'memory_conflict_resolved', conflictId, projectId,
      actor, decision, policyDecision,
      resolutionDigest: readRegularJson(target).resolutionDigest
    });
  } catch (error) {
    error.code = 'CONFLICT_RESOLUTION_AUDIT_FAILED';
    error.stateCommitted = true;
    throw error;
  }
  return {
    status: alreadyResolved ? 'ALREADY_RESOLVED' : 'RESOLVED',
    conflictId,
    decision,
    acceptedOriginalIndex: readRegularJson(target).acceptedOriginalIndex,
    acceptedOriginalDigest: readRegularJson(target).acceptedOriginalDigest,
    resolutionDigest: readRegularJson(target).resolutionDigest
  };
}
function filterTrustedRecords(records, pendingConflicts, projectId) {
  if (!Array.isArray(records) || !Array.isArray(pendingConflicts)) throw new Error('Arrays are required.');
  if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('projectId is required for trusted retrieval filtering.');
  const blocked = new Set(pendingConflicts
    .filter(item => item.projectId === projectId &&
      ['QUARANTINED', 'UNDER_REVIEW', 'PENDING_REVIEW', 'INTEGRITY_FAILED', 'RETAINED_QUARANTINED'].includes(item.status))
    .flatMap(item => item.originalMemoryIds || []));
  return records.filter(record =>
    record &&
    record.projectId === projectId &&
    record.lifecycle === 'ACTIVE' &&
    record.integrity?.status === 'VERIFIED' &&
    !['UNVERIFIED', 'QUARANTINED'].includes(record.trust?.status) &&
    !blocked.has(record.memoryId)
  );
}

module.exports = {
  createConflictQuarantine, readConflict, verifyConflict,
  beginConflictReview, verifyReview, listConflicts,
  resolveConflict, verifyResolution, filterTrustedRecords
};
