'use strict';

// Cloud-service adapter around a provider-injected, journaled generated-ID uploader.
// This is offline-testable orchestration, not a Google SDK or OAuth implementation.
const crypto = require('node:crypto');
const {
  createJournaledDriveUpload, CONTENT_TYPE
} = require('./mira-hfm-drive-generated-id-upload');
const { readBackupIdJournal } = require('./mira-hfm-drive-backup-id-journal');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
function reject(message, code = 'HFM_DRIVE_JOURNALED_ADAPTER_REJECTED') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) reject(label + ' is invalid.');
  return value;
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function createJournaledDriveCloudAdapter({ provider, journalDirectory, accountBinding,
  driveSpace, projectId, parentId } = {}) {
  const project = validId(projectId, 'projectId');
  const uploader = createJournaledDriveUpload({
    provider, journalDirectory, accountBinding, driveSpace, projectId: project, parentId
  });
  const prefix = 'mira-hfm-emergency/v1/' + project + '/';
  function operationIdFor(backupId) {
    return 'drive-op-' + sha256(Buffer.from(project + ':' + validId(backupId, 'backupId'))).slice(0, 32);
  }
  function parseKey(input) {
    if (!input || input.projectId !== project || typeof input.objectKey !== 'string' ||
        !input.objectKey.startsWith(prefix) || !input.objectKey.endsWith('.mhe')) {
      reject('Cross-project or out-of-namespace object access rejected.', 'HFM_DRIVE_PROJECT_SCOPE');
    }
    const backupId = input.objectKey.slice(prefix.length, -4);
    validId(backupId, 'backupId');
    if (input.objectKey !== prefix + backupId + '.mhe') {
      reject('Object key is not canonical.', 'HFM_DRIVE_NAMESPACE_REJECTED');
    }
    return backupId;
  }
  function readJournal(backupId) {
    try {
      return readBackupIdJournal({
        directory: journalDirectory,
        operationId: operationIdFor(backupId),
        expected: { accountBinding, driveSpace, projectId: project, backupId }
      });
    } catch (error) {
      if (error.code === 'HFM_DRIVE_JOURNAL_MISSING') return null;
      throw error;
    }
  }
  function validateRemote(remote, journal, backupId) {
    const m = remote && remote.metadata;
    if (!remote || remote.id !== journal.generatedFileId || !m ||
        m.accountBinding !== accountBinding || m.driveSpace !== driveSpace ||
        m.projectId !== project || m.backupId !== backupId || m.backupSchema !== journal.backupSchema ||
        m.backupVersion !== journal.backupVersion || m.backupCreatedAt !== journal.backupCreatedAt ||
        m.ciphertextSha256 !== journal.ciphertextSha256 ||
        m.bytes !== journal.bytes || m.contentType !== CONTENT_TYPE ||
        m.encryption !== 'AES-256-GCM' || m.parentId !== parentId) {
      reject('Remote object metadata does not match the durable operation journal.',
        'HFM_DRIVE_GENERATED_UPLOAD_CONFLICT');
    }
  }

  return Object.freeze({
    capabilities: Object.freeze({
      encryptedOnly: true, projectIsolated: true, createOnly: true, readAfterWrite: true,
      journaledGeneratedId: true, exactByteReadback: true
    }),

    async putIfAbsent(input = {}) {
      const backupId = parseKey(input);
      if (input.backupId !== backupId || input.contentType !== CONTENT_TYPE ||
          input.encryption !== 'AES-256-GCM' || !Buffer.isBuffer(input.bytes) ||
          typeof input.ciphertextSha256 !== 'string' ||
          sha256(input.bytes) !== input.ciphertextSha256) {
        reject('Upload metadata or encrypted bytes do not match the requested backup.',
          'HFM_DRIVE_GENERATED_UPLOAD_CONFLICT');
      }
      const result = await uploader.upload({
        operationId: operationIdFor(backupId), backupId, bytes: input.bytes,
        contentType: input.contentType, encryption: input.encryption,
        ciphertextSha256: input.ciphertextSha256
      });
      return Object.freeze({
        created: result.status === 'CREATED_VERIFIED',
        reconciled: result.status === 'RECONCILED_VERIFIED',
        verified: result.exactByteReadback === true && result.metadataVerified === true,
        fileId: result.fileId
      });
    },

    async get(input = {}) {
      const backupId = parseKey(input);
      const journal = readJournal(backupId);
      if (!journal) return null;
      let remote;
      try {
        remote = await provider.getFile({
          id: journal.generatedFileId, accountBinding, driveSpace
        });
      } catch (_) {
        reject('Exact-ID object metadata lookup failed.', 'HFM_DRIVE_GENERATED_UPLOAD_UNCERTAIN');
      }
      if (!remote) return null;
      validateRemote(remote, journal, backupId);
      let bytes;
      try {
        bytes = await provider.downloadFile({
          id: journal.generatedFileId, accountBinding, driveSpace
        });
      } catch (_) {
        reject('Exact-ID ciphertext download failed.', 'HFM_DRIVE_GENERATED_UPLOAD_UNCERTAIN');
      }
      if (!Buffer.isBuffer(bytes) || bytes.length !== journal.bytes ||
          sha256(bytes) !== journal.ciphertextSha256) {
        reject('Downloaded ciphertext does not match journaled size and digest.',
          'HFM_DRIVE_GENERATED_UPLOAD_CONFLICT');
      }
      return Object.freeze({
        projectId: project, backupId, bytes: Buffer.from(bytes),
        metadata: Object.freeze({
          projectId: project, backupId, objectKey: prefix + backupId + '.mhe',
          contentType: CONTENT_TYPE, encryption: 'AES-256-GCM',
          ciphertextSha256: journal.ciphertextSha256, bytes: journal.bytes
        })
      });
    }
  });
}
module.exports = { createJournaledDriveCloudAdapter };
