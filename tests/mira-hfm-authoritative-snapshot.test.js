'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  captureAuthorizedSnapshot, createEncryptedBackupFromSource, canonicalize, sha256
} = require('../services/mira-hfm-authoritative-snapshot');

function signedFixture({ privateKey, snapshot, request, sourceId = 'fixture-source',
  keyId = 'fixture-signing-key', capturedAt = new Date().toISOString(),
  authorizationDecision = 'ALLOW', nonce = request.nonce } = {}) {
  const attestation = {
    sourceId, signingKeyId: keyId, projectId: request.projectId, actorId: request.actorId,
    authorizationDecision, authorizationScope: request.scope, requestId: request.requestId, nonce,
    sourceRevision: 'revision-17', schemaVersion: '1.0.0', capturedAt,
    recordCount: snapshot.records.length,
    payloadSha256: sha256(Buffer.from(canonicalize(snapshot), 'utf8'))
  };
  attestation.signature = crypto.sign(null, Buffer.from(canonicalize(attestation), 'utf8'), privateKey).toString('base64');
  return attestation;
}
function createSource({ request, snapshot, privateKey, alter } = {}) {
  return {
    descriptor: { contractVersion: '1', sourceId: 'fixture-source', signingKeyId: 'fixture-signing-key',
      mode: 'read-only', environment: 'test' },
    async readSnapshot(received) {
      assert.equal(received.scope, 'backup:read');
      const attestation = signedFixture({ privateKey, snapshot, request, ...(alter || {}) });
      return { snapshot, attestation };
    }
  };
}
function trust(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return { 'fixture-source': { keyId: 'fixture-signing-key', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    publicKeySha256: sha256(der) } };
}
function testKeyProvider() {
  const kek = crypto.randomBytes(32);
  return {
    descriptor: { contractVersion: '1', providerId: 'test-kek', providerVersion: '1',
      keyId: 'test-backup-kek', keyVersion: '1', keyPurpose: 'MIRA_HFM_BACKUP', environment: 'test' },
    async wrapDataKey({ dataKey }) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', kek, nonce);
      const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
      return Buffer.from(JSON.stringify({ nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'),
        tag: cipher.getAuthTag().toString('base64') })).toString('base64');
    },
    async unwrapDataKey({ wrappedDataKey }) {
      const w = JSON.parse(Buffer.from(wrappedDataKey, 'base64').toString('utf8'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(w.nonce, 'base64'));
      decipher.setAuthTag(Buffer.from(w.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(w.ciphertext, 'base64')), decipher.final()]);
    }
  };
}

(async () => {
  const now = Date.now();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const snapshot = { records: [{ id: 'fixture-1', value: 'synthetic-only' }] };
  const request = { projectId: 'project-test', actorId: 'actor-test', scope: 'backup:read',
    requestId: 'request-unique-001', nonce: crypto.randomBytes(24).toString('base64url') };
  const trustedSources = trust(publicKey);
  const source = createSource({ request, snapshot, privateKey });
  const captured = await captureAuthorizedSnapshot({ source, request, trustedSources, now });
  assert.equal(captured.status, 'SNAPSHOT_SOURCE_SIGNATURE_VERIFIED_AUTHORIZATION_CLAIM');
  assert.equal(captured.evidence.signatureVerified, true);
  assert.equal(captured.evidence.authorizationIndependentlyEnforced, false);
  assert.equal(captured.metadata.sourceRevision, 'revision-17');

  await assert.rejects(() => captureAuthorizedSnapshot({ source, request: { ...request, nonce: 'different-nonce-123456' },
    trustedSources, now }), error => error.code === 'HFM_SNAPSHOT_ATTESTATION_MISMATCH');
  const denied = createSource({ request, snapshot, privateKey, alter: { authorizationDecision: 'DENY' } });
  await assert.rejects(() => captureAuthorizedSnapshot({ source: denied, request, trustedSources, now }),
    error => error.code === 'HFM_SNAPSHOT_ATTESTATION_MISMATCH');
  const stale = createSource({ request, snapshot, privateKey, alter: { capturedAt: new Date(now - 600000).toISOString() } });
  await assert.rejects(() => captureAuthorizedSnapshot({ source: stale, request, trustedSources, now }),
    error => error.code === 'HFM_SNAPSHOT_ATTESTATION_MISMATCH');
  const untrusted = { 'fixture-source': { ...trustedSources['fixture-source'], publicKeySha256: '0'.repeat(64) } };
  await assert.rejects(() => captureAuthorizedSnapshot({ source, request, trustedSources: untrusted, now }),
    error => error.code === 'HFM_SNAPSHOT_TRUST_ANCHOR_MISMATCH');
  const wrongKey = createSource({ request, snapshot, privateKey, alter: { keyId: 'other-key' } });
  await assert.rejects(() => captureAuthorizedSnapshot({ source: wrongKey, request, trustedSources, now }),
    error => error.code === 'HFM_SNAPSHOT_ATTESTATION_MISMATCH');

  const prepared = await createEncryptedBackupFromSource({ source, request, trustedSources,
    keyProvider: testKeyProvider(), now });
  assert.equal(prepared.status, 'ENCRYPTED_BACKUP_PREPARED_NOT_PUBLISHED');
  assert.equal(prepared.sourceEvidence.signatureVerified, true);
  assert.equal(prepared.localFileWritten, false);
  assert.equal(prepared.driveObjectWritten, false);
  assert.equal(prepared.canonicalMemoryWritten, false);
  process.stdout.write('MIRA_HFM_PHASE7_SIGNED_SNAPSHOT_SOURCE_PASS\nMIRA_HFM_PHASE7_SOURCE_TO_ENCRYPTED_BACKUP_PASS\nPRODUCTION_SOURCE_AUTHENTICATED=NO\nNETWORK_REQUESTS=0\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
