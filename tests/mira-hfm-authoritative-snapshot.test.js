'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { captureAuthorizedSnapshot } = require('../services/mira-hfm-authoritative-snapshot');

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}
function digest(value) { return crypto.createHash('sha256').update(Buffer.from(canonicalize(value))).digest('hex'); }

(async () => {
  const snapshot = { records: [{ id: 'fixture-1', value: 'synthetic-only' }] };
  let calls = 0;
  const source = {
    descriptor: { contractVersion: '1', sourceId: 'fixture-source', mode: 'read-only', environment: 'test' },
    async readSnapshot(request) {
      calls++;
      assert.deepEqual(request, { projectId: 'project-test', actorId: 'actor-test', scope: 'backup:read' });
      return { snapshot, attestation: {
        sourceId: 'fixture-source', projectId: 'project-test', authorizationDecision: 'ALLOW',
        actorId: 'actor-test', authorizationScope: 'backup:read', sourceRevision: 'revision-17',
        schemaVersion: '1.0.0', capturedAt: new Date().toISOString(), recordCount: 1,
        payloadSha256: digest(snapshot)
      } };
    }
  };
  const request = { projectId: 'project-test', actorId: 'actor-test', scope: 'backup:read' };
  const captured = await captureAuthorizedSnapshot({ source, request });
  assert.equal(captured.status, 'SNAPSHOT_CONTRACT_VERIFIED_NOT_SOURCE_AUTHENTICATED');
  assert.equal(captured.metadata.sourceRevision, 'revision-17');
  assert.equal(captured.metadata.recordCount, 1);
  assert.equal(captured.evidence.sourceIdentityAuthenticated, false);
  assert.equal(captured.evidence.productionApproval, false);
  assert.equal(calls, 1);

  await assert.rejects(() => captureAuthorizedSnapshot({ source, request: { ...request, scope: 'backup:write' } }),
    error => error.code === 'HFM_SNAPSHOT_SOURCE_CONTRACT_MISSING');
  const denied = { ...source, async readSnapshot() {
    return { snapshot, attestation: { sourceId: 'fixture-source', projectId: 'project-test',
      authorizationDecision: 'DENY', actorId: 'actor-test', authorizationScope: 'backup:read',
      sourceRevision: 'r1', schemaVersion: '1.0.0', capturedAt: new Date().toISOString(),
      recordCount: 1, payloadSha256: digest(snapshot) } };
  } };
  await assert.rejects(() => captureAuthorizedSnapshot({ source: denied, request }),
    error => error.code === 'HFM_SNAPSHOT_ATTESTATION_MISMATCH');
  const mismatchedDigest = { ...source, async readSnapshot() {
    const valid = await source.readSnapshot(request);
    valid.attestation.payloadSha256 = '0'.repeat(64);
    return valid;
  } };
  await assert.rejects(() => captureAuthorizedSnapshot({ source: mismatchedDigest, request }),
    error => error.code === 'HFM_SNAPSHOT_ATTESTATION_MISMATCH');
  const writable = { ...source, descriptor: { ...source.descriptor, mode: 'read-write' } };
  await assert.rejects(() => captureAuthorizedSnapshot({ source: writable, request }),
    error => error.code === 'HFM_SNAPSHOT_SOURCE_CONTRACT_INVALID');
  process.stdout.write('MIRA_HFM_PHASE7_SNAPSHOT_SOURCE_CONTRACT_PASS\nPRODUCTION_SOURCE_AUTHENTICATED=NO\nNETWORK_REQUESTS=0\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
