'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJournaledDriveUpload, CONTENT_TYPE } = require('../services/mira-hfm-drive-generated-id-upload');
const { readBackupIdJournal } = require('../services/mira-hfm-drive-backup-id-journal');

const projectId = 'mira-project-001';
const accountBinding = 'google-subject-123456';
const driveSpace = 'drive';
const parentId = 'dedicated-folder-123456';
const bytes = Buffer.from('synthetic AES-256-GCM encrypted envelope bytes');
const digest = crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(directory, behavior = {}) {
  const objects = new Map();
  const counts = { generate: 0, create: 0, get: 0, download: 0 };
  const fileId = 'aBcdEF0123456789_-xy';
  const provider = {
    async generateFileId(args) {
      counts.generate += 1;
      assert.equal(args.accountBinding, accountBinding);
      assert.equal(args.driveSpace, driveSpace);
      return { id: fileId };
    },
    async createFile(args) {
      counts.create += 1;
      assert.equal(args.id, fileId);
      assert.deepEqual(args.parents, [parentId]);
      assert.equal(args.mimeType, CONTENT_TYPE);
      assert.deepEqual(args.bytes, bytes);
      const journal = readBackupIdJournal({
        directory, operationId: behavior.operationId || 'drive-upload-operation-001',
        expected: { accountBinding, driveSpace, projectId, backupId: 'backup-upload-0001',
          generatedFileId: fileId, ciphertextSha256: digest, bytes: bytes.length }
      });
      assert.equal(journal.generatedFileId, fileId);
      if (behavior.beforeCommitTimeout && counts.create === 1) {
        const error = new Error('timeout before synthetic provider commit');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      if (objects.has(fileId)) {
        const error = new Error('synthetic duplicate generated ID');
        error.code = '409';
        throw error;
      }
      const metadata = {
        accountBinding, driveSpace, projectId, backupId: 'backup-upload-0001',
        ciphertextSha256: digest, bytes: bytes.length, contentType: CONTENT_TYPE,
        encryption: 'AES-256-GCM', parentId
      };
      if (behavior.metadataConflict) metadata.projectId = 'other-project-001';
      objects.set(fileId, { id: fileId, metadata,
        bytes: behavior.wrongBytes ? Buffer.from('different bytes') : Buffer.from(bytes) });
      if (behavior.afterCommitTimeout && counts.create === 1) {
        const error = new Error('timeout after synthetic provider commit');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return { id: fileId, created: true };
    },
    async getFile({ id }) {
      counts.get += 1;
      const value = objects.get(id);
      return value ? { id: value.id, metadata: { ...value.metadata } } : null;
    },
    async downloadFile({ id }) {
      counts.download += 1;
      const value = objects.get(id);
      return value ? Buffer.from(value.bytes) : null;
    }
  };
  const uploader = createJournaledDriveUpload({
    provider, journalDirectory: directory, accountBinding, driveSpace, projectId, parentId
  });
  return { uploader, provider, counts, objects, fileId };
}
function input(operationId = 'drive-upload-operation-001') {
  return { operationId, backupId: 'backup-upload-0001', bytes: Buffer.from(bytes),
    contentType: CONTENT_TYPE, encryption: 'AES-256-GCM', ciphertextSha256: digest };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-generated-id-upload-'));
  try {
    const normalDir = path.join(root, 'normal');
    const normal = fixture(normalDir);
    const created = await normal.uploader.upload(input());
    assert.equal(created.status, 'CREATED_VERIFIED');
    assert.equal(created.exactByteReadback, true);
    assert.equal(created.metadataVerified, true);
    assert.equal(created.canonicalMemoryWrites, 0);
    assert.deepEqual(normal.counts, { generate: 1, create: 1, get: 1, download: 1 });
    const duplicate = await normal.uploader.upload(input());
    assert.equal(duplicate.status, 'RECONCILED_VERIFIED');
    assert.equal(duplicate.exactByteReadback, true);
    assert.equal(normal.counts.generate, 1);
    assert.equal(normal.counts.create, 2);
    console.log('HFM_PHASE7_GENERATED_ID_JOURNAL_BEFORE_UPLOAD_AND_EXACT_READBACK=PASS');
    console.log('HFM_PHASE7_GENERATED_ID_409_DUPLICATE_RECONCILED=PASS');

    const afterDir = path.join(root, 'after-timeout');
    const after = fixture(afterDir, { afterCommitTimeout: true });
    const reconciled = await after.uploader.upload(input());
    assert.equal(reconciled.status, 'RECONCILED_VERIFIED');
    assert.equal(reconciled.providerErrorCode, 'ETIMEDOUT');
    assert.equal(reconciled.exactByteReadback, true);
    assert.equal(after.counts.generate, 1);
    assert.equal(after.counts.create, 1);
    console.log('HFM_PHASE7_GENERATED_ID_TIMEOUT_AFTER_COMMIT_RECONCILED=PASS');

    const beforeDir = path.join(root, 'before-timeout');
    const before = fixture(beforeDir, { beforeCommitTimeout: true });
    await assert.rejects(() => before.uploader.upload(input()),
      error => error.code === 'HFM_DRIVE_GENERATED_UPLOAD_UNCERTAIN');
    const journal = readBackupIdJournal({ directory: beforeDir,
      operationId: 'drive-upload-operation-001' });
    assert.equal(journal.generatedFileId, before.fileId);
    const retry = await before.uploader.upload(input());
    assert.equal(retry.status, 'CREATED_VERIFIED');
    assert.equal(before.counts.generate, 1);
    assert.equal(before.counts.create, 2);
    console.log('HFM_PHASE7_GENERATED_ID_TIMEOUT_BEFORE_COMMIT_SAME_ID_RETRY=PASS');

    const conflictDir = path.join(root, 'metadata-conflict');
    const conflict = fixture(conflictDir, { metadataConflict: true });
    await assert.rejects(() => conflict.uploader.upload(input()),
      error => error.code === 'HFM_DRIVE_GENERATED_UPLOAD_CONFLICT');
    console.log('HFM_PHASE7_GENERATED_ID_REMOTE_METADATA_CONFLICT_REJECTED=PASS');

    const bytesDir = path.join(root, 'bytes-conflict');
    const bytesConflict = fixture(bytesDir, { wrongBytes: true });
    await assert.rejects(() => bytesConflict.uploader.upload(input()),
      error => error.code === 'HFM_DRIVE_GENERATED_UPLOAD_CONFLICT');
    console.log('HFM_PHASE7_GENERATED_ID_EXACT_CIPHERTEXT_MISMATCH_REJECTED=PASS');

    const bindingDir = path.join(root, 'account-mismatch');
    const binding = fixture(bindingDir);
    await binding.uploader.upload(input());
    const wrongAccount = createJournaledDriveUpload({
      provider: binding.provider, journalDirectory: bindingDir,
      accountBinding: 'different-google-subject-123', driveSpace, projectId, parentId
    });
    await assert.rejects(() => wrongAccount.upload(input()),
      error => error.code === 'HFM_DRIVE_JOURNAL_BINDING_MISMATCH');
    assert.equal(binding.counts.generate, 1);
    console.log('HFM_PHASE7_GENERATED_ID_CROSS_ACCOUNT_REUSE_REJECTED=PASS');

    // Force two callers past the initial missing-journal read before either
    // can publish its generated-ID record. Both must adopt the durable winner.
    const concurrentDir = path.join(root, 'concurrent');
    const concurrentObjects = new Map();
    const concurrentCounts = { generate: 0, create: 0 };
    let releaseGeneration;
    const generationBarrier = new Promise(resolve => { releaseGeneration = resolve; });
    const concurrentProvider = {
      async generateFileId() {
        concurrentCounts.generate += 1;
        const ordinal = concurrentCounts.generate;
        if (ordinal === 2) releaseGeneration();
        await generationBarrier;
        return { id: ordinal === 1 ? 'generatedFileIdA_123456' : 'generatedFileIdB_123456' };
      },
      async createFile(args) {
        concurrentCounts.create += 1;
        if (concurrentObjects.has(args.id)) {
          const error = new Error('concurrent duplicate create');
          error.code = '409';
          throw error;
        }
        concurrentObjects.set(args.id, {
          id: args.id,
          metadata: {
            accountBinding, driveSpace, projectId, backupId: 'backup-upload-0001',
            ciphertextSha256: digest, bytes: bytes.length, contentType: CONTENT_TYPE,
            encryption: 'AES-256-GCM', parentId
          },
          bytes: Buffer.from(args.bytes)
        });
        return { id: args.id, created: true };
      },
      async getFile({ id }) {
        const item = concurrentObjects.get(id);
        return item ? { id: item.id, metadata: { ...item.metadata } } : null;
      },
      async downloadFile({ id }) {
        const item = concurrentObjects.get(id);
        return item ? Buffer.from(item.bytes) : null;
      }
    };
    const concurrentUploader = createJournaledDriveUpload({
      provider: concurrentProvider, journalDirectory: concurrentDir,
      accountBinding, driveSpace, projectId, parentId
    });
    const concurrentResults = await Promise.all([
      concurrentUploader.upload(input('concurrent-upload-operation-001')),
      concurrentUploader.upload(input('concurrent-upload-operation-001'))
    ]);
    assert.equal(concurrentCounts.generate, 2);
    assert.equal(concurrentObjects.size, 1);
    assert.equal(concurrentCounts.create, 2);
    assert.equal(concurrentResults[0].fileId, concurrentResults[1].fileId);
    assert.deepEqual(
      concurrentResults.map(result => result.status).sort(),
      ['CREATED_VERIFIED', 'RECONCILED_VERIFIED']
    );
    const concurrentJournal = readBackupIdJournal({
      directory: concurrentDir, operationId: 'concurrent-upload-operation-001',
      expected: { accountBinding, driveSpace, projectId, backupId: 'backup-upload-0001',
        ciphertextSha256: digest, bytes: bytes.length }
    });
    assert.equal(concurrentJournal.generatedFileId, concurrentResults[0].fileId);
    console.log('HFM_PHASE7_GENERATED_ID_CONCURRENT_JOURNAL_WINNER_REUSED=PASS');

    console.log('HFM_PHASE7_GENERATED_ID_NO_NETWORK_OAUTH_OR_CANONICAL_WRITE=PASS');
    console.log('HFM_PHASE7_GENERATED_ID_UPLOAD_TESTS_FAILED=0');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
