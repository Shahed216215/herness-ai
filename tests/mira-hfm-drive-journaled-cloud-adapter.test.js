'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEncryptedBackup } = require('../services/mira-hfm-encrypted-emergency-backup');
const {
  uploadEncryptedEmergencyBackup,
  previewEncryptedEmergencyBackupFromCloud,
  restoreEncryptedEmergencyBackupFromCloud
} = require('../services/mira-hfm-encrypted-emergency-backup-cloud');
const { createJournaledDriveCloudAdapter } = require('../services/mira-hfm-drive-journaled-cloud-adapter');
const { readBackupIdJournal } = require('../services/mira-hfm-drive-backup-id-journal');

const projectId = 'mira-project-001';
const accountBinding = 'google-subject-123456';
const driveSpace = 'drive';
const parentId = 'dedicated-folder-123456';
const backupId = 'backup-hfm-integration-0001';
const fileId = 'aBcdEF0123456789_-xy';
const key = Buffer.alloc(32, 7);
const payload = Buffer.from('synthetic HFM snapshot payload — private test data');
const envelope = createEncryptedBackup({
  payload, key, backupId, createdAt: '2026-11-05T00:00:00.000Z',
  metadata: { projectId, source: 'synthetic-integration-test' }
});
const digest = crypto.createHash('sha256').update(envelope).digest('hex');
const operationId = 'drive-op-' + crypto.createHash('sha256')
  .update(Buffer.from(projectId + ':' + backupId)).digest('hex').slice(0, 32);

function createProvider(directory) {
  const objects = new Map();
  const calls = { generate: 0, create: 0, get: 0, download: 0 };
  return {
    objects, calls,
    async generateFileId(args) {
      calls.generate += 1;
      assert.equal(args.accountBinding, accountBinding);
      assert.equal(args.driveSpace, driveSpace);
      return { id: fileId };
    },
    async createFile(args) {
      calls.create += 1;
      assert.equal(args.id, fileId);
      assert.deepEqual(args.parents, [parentId]);
      assert.equal(args.mimeType, 'application/vnd.mira.hfm-encrypted-backup');
      assert.deepEqual(args.bytes, envelope);
      assert.equal(args.bytes.includes(payload), false);
      const journal = readBackupIdJournal({ directory, operationId,
        expected: { accountBinding, driveSpace, projectId, backupId,
          generatedFileId: fileId, ciphertextSha256: digest, bytes: envelope.length } });
      assert.equal(journal.generatedFileId, fileId);
      if (objects.has(fileId)) {
        const error = new Error('synthetic Drive 409 duplicate ID');
        error.code = '409';
        throw error;
      }
      objects.set(fileId, {
        id: fileId,
        metadata: {
          accountBinding, driveSpace, projectId, backupId,
          ciphertextSha256: args.appProperties.ciphertextSha256,
          bytes: Number(args.appProperties.bytes),
          contentType: args.mimeType, encryption: args.appProperties.encryption,
          parentId: args.parents[0]
        },
        bytes: Buffer.from(args.bytes)
      });
      return { id: fileId, created: true };
    },
    async getFile({ id, accountBinding: account, driveSpace: space }) {
      calls.get += 1;
      assert.equal(account, accountBinding);
      assert.equal(space, driveSpace);
      const object = objects.get(id);
      return object ? { id: object.id, metadata: { ...object.metadata } } : null;
    },
    async downloadFile({ id }) {
      calls.download += 1;
      const object = objects.get(id);
      return object ? Buffer.from(object.bytes) : null;
    }
  };
}

// Synthetic injected-provider integration only; this suite must never create an OAuth or network client.
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-journaled-cloud-integration-'));
  const journalDirectory = path.join(root, 'journal');
  const stagingDirectory = path.join(root, 'staging');
  try {
    const provider = createProvider(journalDirectory);
    const adapter = createJournaledDriveCloudAdapter({
      provider, journalDirectory, accountBinding, driveSpace, projectId, parentId
    });
    const uploaded = await uploadEncryptedEmergencyBackup({
      adapter, projectId, envelope, key, expectedBackupId: backupId
    });
    assert.equal(uploaded.status, 'ENCRYPTED_CLOUD_BACKUP_VERIFIED');
    assert.equal(uploaded.rootKeyTransmitted, false);
    assert.equal(uploaded.plaintextTransmitted, false);
    assert.equal(provider.calls.generate, 1);
    assert.equal(provider.calls.create, 1);
    console.log('HFM_PHASE7_JOURNALED_CLOUD_END_TO_END_ENCRYPTED_UPLOAD=PASS');

    const repeated = await uploadEncryptedEmergencyBackup({
      adapter, projectId, envelope, key, expectedBackupId: backupId
    });
    assert.equal(repeated.status, 'ENCRYPTED_CLOUD_BACKUP_VERIFIED');
    assert.equal(provider.calls.generate, 1);
    assert.equal(provider.calls.create, 2);
    console.log('HFM_PHASE7_JOURNALED_CLOUD_IDEMPOTENT_409_RETRY=PASS');

    const preview = await previewEncryptedEmergencyBackupFromCloud({
      adapter, projectId, backupId, key
    });
    assert.equal(preview.status, 'VERIFIED_RESTORE_PREVIEW');
    assert.equal(preview.restoreApplied, false);
    assert.equal(preview.canonicalMemoryWrites, 0);
    console.log('HFM_PHASE7_JOURNALED_CLOUD_AUTHENTICATED_PREVIEW=PASS');

    const restored = await restoreEncryptedEmergencyBackupFromCloud({
      adapter, projectId, backupId, key, stagingDirectory,
      restoreId: 'hfm-restore-integration-0001'
    });
    assert.equal(restored.status, 'VERIFIED_STAGING_ONLY');
    assert.equal(restored.canonicalMemoryWrites, 0);
    assert.deepEqual(fs.readFileSync(restored.path), payload);
    console.log('HFM_PHASE7_JOURNALED_CLOUD_RESTORE_STAGING_ONLY=PASS');

    await assert.rejects(() => adapter.get({
      projectId: 'other-project-001',
      objectKey: 'mira-hfm-emergency/v1/other-project-001/' + backupId + '.mhe'
    }), error => error.code === 'HFM_DRIVE_PROJECT_SCOPE');
    console.log('HFM_PHASE7_JOURNALED_CLOUD_PROJECT_ISOLATION=PASS');

    assert.equal(provider.calls.generate, 1);
    console.log('HFM_PHASE7_JOURNALED_CLOUD_NO_NETWORK_OAUTH_OR_CANONICAL_WRITE=PASS');
    console.log('HFM_PHASE7_JOURNALED_CLOUD_INTEGRATION_TESTS_FAILED=0');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
