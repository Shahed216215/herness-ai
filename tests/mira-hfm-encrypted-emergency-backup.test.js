'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  createEncryptedBackup, decryptAndVerifyBackup, previewEncryptedBackup, writeImmutableBackup, restoreToStaging
} = require('../services/mira-hfm-encrypted-emergency-backup');

const key = crypto.randomBytes(32);
const payload = Buffer.from(JSON.stringify({ schemaVersion: '1.0.0', memories: [{ id: 'mem-001', content: 'synthetic test memory' }] }));
const metadata = { projectId: 'mira-hfm-v02', source: 'synthetic-offline-test' };
const backupId = 'backup-test-0001';
const createdAt = '2026-11-05T00:00:00.000Z';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-backup-test-'));
const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-restore-test-'));

async function main() {
try {
  const envelope = createEncryptedBackup({ payload, key, backupId, createdAt, metadata });
  const env = JSON.parse(envelope.toString('utf8'));
  assert.equal(env.schema, 'MIRA_HFM_ENCRYPTED_EMERGENCY_BACKUP');
  assert.equal(env.algorithm, 'aes-256-gcm');
  assert.equal(env.kdf, 'HKDF-SHA256');
  assert.equal(env.metadata.projectId, metadata.projectId);
  assert.equal(envelope.includes(payload), false);
  const verified = decryptAndVerifyBackup(envelope, key);
  const preview = previewEncryptedBackup({ envelope, key });
  assert.equal(preview.status, 'VERIFIED_RESTORE_PREVIEW');
  assert.equal(preview.backupId, backupId);
  assert.equal(preview.integrityVerified, true);
  assert.equal(preview.restoreApplied, false);
  assert.equal(preview.canonicalMemoryWrites, 0);
  assert.equal(preview.payloadBytes, payload.length);
  assert.deepEqual(verified.payload, payload);
  console.log('HFM_PHASE7_AUTHENTICATED_RESTORE_PREVIEW_NO_WRITE=PASS');
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

  const {
    uploadEncryptedEmergencyBackup,
    restoreEncryptedEmergencyBackupFromCloud,
    inspectEncryptedEmergencyBackupCapacity,
    planBackupRetention,
    DEFAULT_BACKUP_BUDGET_BYTES
  } = require('../services/mira-hfm-encrypted-emergency-backup-cloud');
  const objects = new Map();
  const adapter = {
    capabilities: { encryptedOnly: true, projectIsolated: true, createOnly: true, readAfterWrite: true },
    async putIfAbsent(input) {
      if (objects.has(input.objectKey)) return { created: false };
      assert.equal(input.contentType, 'application/vnd.mira.hfm-encrypted-backup');
      assert.equal(input.encryption, 'AES-256-GCM');
      assert.equal(input.bytes.includes(payload), false);
      objects.set(input.objectKey, { projectId: input.projectId, backupId: input.backupId, bytes: Buffer.from(input.bytes) });
      return { created: true };
    },
    async get(input) {
      const item = objects.get(input.objectKey);
      if (!item || item.projectId !== input.projectId) return null;
      return { ...item, bytes: Buffer.from(item.bytes) };
    }
  };
  const uploaded = await uploadEncryptedEmergencyBackup({ adapter, projectId: 'mira-project-001', envelope, key });
  assert.equal(uploaded.status, 'ENCRYPTED_CLOUD_BACKUP_VERIFIED');
  assert.equal(uploaded.rootKeyTransmitted, false);
  assert.equal(uploaded.plaintextTransmitted, false);
  assert.equal(objects.size, 1);
  console.log('HFM_PHASE7_ENCRYPTED_CLOUD_UPLOAD_AND_READBACK=PASS');

  const capacityAdapter = {
    capabilities: { ...adapter.capabilities, list: true },
    async list(input) {
      assert.equal(input.projectId, 'mira-project-001');
      assert.equal(input.prefix, 'mira-hfm-emergency/v1/mira-project-001/');
      return [{
        projectId: 'mira-project-001', backupId,
        objectKey: 'mira-hfm-emergency/v1/mira-project-001/' + backupId + '.mhe',
        bytes: envelope.length, createdAt
      }];
    }
  };
  const capacity = await inspectEncryptedEmergencyBackupCapacity({
    adapter: capacityAdapter, projectId: 'mira-project-001',
    retentionPolicy: { keepLast: 1, maxAgeDays: 30 }, now: '2026-11-05T00:00:00.000Z'
  });
  assert.equal(capacity.status, 'WITHIN_BUDGET');
  assert.equal(capacity.budgetBytes, 5000000000);
  assert.equal(capacity.usedBytes, envelope.length);
  assert.equal(capacity.deletionPerformed, false);
  assert.equal(capacity.routineDriveSyncChanged, false);
  assert.equal(capacity.retention.status, 'RETENTION_PREVIEW_ONLY');
  assert.equal(capacity.retention.deletionPerformed, false);
  assert.equal(DEFAULT_BACKUP_BUDGET_BYTES, 5000000000);
  const retention = planBackupRetention({
    projectId: 'mira-project-001',
    backups: [
      { projectId: 'mira-project-001', backupId: 'backup-old-0001', createdAt: '2026-06-01T00:00:00.000Z', bytes: 100 },
      { projectId: 'mira-project-001', backupId: 'backup-new-0001', createdAt: '2026-10-20T00:00:00.000Z', bytes: 200 }
    ],
    keepLast: 1, maxAgeDays: 30, now: '2026-11-05T00:00:00.000Z'
  });
  assert.equal(retention.retained.length, 1);
  assert.equal(retention.candidates.length, 1);
  assert.equal(retention.candidates[0].backupId, 'backup-old-0001');
  assert.equal(retention.deletionPerformed, false);
  await assert.rejects(() => inspectEncryptedEmergencyBackupCapacity({
    adapter: { capabilities: { list: true }, async list() { return [{
      projectId: 'other-project', backupId, objectKey: 'mira-hfm-emergency/v1/other-project/' + backupId + '.mhe',
      bytes: envelope.length, createdAt
    }]; } },
    projectId: 'mira-project-001'
  }), error => error.code === 'HFM_CLOUD_LIST_SCOPE_INVALID');
  console.log('HFM_PHASE7_5GB_CAPACITY_MONITOR_AND_PROJECT_SCOPE=PASS');
  console.log('HFM_PHASE7_RETENTION_PREVIEW_NO_AUTOMATIC_DELETION=PASS');

  await assert.rejects(() => uploadEncryptedEmergencyBackup({ adapter, projectId: 'mira-project-001', envelope, key }),
    error => error.code === 'HFM_CLOUD_BACKUP_CONFLICT');
  const cloudStageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-cloud-restore-test-'));
  try {
    const cloudRestored = await restoreEncryptedEmergencyBackupFromCloud({
      adapter, projectId: 'mira-project-001', backupId, key,
      stagingDirectory: cloudStageDir, restoreId: 'cloud-restore-0001'
    });
    assert.equal(cloudRestored.status, 'VERIFIED_STAGING_ONLY');
    assert.equal(cloudRestored.canonicalMemoryWrites, 0);
    assert.deepEqual(fs.readFileSync(cloudRestored.path), payload);
    console.log('HFM_PHASE7_ENCRYPTED_CLOUD_RESTORE_STAGING=PASS');
  } finally {
    fs.rmSync(cloudStageDir, { recursive: true, force: true });
  }

  await assert.rejects(() => uploadEncryptedEmergencyBackup({
    adapter: { capabilities: { encryptedOnly: true }, putIfAbsent() {}, get() {} },
    projectId: 'mira-project-001', envelope, key
  }), error => error.code === 'HFM_CLOUD_ADAPTER_CAPABILITY_MISSING');
  const badProjectAdapter = {
    ...adapter,
    async get(input) {
      const item = objects.get(input.objectKey);
      return item ? { ...item, projectId: 'other-project', bytes: Buffer.from(item.bytes) } : null;
    }
  };
  await assert.rejects(() => restoreEncryptedEmergencyBackupFromCloud({
    adapter: badProjectAdapter, projectId: 'mira-project-001', backupId, key,
    stagingDirectory: restoreDir, restoreId: 'wrong-project-001'
  }));
  console.log('HFM_PHASE7_CLOUD_CAPABILITY_AND_PROJECT_ISOLATION=PASS');

  const independentVerifier = [
    "const fs = require('node:fs');",
    "const { decryptAndVerifyBackup } = require('./services/mira-hfm-encrypted-emergency-backup');",
    "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
    "const result = decryptAndVerifyBackup(Buffer.from(input.envelope, 'base64'), Buffer.from(input.key, 'base64'));",
    "process.stdout.write(JSON.stringify({ backupId: result.backupId, plaintextSha256: result.plaintextSha256, payloadBytes: result.payload.length }));"
  ].join("\n");
  const independent = spawnSync(process.execPath, ['-e', independentVerifier], {
    cwd: path.resolve(__dirname, '..'),
    input: JSON.stringify({ envelope: envelope.toString('base64'), key: key.toString('base64') }),
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024
  });
  assert.equal(independent.status, 0, independent.stderr);
  const independentResult = JSON.parse(independent.stdout);
  assert.equal(independentResult.backupId, backupId);
  assert.equal(independentResult.plaintextSha256, verified.plaintextSha256);
  assert.equal(independentResult.payloadBytes, payload.length);
  const invalidRestoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-invalid-restore-test-'));
  try {
    await assert.rejects(() => restoreEncryptedEmergencyBackupFromCloud({
      adapter, projectId: 'mira-project-001', backupId, key: crypto.randomBytes(32),
      stagingDirectory: invalidRestoreDir, restoreId: 'wrong-key-restore-001'
    }), error => error.code === 'HFM_BACKUP_AUTH_FAILED');
    assert.deepEqual(fs.readdirSync(invalidRestoreDir), []);
  } finally {
    fs.rmSync(invalidRestoreDir, { recursive: true, force: true });
  }
  console.log('HFM_PHASE7_INDEPENDENT_PROCESS_RECOVERY=PASS');
  console.log('HFM_PHASE7_FAILED_AUTH_NO_RESTORE_ARTIFACT=PASS');


  console.log('HFM_PHASE7_CANONICAL_WRITES=0');
  console.log('HFM_PHASE7_PRODUCTION_RESTORE=0');
  console.log('TESTS_FAILED=0');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
}
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
