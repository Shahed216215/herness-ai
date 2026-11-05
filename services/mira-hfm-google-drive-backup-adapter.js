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
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
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
  const existing = await drive.files.list({
    q: "'" + folderId + "' in parents and name='" + escapedName + "' and trashed=false",
    spaces: 'drive',
    fields: 'files(id,name,size,appProperties)'
  });
  if (existing && existing.data && Array.isArray(existing.data.files) && existing.data.files.length) {
    const error = new Error('Immutable emergency backup already exists in Drive; refusing overwrite.');
    error.code = 'DRIVE_BACKUP_ALREADY_EXISTS';
    throw error;
  }
  const expectedHash = sha256(bytes);
  const created = await drive.files.create({
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
    fields: 'id,name,size,appProperties'
  });
  const file = created && created.data;
  if (!file || typeof file.id !== 'string' || !file.id) {
    const error = new Error('Google Drive did not return a created file ID.');
    error.stateCommitted = true;
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
    error.stateCommitted = true;
    error.remoteFileId = file.id;
    throw error;
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
