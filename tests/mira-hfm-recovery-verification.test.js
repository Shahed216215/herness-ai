'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const backup = require('../services/mira-hfm-emergency-backup');
const { verifyRecoveryCandidate } = require('../services/mira-hfm-recovery-verification');

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}
function digest(value) { return crypto.createHash('sha256').update(Buffer.from(canonicalize(value))).digest('hex'); }

(async () => {
  const kek = crypto.randomBytes(32);
  const keyProvider = {
    descriptor: { contractVersion: '1', providerId: 'recovery-test-kek', providerVersion: '1',
      keyId: 'recovery-test-key', keyVersion: '1', keyPurpose: 'MIRA_HFM_BACKUP', environment: 'test' },
    async wrapDataKey({ dataKey }) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', kek, nonce);
      const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
      return Buffer.from(JSON.stringify({ nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'),
        tag: cipher.getAuthTag().toString('base64') })).toString('base64');
    },
    async unwrapDataKey({ wrappedDataKey }) {
      const wrapped = JSON.parse(Buffer.from(wrappedDataKey, 'base64').toString('utf8'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(wrapped.nonce, 'base64'));
      decipher.setAuthTag(Buffer.from(wrapped.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertext, 'base64')), decipher.final()]);
    }
  };
  const snapshot = { records: [{ id: 'recovery-fixture-1', content: 'synthetic recovery drill' }] };
  const metadata = { schemaVersion: '1.0.0', projectId: 'recovery-project', sourceRevision: 'source-rev-8',
    recordCount: 1, keyId: 'recovery-test-key', keyVersion: '1' };
  const encrypted = await backup.encryptSnapshot({ snapshot, metadata, keyProvider });
  const baseline = { expectedProjectId: 'recovery-project', supportedSchemaVersions: ['1.0.0'],
    expectedSourceRevision: 'source-rev-8', expectedRecordCount: 1, expectedPayloadSha256: digest(snapshot) };
  const verified = await verifyRecoveryCandidate({ backup: encrypted.bytes, keyProvider, ...baseline });
  assert.equal(verified.status, 'RECOVERY_VERIFIED_PREVIEW_ONLY');
  assert.equal(verified.canonicalMemoryWritten, false);
  assert.equal(verified.canonicalKnowledgeWritten, false);
  assert.equal(verified.restoreExecuted, false);
  await assert.rejects(() => verifyRecoveryCandidate({ backup: encrypted.bytes, keyProvider,
    ...baseline, expectedSourceRevision: 'wrong-revision' }),
    error => error.code === 'HFM_RECOVERY_BASELINE_MISMATCH' && error.mismatches.includes('sourceRevision'));
  await assert.rejects(() => verifyRecoveryCandidate({ backup: encrypted.bytes, keyProvider,
    ...baseline, expectedPayloadSha256: '0'.repeat(64) }),
    error => error.code === 'HFM_RECOVERY_BASELINE_MISMATCH' && error.mismatches.includes('payloadSha256'));
  await assert.rejects(() => verifyRecoveryCandidate({ backup: encrypted.bytes, keyProvider,
    expectedProjectId: 'recovery-project' }), error => error.code === 'HFM_RECOVERY_BASELINE_REQUIRED');
  assert.deepEqual(snapshot.records, [{ id: 'recovery-fixture-1', content: 'synthetic recovery drill' }]);
  process.stdout.write('MIRA_HFM_PHASE7_RECOVERY_VERIFICATION_PASS\nCANONICAL_MEMORY_WRITTEN=NO\nCANONICAL_KNOWLEDGE_WRITTEN=NO\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
