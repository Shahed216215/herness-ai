'use strict';

const crypto = require('node:crypto');
const { decryptBackup } = require('./mira-hfm-emergency-backup');

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Recovery snapshot contains unsupported data.');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error('Recovery snapshot contains unsupported data.');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

/**
 * Performs a non-mutating recovery drill: decrypt, authenticate, validate
 * schema/project/count, and compare against an independently supplied digest.
 * It never writes or replaces canonical Memory/Knowledge.
 */
async function verifyRecoveryCandidate({
  backup, keyProvider, expectedProjectId, supportedSchemaVersions,
  expectedSourceRevision, expectedRecordCount, expectedPayloadSha256
}) {
  if (typeof expectedSourceRevision !== 'string' || !expectedSourceRevision.trim() ||
      !Number.isSafeInteger(expectedRecordCount) || expectedRecordCount < 0 ||
      typeof expectedPayloadSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedPayloadSha256)) {
    const error = new Error('Independent recovery baseline (source revision, record count, and SHA-256) is required.');
    error.code = 'HFM_RECOVERY_BASELINE_REQUIRED';
    throw error;
  }
  const result = await decryptBackup({ backup, keyProvider, expectedProjectId, supportedSchemaVersions });
  const actualDigest = sha256(Buffer.from(canonicalize(result.snapshot), 'utf8'));
  const mismatches = [];
  if (result.manifest.sourceRevision !== expectedSourceRevision) mismatches.push('sourceRevision');
  if (result.manifest.recordCount !== expectedRecordCount) mismatches.push('recordCount');
  if (actualDigest !== expectedPayloadSha256) mismatches.push('payloadSha256');
  if (mismatches.length) {
    const error = new Error('Recovery candidate does not match the independent baseline: ' + mismatches.join(', '));
    error.code = 'HFM_RECOVERY_BASELINE_MISMATCH';
    error.mismatches = mismatches;
    throw error;
  }
  return {
    status: 'RECOVERY_VERIFIED_PREVIEW_ONLY',
    integrity: result.integrity,
    projectId: result.manifest.projectId,
    schemaVersion: result.manifest.schemaVersion,
    sourceRevision: result.manifest.sourceRevision,
    recordCount: result.manifest.recordCount,
    payloadSha256: actualDigest,
    canonicalMemoryWritten: false,
    canonicalKnowledgeWritten: false,
    restoreExecuted: false,
    productionApproval: false
  };
}

module.exports = { verifyRecoveryCandidate };
