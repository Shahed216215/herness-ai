'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createBackupIdJournal, readBackupIdJournal, reconcileBackupIdJournal
} = require('../services/mira-hfm-drive-backup-id-journal');

function base(overrides = {}) {
  return {
    operationId: 'drive-operation-0001',
    accountBinding: 'google-subject-123456',
    driveSpace: 'drive',
    projectId: 'mira-project-001',
    backupId: 'backup-journal-0001',
    generatedFileId: 'aBcdEF0123456789_-xy',
    ciphertextSha256: 'a'.repeat(64),
    bytes: 4096,
    createdAt: '2026-11-05T00:00:00.000Z',
    ...overrides
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-drive-journal-'));
  const directory = path.join(root, 'journal');
  try {
    const input = base();
    const first = createBackupIdJournal({ directory, ...input });
    assert.equal(first.created, true);
    assert.equal(fs.statSync(first.journalPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    const read = readBackupIdJournal({ directory, operationId: input.operationId });
    assert.equal(read.generatedFileId, input.generatedFileId);
    assert.equal(read.ciphertextSha256, input.ciphertextSha256);
    assert.equal(read.accountBinding, input.accountBinding);
    console.log('HFM_PHASE7_ID_JOURNAL_CREATE_DURABLE_READBACK=PASS');

    const repeated = createBackupIdJournal({ directory, ...input });
    assert.equal(repeated.created, false);
    assert.equal(repeated.generatedFileId, input.generatedFileId);
    const recovered = reconcileBackupIdJournal({
      directory, operationId: input.operationId,
      expected: { accountBinding: input.accountBinding, driveSpace: input.driveSpace,
        projectId: input.projectId, backupId: input.backupId,
        ciphertextSha256: input.ciphertextSha256, bytes: input.bytes }
    });
    assert.equal(recovered.status, 'JOURNAL_VERIFIED_PROVIDER_RECONCILIATION_REQUIRED');
    assert.equal(recovered.generatedFileId, input.generatedFileId);
    assert.equal(recovered.providerRetryAllowedOnlyWithSameFileId, true);
    assert.equal(recovered.providerObjectVerified, false);
    assert.equal(recovered.uploadConfirmed, false);
    assert.equal(recovered.canonicalMemoryWrites, 0);
    console.log('HFM_PHASE7_ID_JOURNAL_RESTART_RECOVERY_SAME_ID_ONLY=PASS');

    await assert.rejects(() => createBackupIdJournal({
      directory, ...input, generatedFileId: 'differentFileId_123456'
    }), error => error.code === 'HFM_DRIVE_JOURNAL_CONFLICT');
    await assert.rejects(() => readBackupIdJournal({
      directory, operationId: input.operationId,
      expected: { accountBinding: 'different-subject-123' }
    }), error => error.code === 'HFM_DRIVE_JOURNAL_BINDING_MISMATCH');
    await assert.rejects(() => readBackupIdJournal({
      directory, operationId: input.operationId,
      expected: { driveSpace: 'appDataFolder' }
    }), error => error.code === 'HFM_DRIVE_JOURNAL_BINDING_MISMATCH');
    console.log('HFM_PHASE7_ID_JOURNAL_IMMUTABLE_ID_AND_ACCOUNT_SPACE_BINDING=PASS');

    const missing = path.join(root, 'missing');
    await assert.rejects(() => readBackupIdJournal({
      directory: missing, operationId: input.operationId
    }), error => error.code === 'HFM_DRIVE_JOURNAL_MISSING');
    console.log('HFM_PHASE7_ID_JOURNAL_MISSING_FAIL_CLOSED=PASS');

    const corruptDir = path.join(root, 'corrupt');
    const corrupt = createBackupIdJournal({
      directory: corruptDir, ...base({ operationId: 'drive-operation-corrupt' })
    });
    fs.writeFileSync(corrupt.journalPath, '{not-json}\n', { mode: 0o600 });
    await assert.rejects(() => readBackupIdJournal({
      directory: corruptDir, operationId: 'drive-operation-corrupt'
    }), error => error.code === 'HFM_DRIVE_JOURNAL_CORRUPT');
    console.log('HFM_PHASE7_ID_JOURNAL_CORRUPTION_FAIL_CLOSED=PASS');

    const symlinkDir = path.join(root, 'symlink-dir');
    fs.symlinkSync(directory, symlinkDir, 'dir');
    await assert.rejects(() => readBackupIdJournal({
      directory: symlinkDir, operationId: input.operationId
    }), error => error.code === 'HFM_DRIVE_JOURNAL_INVALID');
    console.log('HFM_PHASE7_ID_JOURNAL_DIRECTORY_SYMLINK_REJECTED=PASS');

    const linkDir = path.join(root, 'file-link');
    fs.mkdirSync(linkDir, { mode: 0o700 });
    const target = path.join(root, 'outside-record');
    fs.writeFileSync(target, 'outside', { mode: 0o600 });
    fs.symlinkSync(target, path.join(linkDir, 'drive-backup-operation-drive-operation-0001.json'));
    await assert.rejects(() => readBackupIdJournal({
      directory: linkDir, operationId: input.operationId
    }), error => error.code === 'HFM_DRIVE_JOURNAL_PERMISSIONS');
    console.log('HFM_PHASE7_ID_JOURNAL_FILE_SYMLINK_REJECTED=PASS');

    await assert.rejects(() => createBackupIdJournal({
      directory: path.join(root, 'bad-input'),
      ...base({ generatedFileId: '../unsafe' })
    }), error => error.code === 'HFM_DRIVE_JOURNAL_INVALID');
    await assert.rejects(() => createBackupIdJournal({
      directory: path.join(root, 'bad-account'),
      ...base({ accountBinding: 'shahed@example.com\nforged' })
    }), error => error.code === 'HFM_DRIVE_JOURNAL_INVALID');
    console.log('HFM_PHASE7_ID_JOURNAL_INPUT_VALIDATION=PASS');
    console.log('HFM_PHASE7_ID_JOURNAL_NO_NETWORK_OAUTH_OR_CANONICAL_WRITE=PASS');
    console.log('HFM_PHASE7_ID_JOURNAL_TESTS_FAILED=0');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
