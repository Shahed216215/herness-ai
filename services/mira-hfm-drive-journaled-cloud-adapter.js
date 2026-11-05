'use strict';

// Cloud-service adapter around a provider-injected, journaled generated-ID uploader.
// This is offline-testable orchestration, not a Google SDK or OAuth implementation.
const crypto = require('node:crypto');
const {
  createJournaledDriveUpload, CONTENT_TYPE
} = require('./mira-hfm-drive-generated-id-upload');
const { createBackupIdJournal, readBackupIdJournal } = require('./mira-hfm-drive-backup-id-journal');
const { decryptAndVerifyBackup } = require('./mira-hfm-encrypted-emergency-backup');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/;
const BACKUP_SCHEMA = 'MIRA_HFM_ENCRYPTED_EMERGENCY_BACKUP';
const BACKUP_VERSION = '1.0.0';
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

  const supportsList = typeof provider.listPage === 'function';
  const adapter = {
    capabilities: Object.freeze({
      encryptedOnly: true, projectIsolated: true, createOnly: true, readAfterWrite: true,
      journaledGeneratedId: true, exactByteReadback: true, list: supportsList
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
  };
  if (supportsList) {
    adapter.recoverJournal = async ({ backupId: requestedBackupId, key } = {}) => {
      const backupId = validId(requestedBackupId, 'backupId');
      if (!Buffer.isBuffer(key) || key.length !== 32) {
        reject('Journal recovery requires the exact 32-byte project root key.',
          'HFM_DRIVE_JOURNAL_RECOVERY_KEY_INVALID');
      }
      const operationId = operationIdFor(backupId);
      const existing = readJournal(backupId);
      if (existing) {
        return { status: 'JOURNAL_ALREADY_PRESENT', backupId,
          generatedFileId: existing.generatedFileId, recovered: false };
      }
      let cursor = null;
      const cursors = new Set();
      let pages = 0;
      let inspected = 0;
      let match = null;
      while (true) {
        pages += 1;
        if (pages > 100) reject('Journal recovery exceeded the bounded page limit.',
          'HFM_DRIVE_JOURNAL_RECOVERY_INCOMPLETE');
        const page = await provider.listPage({
          projectId: project, prefix, cursor, limit: 500
        });
        if (!page || !Array.isArray(page.items) || page.items.length > 500 ||
            typeof page.complete !== 'boolean' ||
            (!page.complete && (typeof page.nextCursor !== 'string' || !page.nextCursor ||
              page.nextCursor.length > 1024 || /[\u0000-\u001f]/.test(page.nextCursor) ||
              page.nextCursor === cursor || cursors.has(page.nextCursor))) ||
            (page.complete && page.nextCursor != null)) {
          reject('Journal recovery listing is incomplete or malformed.',
            'HFM_DRIVE_JOURNAL_RECOVERY_INCOMPLETE');
        }
        inspected += page.items.length;
        if (inspected > 50000) reject('Journal recovery exceeded the bounded item limit.',
          'HFM_DRIVE_JOURNAL_RECOVERY_INCOMPLETE');
        for (const item of page.items) {
          const m = item && item.metadata;
          const itemCreated = m && typeof m.backupCreatedAt === 'string'
            ? Date.parse(m.backupCreatedAt) : NaN;
          if (!m || m.projectId !== project ||
              typeof m.fileId !== 'string' || !DRIVE_FILE_ID_RE.test(m.fileId) ||
              typeof m.backupId !== 'string' || !ID_RE.test(m.backupId) ||
              m.objectKey !== prefix + m.backupId + '.mhe' ||
              m.backupSchema !== BACKUP_SCHEMA || m.backupVersion !== BACKUP_VERSION ||
              !Number.isFinite(itemCreated) || new Date(itemCreated).toISOString() !== m.backupCreatedAt ||
              itemCreated > Date.now() || m.createdAt !== m.backupCreatedAt ||
              !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > 64 * 1024 * 1024 ||
              m.contentType !== CONTENT_TYPE || m.encryption !== 'AES-256-GCM' ||
              typeof m.ciphertextSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(m.ciphertextSha256)) {
            reject('Journal recovery encountered invalid, incomplete or cross-project listing metadata.',
              'HFM_DRIVE_OBJECT_INVALID');
          }
          if (m.backupId !== backupId) continue;
          if (match) reject('More than one remote object matches this immutable backup ID.',
            'HFM_DRIVE_JOURNAL_RECOVERY_CONFLICT');
          match = m;
        }
        if (page.complete) break;
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      if (!match) return { status: 'REMOTE_BACKUP_NOT_FOUND', backupId, recovered: false };
      const createdMs = typeof match.backupCreatedAt === 'string'
        ? Date.parse(match.backupCreatedAt) : NaN;
      if (typeof match.fileId !== 'string' || !DRIVE_FILE_ID_RE.test(match.fileId) ||
          match.objectKey !== prefix + backupId + '.mhe' ||
          match.backupSchema !== BACKUP_SCHEMA || match.backupVersion !== BACKUP_VERSION ||
          !Number.isFinite(createdMs) || new Date(createdMs).toISOString() !== match.backupCreatedAt ||
          createdMs > Date.now() ||
          match.createdAt !== match.backupCreatedAt ||
          !Number.isSafeInteger(match.bytes) || match.bytes < 1 || match.bytes > 64 * 1024 * 1024 ||
          match.contentType !== CONTENT_TYPE || match.encryption !== 'AES-256-GCM' ||
          typeof match.ciphertextSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(match.ciphertextSha256)) {
        reject('Remote listing metadata cannot safely reconstruct the missing journal.',
          'HFM_DRIVE_JOURNAL_RECOVERY_CONFLICT');
      }
      const expected = {
        accountBinding, driveSpace, projectId: project, backupId,
        generatedFileId: match.fileId, backupSchema: match.backupSchema,
        backupVersion: match.backupVersion, backupCreatedAt: match.backupCreatedAt,
        ciphertextSha256: match.ciphertextSha256, bytes: match.bytes
      };
      let remote;
      try { remote = await provider.getFile({ id: match.fileId, accountBinding, driveSpace }); }
      catch (_) { reject('Exact-ID metadata verification failed during journal recovery.',
        'HFM_DRIVE_GENERATED_UPLOAD_UNCERTAIN'); }
      validateRemote(remote, expected, backupId);
      let bytes;
      try { bytes = await provider.downloadFile({ id: match.fileId, accountBinding, driveSpace }); }
      catch (_) { reject('Exact-ID ciphertext download failed during journal recovery.',
        'HFM_DRIVE_GENERATED_UPLOAD_UNCERTAIN'); }
      if (!Buffer.isBuffer(bytes) || bytes.length !== match.bytes ||
          sha256(bytes) !== match.ciphertextSha256) {
        reject('Remote ciphertext digest/size failed during journal recovery.',
          'HFM_DRIVE_JOURNAL_RECOVERY_CONFLICT');
      }
      let verified;
      try { verified = decryptAndVerifyBackup(bytes, key); }
      catch (_) { reject('Remote backup could not be authenticated with the supplied root key.',
        'HFM_DRIVE_JOURNAL_RECOVERY_AUTH_FAILED'); }
      const authenticatedIdentityMatches = !!verified && typeof verified === 'object' &&
        verified.backupId === backupId &&
        verified.createdAt === match.backupCreatedAt && verified.metadata &&
        verified.metadata.projectId === project;
      if (verified && Buffer.isBuffer(verified.payload)) verified.payload.fill(0);
      if (!authenticatedIdentityMatches) {
        reject('Authenticated envelope identity does not match the requested project/backup.',
          'HFM_DRIVE_JOURNAL_RECOVERY_CONFLICT');
      }
      const journal = createBackupIdJournal({
        directory: journalDirectory, operationId, accountBinding, driveSpace,
        projectId: project, backupId, generatedFileId: match.fileId,
        backupSchema: match.backupSchema, backupVersion: match.backupVersion,
        backupCreatedAt: match.backupCreatedAt,
        ciphertextSha256: match.ciphertextSha256, bytes: match.bytes
      });
      return {
        status: 'JOURNAL_RECOVERED_FROM_AUTHENTICATED_PROVIDER_OBJECT',
        backupId, generatedFileId: journal.generatedFileId,
        recovered: true, providerObjectAuthenticated: true,
        exactCiphertextVerified: true, canonicalMemoryWrites: 0
      };
    };
    adapter.list = async (input = {}) => {
      if (input.projectId !== project || input.prefix !== prefix ||
          !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
        reject('Journaled Drive listing is outside the configured project/page boundary.',
          'HFM_DRIVE_PROJECT_SCOPE');
      }
      const page = await provider.listPage({
        projectId: project, prefix, cursor: input.cursor == null ? null : input.cursor,
        limit: input.limit
      });
      if (!page || !Array.isArray(page.items) || typeof page.complete !== 'boolean' ||
          page.items.length > input.limit ||
          (!page.complete && (typeof page.nextCursor !== 'string' || !page.nextCursor ||
            page.nextCursor.length > 1024 || /[\u0000-\u001f]/.test(page.nextCursor))) ||
          (page.complete && page.nextCursor != null)) {
        reject('Google Drive listing page is malformed or incomplete.',
          'HFM_DRIVE_LIST_INVALID');
      }
      const items = page.items.map(item => {
        const m = item && item.metadata;
        if (!m || m.projectId !== project || typeof m.backupId !== 'string' ||
            m.objectKey !== prefix + m.backupId + '.mhe') {
          reject('Google Drive listing item failed project/object binding.',
            'HFM_DRIVE_OBJECT_INVALID');
        }
        return {
          projectId: m.projectId, backupId: m.backupId, objectKey: m.objectKey,
          createdAt: m.createdAt, bytes: m.bytes
        };
      });
      return { items, complete: page.complete,
        nextCursor: page.complete ? undefined : page.nextCursor };
    };
  }
  adapter.getProviderQuota = async () => {
    if (typeof provider.getQuota !== 'function') {
      return { status: 'NOT_REPORTED', providerQuotaAvailable: false };
    }
    let raw;
    try { raw = await provider.getQuota({ projectId: project }); }
    catch (error) {
      if (error && ['HFM_GOOGLE_DRIVE_ACCOUNT_SCOPE', 'HFM_GOOGLE_DRIVE_ACCOUNT_UNVERIFIED'].includes(error.code)) throw error;
      return { status: 'NOT_REPORTED', providerQuotaAvailable: false };
    }
    const timestamp = raw && typeof raw.measuredAt === 'string' ? Date.parse(raw.measuredAt) : NaN;
    if (!raw || typeof raw.providerId !== 'string' ||
        !/^[A-Za-z0-9._-]{2,80}$/.test(raw.providerId) ||
        !['account', 'project'].includes(raw.scope) ||
        (raw.scope === 'account' && raw.projectId !== null) ||
        (raw.scope === 'project' && raw.projectId !== project) ||
        !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== raw.measuredAt ||
        !Number.isSafeInteger(raw.quotaBytes) || raw.quotaBytes < 1 ||
        !Number.isSafeInteger(raw.usedBytes) || raw.usedBytes < 0 ||
        raw.usedBytes > raw.quotaBytes) {
      reject('Google Drive quota report failed schema or scope validation.',
        'HFM_DRIVE_QUOTA_INVALID');
    }
    return {
      status: 'REPORTED', providerQuotaAvailable: true,
      providerId: raw.providerId, scope: raw.scope, projectId: raw.projectId,
      measuredAt: raw.measuredAt, quotaBytes: raw.quotaBytes,
      usedBytes: raw.usedBytes, availableBytes: raw.quotaBytes - raw.usedBytes
    };
  };
  return Object.freeze(adapter);
}
module.exports = { createJournaledDriveCloudAdapter };
