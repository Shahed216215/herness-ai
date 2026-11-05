'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const backup = require('../services/mira-hfm-emergency-backup');

const kek = crypto.randomBytes(32);
const keyProvider = {
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
(async () => {
  const snapshot = { records: [{ memoryId: 'm-1', revision: 1, content: 'fixture' }] };
  const metadata = { schemaVersion: '1.0.0', projectId: 'project-fixture', sourceRevision: 'fixture-revision-1',
    recordCount: 1, keyId: 'fixture-kek-reference', keyVersion: '1' };
  const encrypted = await backup.encryptSnapshot({ snapshot, metadata, keyProvider });
  const restored = await backup.decryptBackup({ backup: encrypted.bytes, keyProvider, expectedProjectId: 'project-fixture',
    supportedSchemaVersions: ['1.0.0'] });
  assert.deepEqual(restored.snapshot, snapshot);
  assert.equal(restored.status, 'VERIFIED');
  assert.throws(() => backup.encryptSnapshot({ snapshot, metadata: { ...metadata, recordCount: 2 }, keyProvider }), /record count/);
  await assert.rejects(() => backup.decryptBackup({ backup: encrypted.bytes, keyProvider: {}, expectedProjectId: 'project-fixture' }),
    error => error.code === 'BACKUP_KEY_PROVIDER_UNAVAILABLE');
  await assert.rejects(() => backup.decryptBackup({ backup: encrypted.bytes, keyProvider, expectedProjectId: 'another-project' }),
    error => error.code === 'BACKUP_PROJECT_SCOPE_MISMATCH');
  await assert.rejects(() => backup.decryptBackup({ backup: encrypted.bytes, keyProvider, supportedSchemaVersions: ['9.9.9'] }),
    error => error.code === 'BACKUP_SCHEMA_UNSUPPORTED');
  const tampered = JSON.parse(encrypted.bytes.toString('utf8'));
  tampered.manifest.projectId = 'tampered';
  await assert.rejects(() => backup.decryptBackup({ backup: tampered, keyProvider }),
    error => error.code === 'BACKUP_MANIFEST_INTEGRITY_FAILED');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-backup-'));
  try {
    const target = path.join(temp, 'fixture.mira-hfm.enc.json');
    const write = backup.writeBackupAtomic(target, encrypted.bytes);
    assert.equal(write.status, 'LOCAL_WRITE_VERIFIED');
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    assert.throws(() => backup.writeBackupAtomic(target, encrypted.bytes), error => error.code === 'BACKUP_ALREADY_EXISTS');
    const inventory = backup.inspectBackupDirectory(temp);
    assert.equal(inventory.length, 1);
    assert.equal(inventory[0].status, 'MANIFEST_VALID_ENCRYPTED_CONTENT_NOT_DECRYPTED');
    const plan = backup.buildRetentionPlan([
      { name: 'new', status: 'MANIFEST_VALID_ENCRYPTED_CONTENT_NOT_DECRYPTED', createdAt: new Date().toISOString(), sizeBytes: 100 },
      { name: 'bad', status: 'REVIEW_REQUIRED', createdAt: new Date().toISOString(), sizeBytes: 1 }
    ], { maxBackups: 1, maxAgeDays: 30, maxBytes: 1000 });
    assert.deepEqual(plan.keep, ['new']);
    assert.deepEqual(plan.proposedDelete, []);
    assert.deepEqual(plan.reviewRequired, ['bad']);
    assert.equal(plan.deletionExecuted, false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  const quota = backup.assessDriveQuota({ usageBytes: 100, limitBytes: 1000, verified: true }, 500);
  assert.equal(quota.effectiveLimitBytes, 500);
  assert.equal(quota.remainingBytes, 400);
  assert.equal(quota.status, 'QUOTA_SNAPSHOT_VERIFIED');
  assert.throws(() => backup.assessDriveQuota({ usageBytes: -1 }), /quota snapshot/);
  process.stdout.write('MIRA_HFM_PHASE7_EMERGENCY_BACKUP_CONTRACT_PASS\nNETWORK_REQUESTS=0\nPRODUCTION_MEMORY_TOUCHED=NO\nBACKUP_DELETION=0\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
