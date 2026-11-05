'use strict';

const crypto = require('node:crypto');

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (!isPlainObject(value)) throw new Error('Snapshot contains an unsupported value.');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

/**
 * Calls an injected read-only snapshot source and validates its declared
 * authorization and revision attestation. This validates contract shape only:
 * it does not authenticate the source or prove that the actor is authorized.
 */
async function captureAuthorizedSnapshot({ source, request }) {
  if (!isPlainObject(source) || !isPlainObject(source.descriptor) ||
      typeof source.readSnapshot !== 'function' || typeof request !== 'object' ||
      !request || typeof request.projectId !== 'string' || !request.projectId.trim() ||
      typeof request.actorId !== 'string' || !request.actorId.trim() ||
      request.scope !== 'backup:read') {
    const error = new Error('A read-only snapshot source and explicit project/actor backup-read request are required.');
    error.code = 'HFM_SNAPSHOT_SOURCE_CONTRACT_MISSING';
    throw error;
  }
  const descriptor = source.descriptor;
  if (descriptor.contractVersion !== '1' || typeof descriptor.sourceId !== 'string' ||
      !descriptor.sourceId.trim() || descriptor.mode !== 'read-only' ||
      descriptor.environment !== 'test' && descriptor.environment !== 'staging' && descriptor.environment !== 'production') {
    const error = new Error('Snapshot source descriptor is invalid or is not explicitly read-only.');
    error.code = 'HFM_SNAPSHOT_SOURCE_CONTRACT_INVALID';
    throw error;
  }
  const result = await source.readSnapshot({
    projectId: request.projectId,
    actorId: request.actorId,
    scope: request.scope
  });
  if (!isPlainObject(result) || !isPlainObject(result.snapshot) || !Array.isArray(result.snapshot.records) ||
      !isPlainObject(result.attestation)) {
    const error = new Error('Snapshot source returned an invalid snapshot or attestation.');
    error.code = 'HFM_SNAPSHOT_ATTESTATION_INVALID';
    throw error;
  }
  const a = result.attestation;
  if (a.sourceId !== descriptor.sourceId || a.projectId !== request.projectId ||
      a.authorizationDecision !== 'ALLOW' || a.actorId !== request.actorId ||
      a.authorizationScope !== 'backup:read' ||
      typeof a.sourceRevision !== 'string' || !a.sourceRevision.trim() ||
      typeof a.schemaVersion !== 'string' || !a.schemaVersion.trim() ||
      !Number.isFinite(Date.parse(a.capturedAt)) ||
      a.recordCount !== result.snapshot.records.length ||
      typeof a.payloadSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.payloadSha256) ||
      sha256(Buffer.from(canonicalize(result.snapshot), 'utf8')) !== a.payloadSha256) {
    const error = new Error('Snapshot source authorization, project, revision, count, or digest attestation failed.');
    error.code = 'HFM_SNAPSHOT_ATTESTATION_MISMATCH';
    throw error;
  }
  return {
    status: 'SNAPSHOT_CONTRACT_VERIFIED_NOT_SOURCE_AUTHENTICATED',
    snapshot: result.snapshot,
    metadata: {
      schemaVersion: a.schemaVersion,
      projectId: a.projectId,
      sourceRevision: a.sourceRevision,
      recordCount: a.recordCount
    },
    evidence: {
      sourceId: a.sourceId,
      actorId: a.actorId,
      authorizationScope: a.authorizationScope,
      capturedAt: a.capturedAt,
      payloadSha256: a.payloadSha256,
      sourceIdentityAuthenticated: false,
      productionApproval: false
    }
  };
}

module.exports = { captureAuthorizedSnapshot };
