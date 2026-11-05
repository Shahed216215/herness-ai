'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  createEncryptedBackup, decryptAndVerifyBackup, writeImmutableBackup, restoreToStaging
} = require('../services/mira-hfm-encrypted-emergency-backup');

const key = crypto.randomBytes(32);
const payload = Buffer.from(JSON.stringify({ schemaVersion: '1.0.0', memories: [{ id: 'mem-001', content: 'synthetic test memory' }] }));
const metadata = { projectId: 'mira-hfm-v02', source: 'synthetic-offline-test' };
const backupId = 'backup-test-0001';
const createdAt = '2026-11-05T00:00:00.000Z';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-backup-test-'));
const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-restore-test-'));

try {
  const envelope = createEncryptedBackup({ payload, key, backupId, createdAt, metadata });
  const env = JSON.parse(envelope.toString('utf8'));
  assert.equal(env.schema, 'MIRA_HFM_ENCRYPTED_EMERGENCY_BACKUP');
  assert.equal(env.algorithm, 'aes-256-gcm');
  assert.equal(env.kdf, 'HKDF-SHA256');
  assert.equal(env.metadata.projectId, metadata.projectId);
  assert.equal(envelope.includes(payload), false);
  const verified = decryptAndVerifyBackup(envelope, key);
  assert.deepEqual(verified.payload, payload);
  assert.equal(verified.plaintextSha256, crypto.createHash('sha256').update(payload).digest('hex'));
  console.log('HFM_PHASE7_ENCRYPT_DECRYPT_AND_AUTHENTICATE=PASS');

  assert.throws(() => decryptAndVerifyBackup(envelope, crypto.randomBytes(32)), error => error.code === 'HFM_BACKUP_AUTH_FAILED');
  const tampered = Buffer.from(envelope);
  const parsed = JSON.parse(tampered.toString('utf8'));
  parsed.metadata.projectId = 'attacker-project';
  assert.throws(() => decryptAndVerifyBackup(Buffer.from(JSON.stringify(parsed)), key));
  parsed.metadata.projectId = metadata.projectId;
  parsed.ciphertext = (parsed.ciphertext[0] === 'A' ? 'B' : 'A') + parsed.ciphertext.slice(1);
  assert.throws(() => decryptAndVerifyBackup(Buffer.from(JSON.stringify(parsed)), key));
  console.log('HFM_PHASE7_WRONG_KEY_AND_TAMPER_REJECTED=PASS');

  assert.throws(() => createEncryptedBackup({ payload, key: Buffer.alloc(16), backupId, createdAt }));
  assert.throws(() => createEncryptedBackup({ payload, key, backupId: '../escape', createdAt }));
  assert.throws(() => createEncryptedBackup({ payload: '', key, backupId, createdAt }));
  console.log('HFM_PHASE7_INPUT_AND_KEY_GATES=PASS');

  const stored = writeImmutableBackup({ envelope, directory: dir, backupId });
  assert.equal(fs.readFileSync(stored.path).toString('utf8'), envelope.toString('utf8'));
  assert.throws(() => writeImmutableBackup({ envelope, directory: dir, backupId }), error => error.code === 'EEXIST');
  console.log('HFM_PHASE7_IMMUTABLE_BACKUP_AND_READBACK=PASS');

  const staged = restoreToStaging({ envelope, key, directory: restoreDir, restoreId: 'restore-test-0001' });
  assert.equal(staged.status, 'VERIFIED_STAGING_ONLY');
  assert.equal(staged.canonicalMemoryWrites, 0);
  assert.equal(staged.productionRestore, false);
  assert.deepEqual(fs.readFileSync(staged.path), payload);
  assert.throws(() => restoreToStaging({ envelope, key, directory: restoreDir, restoreId: 'restore-test-0001' }), error => error.code === 'EEXIST');
  console.log('HFM_PHASE7_RESTORE_STAGING_ONLY=PASS');
  console.log('HFM_PHASE7_CANONICAL_WRITES=0');
  console.log('HFM_PHASE7_PRODUCTION_RESTORE=0');
  console.log('TESTS_FAILED=0');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
}
