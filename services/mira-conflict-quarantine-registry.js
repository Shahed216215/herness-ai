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
const DECISIONS = new Set(['MERGE', 'KEEP_BOTH', 'REJECT_INCOMING']);

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
function requireAudit(auditWriter, event) {
  if (typeof auditWriter !== 'function') throw new Error('An explicit auditWriter is required.');
  return auditWriter(event);
}
function conflictPath(directory, conflictId) {
  return path.join(directory, conflictId + '.conflict.json');
}
function resolutionPath(directory, conflictId) {
  return path.join(directory, conflictId + '.resolution.json');
}
function createConflictQuarantine({
  directory, projectId, conflictTypes, records, reason, actor, auditWriter
}) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('projectId is required.');
  if (!Array.isArray(records) || records.length !== 2) throw new Error('Exactly two original records are required.');
  if (!Array.isArray(conflictTypes) || !conflictTypes.length ||
      conflictTypes.some(type => !CONFLICT_TYPES.has(type))) throw new Error('Unsupported conflict type.');
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('Actor identity is required.');
  for (const record of records) validateRecord(record, projectId);

  const originals = records.map(record => ({
    memoryId: record.memoryId,
    revision: record.version.revision,
    recordDigest: digest(record),
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
  if (envelope.conflictId !== conflictId) throw new Error('Conflict identity mismatch.');
  if (projectId && envelope.projectId !== projectId) throw new Error('Cross-project conflict access denied.');
  return envelope;
}
function verifyConflict({ directory, conflictId, projectId }) {
  const envelope = readConflict({ directory, conflictId, projectId });
  const { envelopeDigest, ...rest } = envelope;
  const expected = digest(rest);
  const originalsValid = rest.originals.length === 2 && rest.originals.every(item =>
    digest(item.record) === item.recordDigest &&
    item.record.memoryId === item.memoryId &&
    item.record.version.revision === item.revision &&
    validateCanonicalMemoryRecord(item.record).length === 0 &&
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
  let resolution;
  try {
    resolution = readRegularJson(resolutionPath(directory, conflictId));
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'NOT_RESOLVED', conflictId };
    throw error;
  }
  const { resolutionDigest, ...body } = resolution;
  const expectedOriginals = envelope.originals.map(item => item.recordDigest);
  const originalsMatch = digest(resolution.originalDigests) === digest(expectedOriginals);
  const resultValid = resolution.decision !== 'MERGE' ||
    (resolution.resultingRecord &&
     validateCanonicalMemoryRecord(resolution.resultingRecord).length === 0 &&
     resolution.resultingRecord.projectId === envelope.projectId &&
     resolution.resultingRecord.memoryId === envelope.originals[0].memoryId &&
     envelope.originals.every(item => item.memoryId === envelope.originals[0].memoryId) &&
     resolution.resultingRecord.version.revision ===
       Math.max(...envelope.originals.map(item => item.revision)) + 1);
  return {
    status: resolutionDigest === digest(body) && originalsMatch && resultValid
      ? 'VERIFIED' : 'INTEGRITY_FAILED',
    conflictId, resolutionDigest, originalsMatch, resultValid
  };
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
      const resolution = verifyResolution({
        directory, conflictId: envelope.conflictId, projectId: envelope.projectId
      });
      const status = integrity !== 'VERIFIED' || resolution.status === 'INTEGRITY_FAILED'
        ? 'INTEGRITY_FAILED'
        : (resolution.status === 'VERIFIED' ? 'RESOLVED' : 'PENDING_REVIEW');
      return {
        conflictId: envelope.conflictId,
        projectId: envelope.projectId,
        conflictTypes: envelope.conflictTypes,
        status, integrity, resolutionIntegrity: resolution.status,
        originalMemoryIds: envelope.originals.map(item => item.memoryId)
      };
    }).filter(Boolean);
}
function resolveConflict({
  directory, conflictId, projectId, decision, actor, policyDecision,
  mergedRecord, auditWriter, authorizeResolution
}) {
  if (!DECISIONS.has(decision)) throw new Error('Unsupported conflict resolution decision.');
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('Resolution actor is required.');
  if (typeof policyDecision !== 'string' || !policyDecision.trim()) throw new Error('Policy decision reference is required.');
  const envelope = readConflict({ directory, conflictId, projectId });
  if (typeof authorizeResolution !== 'function') throw new Error('An explicit authorizeResolution callback is required.');
  const authorized = authorizeResolution({
    conflictId, projectId: envelope.projectId, decision, actor, policyDecision,
    originalDigests: envelope.originals.map(item => item.recordDigest)
  });
  if (authorized !== true) throw new Error('Conflict resolution authorization denied.');
  const originals = envelope.originals.map(item => item.record);
  let resultRecord = null;
  if (decision === 'MERGE') {
    if (!mergedRecord) throw new Error('MERGE requires an explicit mergedRecord.');
    validateRecord(mergedRecord, envelope.projectId);
    if (mergedRecord.memoryId !== originals[0].memoryId ||
        originals[0].memoryId !== originals[1].memoryId) throw new Error('Merged record must preserve the shared original memoryId.');
    if (mergedRecord.version.revision !== Math.max(...originals.map(r => r.version.revision)) + 1) {
      throw new Error('Merged record revision must increment exactly once above the highest original revision.');
    }
    resultRecord = mergedRecord;
  } else if (mergedRecord) {
    throw new Error('Only MERGE may include a mergedRecord.');
  }
  const resolution = {
    resolutionSchemaVersion: '1.0.0',
    conflictId, projectId: envelope.projectId, decision, actor,
    policyDecision, originalDigests: envelope.originals.map(item => item.recordDigest),
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
    resolutionDigest: readRegularJson(target).resolutionDigest
  };
}
function filterTrustedRecords(records, pendingConflicts) {
  if (!Array.isArray(records) || !Array.isArray(pendingConflicts)) throw new Error('Arrays are required.');
  const blocked = new Set(pendingConflicts
    .filter(item => ['PENDING_REVIEW', 'INTEGRITY_FAILED'].includes(item.status))
    .flatMap(item => item.originalMemoryIds || []));
  return records.filter(record => !blocked.has(record.memoryId));
}

module.exports = {
  createConflictQuarantine, readConflict, verifyConflict,
  listConflicts, resolveConflict, verifyResolution, filterTrustedRecords
};
