'use strict';

const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { assessDriveQuota, parseEnvelope, MAX_BACKUP_BYTES } = require('./mira-hfm-emergency-backup');

const DEFAULT_ALLOCATED_LIMIT = 5 * 1024 ** 3;
const MIME_TYPE = 'application/octet-stream';

function parseBytes(value, field) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Drive quota ' + field + ' is unavailable.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Drive quota ' + field + ' is invalid.');
  return number;
}
async function getDriveQuotaSnapshot(drive, allocatedLimitBytes = DEFAULT_ALLOCATED_LIMIT) {
  if (!drive || !drive.about || typeof drive.about.get !== 'function') throw new Error('Google Drive about.get capability is unavailable.');
  const response = await drive.about.get({ fields: 'storageQuota' });
  const quota = response && response.data && response.data.storageQuota;
  if (!quota || quota.usage === undefined) throw new Error('Google Drive quota response is incomplete.');
  const usageBytes = parseBytes(quota.usage, 'usage');
  const limitBytes = quota.limit === undefined ? null : parseBytes(quota.limit, 'limit');
  return assessDriveQuota({ usageBytes, limitBytes, verified: true }, allocatedLimitBytes);
}
async function readResponseBytes(response) {
  const data = response && response.data;
  if (Buffer.isBuffer(data)) {
    if (data.length > MAX_BACKUP_BYTES) throw new Error('Google Drive backup readback exceeds the size limit.');
    return data;
  }
  if (data instanceof Uint8Array) {
    if (data.byteLength > MAX_BACKUP_BYTES) throw new Error('Google Drive backup readback exceeds the size limit.');
    return Buffer.from(data);
  }
  if (data instanceof ArrayBuffer) {
    if (data.byteLength > MAX_BACKUP_BYTES) throw new Error('Google Drive backup readback exceeds the size limit.');
    return Buffer.from(data);
  }
  if (data && typeof data[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    for await (const chunk of data) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_BACKUP_BYTES) throw new Error('Google Drive backup readback exceeds the size limit.');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Google Drive returned an unsupported backup body.');
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function validateUploadInput({ drive, folderId, fileName, bytes, projectId }) {
  if (!drive || !drive.files || typeof drive.files.list !== 'function' ||
      typeof drive.files.create !== 'function' || typeof drive.files.get !== 'function') {
    throw new Error('Google Drive files list/create/get capabilities are required.');
  }
  if (typeof folderId !== 'string' || !/^[A-Za-z0-9_-]{5,256}$/.test(folderId)) throw new Error('A verified Drive folder ID is required.');
  if (typeof fileName !== 'string' || !/^mira-hfm-[A-Za-z0-9_-]{1,80}-[0-9T.Z-]+\.mira-hfm\.enc\.json$/.test(fileName)) {
    throw new Error('Backup filename is invalid.');
  }
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 256) throw new Error('Project ID is required.');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BACKUP_BYTES) throw new Error('Encrypted backup bytes are invalid.');
  const envelope = parseEnvelope(bytes);
  if (envelope.manifest.projectId !== projectId) throw new Error('Encrypted backup project scope does not match upload scope.');
}
async function uploadEncryptedBackup({ drive, folderId, fileName, bytes, projectId,
  allocatedLimitBytes = DEFAULT_ALLOCATED_LIMIT }) {
  validateUploadInput({ drive, folderId, fileName, bytes, projectId });
  const quota = await getDriveQuotaSnapshot(drive, allocatedLimitBytes);
  if (quota.status !== 'QUOTA_SNAPSHOT_VERIFIED') throw new Error('Drive quota is not verified.');
  if (quota.overLimit || bytes.length > quota.remainingBytes) {
    const error = new Error('Emergency backup would exceed the allocated Google Drive capacity.');
    error.code = 'DRIVE_BACKUP_QUOTA_EXCEEDED';
    throw error;
  }
  const escapedName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let existing;
  try {
    existing = await drive.files.list({
      q: "'" + folderId + "' in parents and name='" + escapedName + "' and trashed=false",
      spaces: 'drive',
      fields: 'files(id,name,size,parents,appProperties)'
    });
  } catch {
    const error = new Error('Google Drive could not verify whether the immutable backup name is already occupied.');
    error.code = 'DRIVE_BACKUP_DUPLICATE_CHECK_FAILED';
    throw error;
  }
  if (!existing || !existing.data || !Array.isArray(existing.data.files)) {
    const error = new Error('Google Drive duplicate-check response is incomplete; refusing to upload.');
    error.code = 'DRIVE_BACKUP_DUPLICATE_CHECK_UNVERIFIED';
    throw error;
  }
  if (existing.data.files.length) {
    const error = new Error('Immutable emergency backup already exists in Drive; refusing overwrite.');
    error.code = 'DRIVE_BACKUP_ALREADY_EXISTS';
    throw error;
  }
  const expectedHash = sha256(bytes);
  let created;
  try {
    created = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        mimeType: MIME_TYPE,
        appProperties: {
          miraHfmBackupFormat: '1',
          miraHfmProjectId: projectId,
          miraHfmSha256: expectedHash
        }
      },
      media: { mimeType: MIME_TYPE, body: Readable.from([bytes]) },
      fields: 'id,name,size,parents,appProperties'
    });
  } catch {
    const error = new Error('Google Drive upload outcome is unknown; the remote object may have committed and must be reconciled before retry.');
    error.code = 'DRIVE_BACKUP_CREATE_OUTCOME_UNKNOWN';
    error.stateCommitted = true;
    error.outcome = 'REVIEW_REQUIRED';
    throw error;
  }
  const file = created && created.data;
  if (!file || typeof file.id !== 'string' || !file.id ||
      file.name !== fileName || !Array.isArray(file.parents) || !file.parents.includes(folderId) ||
      !file.appProperties || file.appProperties.miraHfmBackupFormat !== '1' ||
      file.appProperties.miraHfmProjectId !== projectId ||
      file.appProperties.miraHfmSha256 !== expectedHash) {
    const error = new Error('Google Drive create response did not prove the exact immutable backup object and scope; remote commit requires review.');
    error.code = 'DRIVE_BACKUP_CREATE_RESPONSE_UNVERIFIED';
    error.stateCommitted = true;
    error.remoteFileId = file && typeof file.id === 'string' ? file.id : undefined;
    error.outcome = 'REVIEW_REQUIRED';
    throw error;
  }
  try {
    const readback = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
    const actualBytes = await readResponseBytes(readback);
    if (sha256(actualBytes) !== expectedHash || !actualBytes.equals(bytes)) {
      const error = new Error('Google Drive emergency backup readback integrity mismatch.');
      error.code = 'DRIVE_BACKUP_READBACK_INTEGRITY_FAILED';
      throw error;
    }
    return {
      status: 'VERIFIED',
      fileId: file.id,
      fileName: file.name || fileName,
      projectId,
      sizeBytes: actualBytes.length,
      sha256: expectedHash,
      quota
    };
  } catch (error) {
    const failure = new Error(error && error.code === 'DRIVE_BACKUP_READBACK_INTEGRITY_FAILED'
      ? 'Google Drive emergency backup readback integrity verification failed; remote object was retained for review.'
      : 'Google Drive emergency backup readback could not be verified; remote object was retained for review.');
    failure.code = error && error.code === 'DRIVE_BACKUP_READBACK_INTEGRITY_FAILED'
      ? error.code : 'DRIVE_BACKUP_READBACK_UNVERIFIED';
    failure.stateCommitted = true;
    failure.remoteFileId = file.id;
    failure.outcome = 'REVIEW_REQUIRED';
    throw failure;
  }
}
async function downloadEncryptedBackup({ drive, fileId, expectedSha256 }) {
  if (!drive || !drive.files || typeof drive.files.get !== 'function') throw new Error('Google Drive files.get capability is unavailable.');
  if (typeof fileId !== 'string' || !fileId.trim()) throw new Error('Drive file ID is required.');
  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  const bytes = await readResponseBytes(response);
  parseEnvelope(bytes);
  const digest = sha256(bytes);
  if (expectedSha256 && digest !== expectedSha256) {
    const error = new Error('Downloaded Google Drive backup digest does not match the expected digest.');
    error.code = 'DRIVE_BACKUP_DOWNLOAD_INTEGRITY_FAILED';
    throw error;
  }
  return { status: 'DOWNLOADED_UNVERIFIED', bytes, sha256: digest };
}
module.exports = { DEFAULT_ALLOCATED_LIMIT, getDriveQuotaSnapshot, uploadEncryptedBackup, downloadEncryptedBackup };
