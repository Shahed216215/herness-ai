'use strict';

// Provider-injected, offline-testable orchestration for a pre-generated Drive ID.
// No Google SDK, OAuth, credentials, network, or canonical Memory writes live here.
const crypto = require('node:crypto');
const { MAX_ENVELOPE_BYTES, MAX_PAYLOAD_BYTES } = require('./mira-hfm-encrypted-emergency-backup');
const {
  createBackupIdJournal, readBackupIdJournal
} = require('./mira-hfm-drive-backup-id-journal');

const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/;
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;
const CONTENT_TYPE = 'application/vnd.mira.hfm-encrypted-backup';
const BACKUP_SCHEMA = 'MIRA_HFM_ENCRYPTED_EMERGENCY_BACKUP';
const BACKUP_VERSION = '1.0.0';

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
  if (!/^[a-f0-9]{64}$/.test(account)) reject('accountBinding must be a SHA-256 account fingerprint.');
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
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 ||
        input.bytes.length > MAX_ENVELOPE_BYTES) {
      reject('Only bounded encrypted backup bytes are accepted.');
    }
    const bytes = Buffer.from(input.bytes);
    const digest = sha256(bytes);
    if (input.ciphertextSha256 !== digest ||
        input.contentType !== CONTENT_TYPE || input.encryption !== 'AES-256-GCM') {
      reject('Upload must be bound to the encrypted envelope content type, algorithm and digest.');
    }
    let envelope;
    const serializedEnvelope = bytes.toString('utf8');
    try { envelope = JSON.parse(serializedEnvelope); }
    catch { reject('Upload bytes are not a valid encrypted HFM envelope.'); }
    const expectedEnvelopeKeys = ['schema','version','algorithm','backupId','createdAt',
      'payloadBytes','plaintextSha256','metadata','kdf','salt','iv','tag','ciphertext','ciphertextSha256'].sort();
    const envelopeKeys = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
      ? Object.keys(envelope).sort() : [];
    const backupTime = new Date(envelope && envelope.createdAt);
    const ciphertext = typeof (envelope && envelope.ciphertext) === 'string'
      ? Buffer.from(envelope.ciphertext, 'base64') : null;
    const canonicalBase64 = (value, decoded, length) => typeof value === 'string' &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
      decoded && decoded.length === length && decoded.toString('base64') === value;
    if (!envelope || envelopeKeys.length !== expectedEnvelopeKeys.length ||
        envelopeKeys.some((field, index) => field !== expectedEnvelopeKeys[index]) ||
        JSON.stringify(envelope) + '\n' !== serializedEnvelope ||
        envelope.schema !== BACKUP_SCHEMA || envelope.version !== BACKUP_VERSION ||
        envelope.algorithm !== 'aes-256-gcm' || envelope.kdf !== 'HKDF-SHA256' ||
        envelope.backupId !== backupId || !envelope.metadata ||
        envelope.metadata.projectId !== project ||
        !Number.isInteger(envelope.payloadBytes) || envelope.payloadBytes < 1 ||
        envelope.payloadBytes > MAX_PAYLOAD_BYTES ||
        !/^[a-f0-9]{64}$/.test(envelope.plaintextSha256 || '') ||
        !/^[a-f0-9]{64}$/.test(envelope.ciphertextSha256 || '') ||
        !Number.isFinite(backupTime.getTime()) || backupTime.toISOString() !== envelope.createdAt ||
        backupTime.getTime() > Date.now() ||
        !canonicalBase64(envelope.salt, Buffer.from(envelope.salt || '', 'base64'), 16) ||
        !canonicalBase64(envelope.iv, Buffer.from(envelope.iv || '', 'base64'), 12) ||
        !canonicalBase64(envelope.tag, Buffer.from(envelope.tag || '', 'base64'), 16) ||
        !canonicalBase64(envelope.ciphertext, ciphertext, envelope.payloadBytes) ||
        sha256(ciphertext) !== envelope.ciphertextSha256) {
      reject('Encrypted HFM envelope identity/schema/timestamp does not match the upload request.');
    }
    const backupCreatedAt = envelope.createdAt;

    let journal;
    try {
      journal = readBackupIdJournal({
        directory: journalDirectory, operationId,
        expected: { accountBinding: account, driveSpace, projectId: project,
          backupId, backupSchema: BACKUP_SCHEMA, backupVersion: BACKUP_VERSION,
          backupCreatedAt, ciphertextSha256: digest, bytes: bytes.length }
      });
    } catch (error) {
      if (error.code !== 'HFM_DRIVE_JOURNAL_MISSING') throw error;
      let generated;
      try { generated = await provider.generateFileId({ accountBinding: account, driveSpace }); }
      catch (_) { reject('Drive ID generation failed; no upload was attempted.',
        'HFM_DRIVE_ID_GENERATION_FAILED'); }
      const generatedFileId = validateFileId(generated && generated.id);
      journal = createBackupIdJournal({
        directory: journalDirectory, operationId, accountBinding: account, driveSpace,
        projectId: project, backupId, generatedFileId,
        backupSchema: BACKUP_SCHEMA, backupVersion: BACKUP_VERSION, backupCreatedAt,
        ciphertextSha256: digest, bytes: bytes.length
      });
    }

    const fileId = validateFileId(journal.generatedFileId);
    const metadata = Object.freeze({
      accountBinding: account, driveSpace, projectId: project, backupId,
      backupSchema: BACKUP_SCHEMA, backupVersion: BACKUP_VERSION, backupCreatedAt,
      ciphertextSha256: digest, bytes: bytes.length, contentType: CONTENT_TYPE,
      encryption: 'AES-256-GCM', parentId: parent
    });
    let createResponse;
    let createError = null;
    try {
      createResponse = await provider.createFile({
        id: fileId, parents: [parent], appProperties: {
          projectId: project, backupId, schema: BACKUP_SCHEMA, version: BACKUP_VERSION,
          createdAt: backupCreatedAt, ciphertextSha256: digest,
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
      remoteMetadata.backupSchema === metadata.backupSchema &&
      remoteMetadata.backupVersion === metadata.backupVersion &&
      remoteMetadata.backupCreatedAt === metadata.backupCreatedAt &&
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
