'use strict';

// Provider-injected, offline-testable orchestration for a pre-generated Drive ID.
// No Google SDK, OAuth, credentials, network, or canonical Memory writes live here.
const crypto = require('node:crypto');
const {
  createBackupIdJournal, readBackupIdJournal
} = require('./mira-hfm-drive-backup-id-journal');

const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/;
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;
const CONTENT_TYPE = 'application/vnd.mira.hfm-encrypted-backup';

function reject(message, code = 'HFM_DRIVE_GENERATED_UPLOAD_REJECTED') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function validText(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max ||
      /[\r\n\u0000-\u001f]/.test(value)) reject(label + ' is invalid.');
  return value;
}
function validateFileId(value) {
  if (typeof value !== 'string' || !DRIVE_FILE_ID_RE.test(value)) {
    reject('Provider-generated Drive file ID is invalid.', 'HFM_DRIVE_GENERATED_ID_INVALID');
  }
  return value;
}
function createJournaledDriveUpload({ provider, journalDirectory, accountBinding,
  driveSpace, projectId, parentId } = {}) {
  const account = validText(accountBinding, 'accountBinding', 160);
  const project = validText(projectId, 'projectId', 96);
  const parent = validText(parentId, 'parentId', 256);
  if (!['drive', 'appDataFolder'].includes(driveSpace)) reject('driveSpace is unsupported.');
  if (!provider || typeof provider.generateFileId !== 'function' ||
      typeof provider.createFile !== 'function' || typeof provider.getFile !== 'function' ||
      typeof provider.downloadFile !== 'function') {
    reject('Provider must implement generateFileId, createFile, getFile and downloadFile.');
  }

  async function upload(input = {}) {
    const operationId = validText(input.operationId, 'operationId', 96);
    const backupId = validText(input.backupId, 'backupId', 96);
    const bytes = Buffer.isBuffer(input.bytes) ? Buffer.from(input.bytes) : null;
    if (!bytes || bytes.length < 1 || bytes.length > MAX_OBJECT_BYTES) {
      reject('Only bounded encrypted backup bytes are accepted.');
    }
    const digest = sha256(bytes);
    if (input.ciphertextSha256 !== digest ||
        input.contentType !== CONTENT_TYPE || input.encryption !== 'AES-256-GCM') {
      reject('Upload must be bound to the encrypted envelope content type, algorithm and digest.');
    }

    let journal;
    const journalBinding = {
      accountBinding: account, driveSpace, projectId: project,
      backupId, ciphertextSha256: digest, bytes: bytes.length
    };
    try {
      journal = readBackupIdJournal({
        directory: journalDirectory, operationId,
        expected: journalBinding
      });
    } catch (error) {
      if (error.code !== 'HFM_DRIVE_JOURNAL_MISSING') throw error;
      let generated;
      try { generated = await provider.generateFileId({ accountBinding: account, driveSpace }); }
      catch (_) { reject('Drive ID generation failed; no upload was attempted.',
        'HFM_DRIVE_ID_GENERATION_FAILED'); }
      const generatedFileId = validateFileId(generated && generated.id);
      try {
        journal = createBackupIdJournal({
          directory: journalDirectory, operationId, accountBinding: account, driveSpace,
          projectId: project, backupId, generatedFileId,
          ciphertextSha256: digest, bytes: bytes.length
        });
      } catch (journalError) {
        // Another concurrent request may have won the create-only journal link
        // with a different generated ID. Adopt only the durable winner after
        // re-reading and validating every operation/content binding.
        if (journalError.code !== 'HFM_DRIVE_JOURNAL_CONFLICT') throw journalError;
        journal = readBackupIdJournal({
          directory: journalDirectory, operationId,
          expected: journalBinding
        });
      }
    }

    const fileId = validateFileId(journal.generatedFileId);
    const metadata = Object.freeze({
      accountBinding: account, driveSpace, projectId: project, backupId,
      ciphertextSha256: digest, bytes: bytes.length, contentType: CONTENT_TYPE,
      encryption: 'AES-256-GCM', parentId: parent
    });
    let createResponse;
    let createError = null;
    try {
      createResponse = await provider.createFile({
        id: fileId, parents: [parent], appProperties: {
          projectId: project, backupId, ciphertextSha256: digest,
          bytes: String(bytes.length), encryption: 'AES-256-GCM'
        },
        mimeType: CONTENT_TYPE, bytes: Buffer.from(bytes),
        accountBinding: account, driveSpace
      });
    } catch (error) {
      createError = error;
    }

    let remote;
    try { remote = await provider.getFile({ id: fileId, accountBinding: account, driveSpace }); }
    catch (_) { reject('Exact-ID metadata readback failed; journal retained for recovery.',
      'HFM_DRIVE_GENERATED_UPLOAD_UNCERTAIN'); }
    if (!remote) reject('Exact-ID object is not yet visible; journal retained and same-ID retry is required.',
      'HFM_DRIVE_GENERATED_UPLOAD_UNCERTAIN');

    const remoteMetadata = remote.metadata || {};
    const metadataMatches = remote.id === fileId &&
      remoteMetadata.accountBinding === metadata.accountBinding &&
      remoteMetadata.driveSpace === metadata.driveSpace &&
      remoteMetadata.projectId === metadata.projectId &&
      remoteMetadata.backupId === metadata.backupId &&
      remoteMetadata.ciphertextSha256 === metadata.ciphertextSha256 &&
      remoteMetadata.bytes === metadata.bytes &&
      remoteMetadata.contentType === metadata.contentType &&
      remoteMetadata.encryption === metadata.encryption &&
      remoteMetadata.parentId === metadata.parentId;
    if (!metadataMatches) reject('Remote Drive object metadata conflicts with the durable journal.',
      'HFM_DRIVE_GENERATED_UPLOAD_CONFLICT');

    let downloaded;
    try { downloaded = await provider.downloadFile({ id: fileId, accountBinding: account, driveSpace }); }
    catch (_) { reject('Exact-ID ciphertext download failed; journal retained for recovery.',
      'HFM_DRIVE_GENERATED_UPLOAD_UNCERTAIN'); }
    if (!Buffer.isBuffer(downloaded) || !downloaded.equals(bytes) || sha256(downloaded) !== digest) {
      reject('Remote ciphertext differs from the journal-bound upload bytes.',
        'HFM_DRIVE_GENERATED_UPLOAD_CONFLICT');
    }
    const responseIdMatches = !createResponse || createResponse.id === undefined ||
      createResponse.id === fileId;
    if (!responseIdMatches) reject('Provider create response returned a different file ID.',
      'HFM_DRIVE_GENERATED_UPLOAD_CONFLICT');

    return Object.freeze({
      status: createError || !createResponse || createResponse.created !== true
        ? 'RECONCILED_VERIFIED' : 'CREATED_VERIFIED',
      operationId, fileId, projectId: project, backupId,
      ciphertextSha256: digest, bytes: bytes.length,
      exactByteReadback: true, metadataVerified: true,
      providerErrorCode: createError && typeof createError.code === 'string' ? createError.code : null,
      journalRetained: true, canonicalMemoryWrites: 0
    });
  }

  return Object.freeze({ upload });
}
module.exports = { createJournaledDriveUpload, CONTENT_TYPE, MAX_OBJECT_BYTES };
