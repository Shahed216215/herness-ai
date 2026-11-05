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
const metadata = { projectId: 'mira-project-001', source: 'synthetic-offline-test' };
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

  const stored = writeImmutableBackup({ envelope, key, directory: dir, backupId });
  assert.equal(fs.readFileSync(stored.path).toString('utf8'), envelope.toString('utf8'));
  const invalidLocalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-invalid-local-backup-test-'));
  try {
    assert.throws(() => writeImmutableBackup({
      envelope, key: crypto.randomBytes(32), directory: invalidLocalDir, backupId
    }), error => error.code === 'HFM_BACKUP_AUTH_FAILED');
    assert.deepEqual(fs.readdirSync(invalidLocalDir), []);
  } finally {
    fs.rmSync(invalidLocalDir, { recursive: true, force: true });
  }
  console.log('HFM_PHASE7_LOCAL_WRITE_REQUIRES_AUTHENTICATED_ENVELOPE=PASS');
  assert.throws(() => writeImmutableBackup({ envelope, key, directory: dir, backupId }), error => error.code === 'EEXIST');
  console.log('HFM_PHASE7_IMMUTABLE_BACKUP_AND_READBACK=PASS');

  const staged = restoreToStaging({ envelope, key, directory: restoreDir, restoreId: 'restore-test-0001' });
  assert.equal(staged.status, 'VERIFIED_STAGING_ONLY');
  assert.equal(staged.canonicalMemoryWrites, 0);
  assert.equal(staged.productionRestore, false);
  assert.deepEqual(fs.readFileSync(staged.path), payload);
  assert.throws(() => restoreToStaging({ envelope, key, directory: restoreDir, restoreId: 'restore-test-0001' }), error => error.code === 'EEXIST');
  console.log('HFM_PHASE7_RESTORE_STAGING_ONLY=PASS');

  const invalidLocalStageAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-invalid-restore-stage-test-'));
  try {
    assert.throws(() => restoreToStaging({
      envelope, key: crypto.randomBytes(32), directory: invalidLocalStageAuthDir,
      restoreId: 'restore-wrong-key-001'
    }), error => error.code === 'HFM_BACKUP_AUTH_FAILED');
    assert.deepEqual(fs.readdirSync(invalidLocalStageAuthDir), []);
  } finally {
    fs.rmSync(invalidLocalStageAuthDir, { recursive: true, force: true });
  }
  console.log('HFM_PHASE7_RESTORE_AUTH_FAILURE_NO_STAGE_ARTIFACT=PASS');

  const {
    uploadEncryptedEmergencyBackup,
    previewEncryptedEmergencyBackupFromCloud,
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

  const crossProjectBackupId = 'backup-cross-project-001';
  const crossProjectEnvelope = createEncryptedBackup({
    payload, key, backupId: crossProjectBackupId, createdAt,
    metadata: { projectId: 'other-project-001', source: 'synthetic-cross-project-test' }
  });
  await assert.rejects(() => uploadEncryptedEmergencyBackup({
    adapter, projectId: 'mira-project-001', envelope: crossProjectEnvelope, key
  }), error => error.code === 'HFM_CLOUD_BACKUP_PROJECT_MISMATCH');
  const crossProjectObjectKey = 'mira-hfm-emergency/v1/mira-project-001/' + crossProjectBackupId + '.mhe';
  objects.set(crossProjectObjectKey, {
    projectId: 'mira-project-001', backupId: crossProjectBackupId,
    bytes: Buffer.from(crossProjectEnvelope)
  });
  await assert.rejects(() => previewEncryptedEmergencyBackupFromCloud({
    adapter, projectId: 'mira-project-001', backupId: crossProjectBackupId, key
  }), error => error.code === 'HFM_CLOUD_BACKUP_PROJECT_MISMATCH');
  const crossProjectRestoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-cross-project-restore-test-'));
  try {
    await assert.rejects(() => restoreEncryptedEmergencyBackupFromCloud({
      adapter, projectId: 'mira-project-001', backupId: crossProjectBackupId, key,
      stagingDirectory: crossProjectRestoreDir, restoreId: 'cross-project-restore-001'
    }), error => error.code === 'HFM_CLOUD_BACKUP_PROJECT_MISMATCH');
    assert.deepEqual(fs.readdirSync(crossProjectRestoreDir), []);
  } finally {
    fs.rmSync(crossProjectRestoreDir, { recursive: true, force: true });
  }
  console.log('HFM_PHASE7_AUTHENTICATED_CLOUD_PROJECT_BINDING=PASS');

  const capacityAdapter = {
    capabilities: { ...adapter.capabilities, list: true },
    async getProviderQuota() {
      return { status: 'REPORTED', providerQuotaAvailable: true, providerId: 'synthetic-drive',
        scope: 'account', projectId: null, measuredAt: '2026-11-05T00:00:00.000Z',
        quotaBytes: 9000000000, usedBytes: 2000000000, availableBytes: 7000000000 };
    },
    async list(input) {
      assert.equal(input.projectId, 'mira-project-001');
      assert.equal(input.prefix, 'mira-hfm-emergency/v1/mira-project-001/');
      assert.equal(input.limit, 500);
      if (input.cursor === null) return {
        items: [{
          projectId: 'mira-project-001', backupId: 'backup-page-0001',
          objectKey: 'mira-hfm-emergency/v1/mira-project-001/backup-page-0001.mhe',
          bytes: 100, createdAt
        }],
        complete: false, nextCursor: 'page-2'
      };
      assert.equal(input.cursor, 'page-2');
      return {
        items: [{
          projectId: 'mira-project-001', backupId,
          objectKey: 'mira-hfm-emergency/v1/mira-project-001/' + backupId + '.mhe',
          bytes: envelope.length, createdAt
        }],
        complete: true
      };
    }
  };
  const capacity = await inspectEncryptedEmergencyBackupCapacity({
    adapter: capacityAdapter, projectId: 'mira-project-001',
    retentionPolicy: { keepLast: 1, maxAgeDays: 30 }, now: '2026-11-05T00:00:00.000Z'
  });
  assert.equal(capacity.status, 'WITHIN_BUDGET');
  assert.equal(capacity.budgetBytes, 5000000000);
  assert.equal(capacity.budgetSource, 'HFM_CONFIGURED_PROJECT_EMERGENCY_BUDGET');
  assert.equal(capacity.providerQuota.status, 'REPORTED');
  assert.equal(capacity.providerQuota.scope, 'account');
  assert.equal(capacity.providerQuota.quotaBytes, 9000000000);
  assert.equal(capacity.usedBytes, envelope.length + 100);
  assert.equal(capacity.backupCount, 2);
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
    adapter: { capabilities: { list: true }, async list() { return { items: [{
      projectId: 'other-project', backupId, objectKey: 'mira-hfm-emergency/v1/other-project/' + backupId + '.mhe',
      bytes: envelope.length, createdAt
    }], complete: true }; } },
    projectId: 'mira-project-001'
  }), error => error.code === 'HFM_CLOUD_LIST_SCOPE_INVALID');
  await assert.rejects(() => inspectEncryptedEmergencyBackupCapacity({
    adapter: { capabilities: { list: true }, async list() {
      return { items: [], complete: false, nextCursor: 'same-cursor' };
    } },
    projectId: 'mira-project-001'
  }), error => error.code === 'HFM_CLOUD_LIST_INCOMPLETE');
  await assert.rejects(() => inspectEncryptedEmergencyBackupCapacity({
    adapter: { capabilities: { list: true }, async list() {
      return { items: [], complete: false, nextCursor: 'repeat-me' };
    } },
    projectId: 'mira-project-001'
  }), error => error.code === 'HFM_CLOUD_LIST_INCOMPLETE');
  await assert.rejects(() => inspectEncryptedEmergencyBackupCapacity({
    adapter: { capabilities: { list: true }, async getProviderQuota() {
      return { status: 'REPORTED', providerQuotaAvailable: true };
    }, async list() { return { items: [], complete: true }; } },
    projectId: 'mira-project-001', now: '2026-11-05T00:00:00.000Z'
  }), error => error.code === 'HFM_CLOUD_PROVIDER_QUOTA_INVALID');
  await assert.rejects(() => inspectEncryptedEmergencyBackupCapacity({
    adapter: { capabilities: { list: true }, async getProviderQuota() {
      return { status: 'REPORTED', providerQuotaAvailable: true, providerId: 'synthetic-drive',
        scope: 'account', projectId: null, measuredAt: '2026-11-06T00:00:00.000Z',
        quotaBytes: 1000, usedBytes: 100, availableBytes: 900 };
    }, async list() { return { items: [], complete: true }; } },
    projectId: 'mira-project-001', now: '2026-11-05T00:00:00.000Z'
  }), error => error.code === 'HFM_CLOUD_PROVIDER_QUOTA_INVALID');
  await assert.rejects(() => inspectEncryptedEmergencyBackupCapacity({
    adapter: { capabilities: { list: true }, async list() { return { items: [{
      projectId: 'mira-project-001', backupId: 'backup-invalid-time',
      objectKey: 'mira-hfm-emergency/v1/mira-project-001/backup-invalid-time.mhe',
      bytes: 12, createdAt: 'not-a-date'
    }], complete: true }; } },
    projectId: 'mira-project-001', now: '2026-11-05T00:00:00.000Z'
  }), error => error.code === 'HFM_CLOUD_LIST_TIMESTAMP_INVALID');
  await assert.rejects(() => inspectEncryptedEmergencyBackupCapacity({
    adapter: { capabilities: { list: true }, async list() { return { items: [{
      projectId: 'mira-project-001', backupId: 'backup-future-time',
      objectKey: 'mira-hfm-emergency/v1/mira-project-001/backup-future-time.mhe',
      bytes: 12, createdAt: '2026-11-06T00:00:00.000Z'
    }], complete: true }; } },
    projectId: 'mira-project-001', now: '2026-11-05T00:00:00.000Z'
  }), error => error.code === 'HFM_CLOUD_LIST_TIMESTAMP_INVALID');
  console.log('HFM_PHASE7_PROVIDER_QUOTA_REPORT_SCHEMA_ENFORCED=PASS');
  console.log('HFM_PHASE7_FUTURE_PROVIDER_QUOTA_REJECTED=PASS');
  console.log('HFM_PHASE7_CAPACITY_LIST_TIMESTAMP_VALIDATED=PASS');
  console.log('HFM_PHASE7_FUTURE_BACKUP_TIMESTAMP_REJECTED=PASS');
  console.log('HFM_PHASE7_PAGINATION_COMPLETE_AND_INCOMPLETE_REJECTED=PASS');
  console.log('HFM_PHASE7_5GB_CAPACITY_MONITOR_AND_PROJECT_SCOPE=PASS');
  console.log('HFM_PHASE7_CONFIGURED_BUDGET_DISTINCT_FROM_PROVIDER_QUOTA=PASS');
  console.log('HFM_PHASE7_RETENTION_PREVIEW_NO_AUTOMATIC_DELETION=PASS');

  await assert.rejects(() => uploadEncryptedEmergencyBackup({ adapter, projectId: 'mira-project-001', envelope, key }),
    error => error.code === 'HFM_CLOUD_BACKUP_CONFLICT');
  const cloudPreview = await previewEncryptedEmergencyBackupFromCloud({
    adapter, projectId: 'mira-project-001', backupId, key
  });
  assert.equal(cloudPreview.status, 'VERIFIED_RESTORE_PREVIEW');
  assert.equal(cloudPreview.source, 'ENCRYPTED_CLOUD_OBJECT');
  assert.equal(cloudPreview.restoreApplied, false);
  assert.equal(cloudPreview.canonicalMemoryWrites, 0);
  console.log('HFM_PHASE7_CLOUD_RESTORE_PREVIEW_NO_WRITE=PASS');

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
  const invalidLocalRestoreStageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-invalid-restore-test-'));
  try {
    await assert.rejects(() => restoreEncryptedEmergencyBackupFromCloud({
      adapter, projectId: 'mira-project-001', backupId, key: crypto.randomBytes(32),
      stagingDirectory: invalidLocalRestoreStageDir, restoreId: 'wrong-key-restore-001'
    }), error => error.code === 'HFM_BACKUP_AUTH_FAILED');
    assert.deepEqual(fs.readdirSync(invalidLocalRestoreStageDir), []);
  } finally {
    fs.rmSync(invalidLocalRestoreStageDir, { recursive: true, force: true });
  }
  console.log('HFM_PHASE7_INDEPENDENT_PROCESS_RECOVERY=PASS');
  console.log('HFM_PHASE7_FAILED_AUTH_NO_RESTORE_ARTIFACT=PASS');


  const {
    withBackupKey,
    createEncryptedBackupWithKeyProvider,
    decryptBackupWithKeyProvider,
    assertKeyVersionRetirementAllowed
  } = require('../services/mira-hfm-backup-key-provider');
  const keyVersions = new Map([
    ['key-version-A', Buffer.alloc(32, 0x41)],
    ['key-version-B', Buffer.alloc(32, 0x42)]
  ]);
  const fakeKeyProvider = {
    async getKey({ keyId }) {
      if (!keyVersions.has(keyId)) {
        const error = new Error('provider-private-detail-must-not-leak');
        error.code = 'KEY_NOT_FOUND';
        throw error;
      }
      return { keyId, key: Buffer.from(keyVersions.get(keyId)) };
    }
  };
  const versionAPayload = Buffer.from('synthetic historical backup encrypted with key version A');
  const versionAEnvelope = await createEncryptedBackupWithKeyProvider({
    provider: fakeKeyProvider, keyId: 'key-version-A',
    payload: versionAPayload, backupId: 'backup-keyver-A-001',
    createdAt, metadata: { projectId: 'mira-hfm-v02' }
  });
  const versionAHeader = JSON.parse(versionAEnvelope.toString('utf8'));
  assert.equal(versionAHeader.metadata.keyVersionId, 'key-version-A');
  const versionBEnvelope = await createEncryptedBackupWithKeyProvider({
    provider: fakeKeyProvider, keyId: 'key-version-B',
    payload: Buffer.from('synthetic new backup encrypted with key version B'),
    backupId: 'backup-keyver-B-001', createdAt,
    metadata: { projectId: 'mira-hfm-v02' }
  });
  assert.equal(JSON.parse(versionBEnvelope.toString('utf8')).metadata.keyVersionId, 'key-version-B');
  const historicalA = await decryptBackupWithKeyProvider({
    provider: fakeKeyProvider, envelope: versionAEnvelope
  });
  assert.deepEqual(historicalA.payload, versionAPayload);
  assert.equal(historicalA.metadata.keyVersionId, 'key-version-A');
  const currentB = await decryptBackupWithKeyProvider({
    provider: fakeKeyProvider, envelope: versionBEnvelope
  });
  assert.equal(currentB.metadata.keyVersionId, 'key-version-B');
  console.log('HFM_PHASE7_KEY_VERSION_A_B_HISTORICAL_DECRYPTION=PASS');

  let ephemeralReference;
  const providerOwnedKey = Buffer.alloc(32, 0x51);
  const ephemeralResult = await withBackupKey({
    provider: { async getKey({ keyId }) { return { keyId, key: providerOwnedKey }; } },
    keyId: 'key-version-C',
    operation: keyMaterial => {
      ephemeralReference = keyMaterial;
      assert.equal(keyMaterial.length, 32);
      assert.equal(keyMaterial.equals(providerOwnedKey), true);
      return 'operation-complete';
    }
  });
  assert.equal(ephemeralResult, 'operation-complete');
  assert.equal(ephemeralReference.every(byte => byte === 0), true);
  assert.equal(providerOwnedKey.every(byte => byte === 0x51), true);
  console.log('HFM_PHASE7_EPHEMERAL_KEY_COPY_ZEROIZED=PASS');

  const providerFailures = [
    ['KEY_NOT_FOUND', 'HFM_KEY_NOT_FOUND'],
    ['KEY_ACCESS_DENIED', 'HFM_KEY_ACCESS_DENIED'],
    ['KEY_VERSION_RETIRED', 'HFM_KEY_VERSION_RETIRED'],
    ['PROVIDER_UNAVAILABLE', 'HFM_PROVIDER_UNAVAILABLE'],
    ['INVALID_KEY_MATERIAL', 'HFM_INVALID_KEY_MATERIAL']
  ];
  for (const [providerCode, expectedCode] of providerFailures) {
    const failingProvider = {
      async getKey() {
        if (providerCode === 'INVALID_KEY_MATERIAL') return { keyId: 'key-version-D', key: Buffer.alloc(16) };
        const error = new Error('sensitive-provider-error-detail');
        error.code = providerCode;
        throw error;
      }
    };
    await assert.rejects(() => withBackupKey({
      provider: failingProvider, keyId: 'key-version-D', operation: () => true
    }), error => error.code === expectedCode &&
      !error.message.includes('sensitive-provider-error-detail'));
  }
  await assert.rejects(() => withBackupKey({
    provider: { async getKey() { return { keyId: 'another-key-version', key: Buffer.alloc(32) }; } },
    keyId: 'key-version-D', operation: () => true
  }), error => error.code === 'HFM_INVALID_KEY_MATERIAL');
  console.log('HFM_PHASE7_KEY_PROVIDER_FAILURE_TAXONOMY=PASS');

  assert.throws(() => assertKeyVersionRetirementAllowed({
    referencedBackupCount: 1, migrationVerified: false, recoveryVerified: false
  }), error => error.code === 'HFM_KEY_VERSION_IN_USE');
  assert.throws(() => assertKeyVersionRetirementAllowed({
    referencedBackupCount: 1, migrationVerified: true, recoveryVerified: false
  }), error => error.code === 'HFM_KEY_VERSION_IN_USE');
  assert.equal(assertKeyVersionRetirementAllowed({
    referencedBackupCount: 1, migrationVerified: true, recoveryVerified: true
  }).allowed, true);
  assert.equal(assertKeyVersionRetirementAllowed({
    referencedBackupCount: 0
  }).allowed, true);
  console.log('HFM_PHASE7_KEY_RETIREMENT_EVIDENCE_GATE=PASS');

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
