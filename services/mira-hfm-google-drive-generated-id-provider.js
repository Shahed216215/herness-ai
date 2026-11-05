'use strict';

// Google Drive v3 method mapper. A pre-authorized drive client and account-fingerprint
// verifier must be injected; this module never creates OAuth credentials or a client.
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { MAX_OBJECT_BYTES, CONTENT_TYPE } = require('./mira-hfm-drive-generated-id-upload');

const FILE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function reject(message, code = 'HFM_GOOGLE_DRIVE_PROVIDER_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function createGoogleDriveGeneratedIdProvider({ drive, accountBinding, getAccountFingerprint,
  driveSpace, projectId, parentId } = {}) {
  if (!drive || !drive.files || typeof drive.files.generateIds !== 'function' ||
      typeof drive.files.create !== 'function' || typeof drive.files.get !== 'function') {
    reject('An injected Google Drive v3 files client is required.');
  }
  if (typeof accountBinding !== 'string' || !/^[a-f0-9]{64}$/.test(accountBinding)) {
    reject('accountBinding must be a SHA-256 account fingerprint.');
  }
  if (typeof getAccountFingerprint !== 'function') {
    reject('A verified authenticated-account fingerprint callback is required.');
  }
  if (typeof projectId !== 'string' || !ID_RE.test(projectId)) reject('projectId is invalid.');
  if (!['drive', 'appDataFolder'].includes(driveSpace)) reject('driveSpace is unsupported.');
  if (typeof parentId !== 'string' || !parentId.trim() || /[\r\n\u0000-\u001f]/.test(parentId)) {
    reject('A dedicated Drive parent ID is required.');
  }
  if (driveSpace === 'appDataFolder' && parentId !== 'appDataFolder') {
    reject('appDataFolder uploads must use the appDataFolder parent.');
  }

  async function assertAccount(expectedAccount, expectedSpace) {
    if (expectedAccount !== accountBinding || expectedSpace !== driveSpace) {
      reject('Provider account/space binding mismatch.', 'HFM_GOOGLE_DRIVE_ACCOUNT_SCOPE');
    }
    let actual;
    try { actual = await getAccountFingerprint(); }
    catch (_) { reject('Authenticated account identity could not be verified.',
      'HFM_GOOGLE_DRIVE_ACCOUNT_UNVERIFIED'); }
    if (actual !== accountBinding) {
      reject('Authenticated account does not match the journal binding.',
        'HFM_GOOGLE_DRIVE_ACCOUNT_SCOPE');
    }
  }
  function validateFileId(id) {
    if (typeof id !== 'string' || !FILE_ID_RE.test(id)) reject('Drive file ID is invalid.');
    return id;
  }

  return Object.freeze({
    async generateFileId({ accountBinding: account, driveSpace: space } = {}) {
      await assertAccount(account, space);
      let response;
      try {
        response = await drive.files.generateIds({
          count: 1, space: driveSpace, type: 'files', fields: 'ids,space'
        });
      } catch (_) {
        reject('Google Drive pre-generated ID request failed.', 'HFM_GOOGLE_DRIVE_ID_GENERATION_FAILED');
      }
      const ids = response && response.data && response.data.ids;
      if (!response || !response.data || response.data.space !== driveSpace ||
          !Array.isArray(ids) || ids.length !== 1) {
        reject('Google Drive returned an invalid generated-ID response.',
          'HFM_GOOGLE_DRIVE_ID_RESPONSE_INVALID');
      }
      return { id: validateFileId(ids[0]) };
    },

    async createFile(input = {}) {
      await assertAccount(input.accountBinding, input.driveSpace);
      if (!validateFileId(input.id) || input.mimeType !== CONTENT_TYPE ||
          !Array.isArray(input.parents) || input.parents.length !== 1 ||
          input.parents[0] !== parentId || !Buffer.isBuffer(input.bytes) ||
          input.bytes.length < 1 || input.bytes.length > MAX_OBJECT_BYTES ||
          !input.appProperties || input.appProperties.encryption !== 'AES-256-GCM' ||
          input.appProperties.ciphertextSha256 == null ||
          !DIGEST_RE.test(input.appProperties.ciphertextSha256) ||
          input.appProperties.projectId !== projectId ||
          !ID_RE.test(input.appProperties.backupId || '') ||
          input.appProperties.schema !== 'MIRA_HFM_ENCRYPTED_EMERGENCY_BACKUP' ||
          input.appProperties.version !== '1.0.0' ||
          typeof input.appProperties.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(input.appProperties.createdAt)) ||
          new Date(Date.parse(input.appProperties.createdAt)).toISOString() !== input.appProperties.createdAt ||
          sha256(input.bytes) !== input.appProperties.ciphertextSha256 ||
          !Number.isSafeInteger(Number(input.appProperties.bytes)) ||
          Number(input.appProperties.bytes) !== input.bytes.length) {
        reject('Google Drive create request violates the encrypted backup contract.');
      }
      const backupId = input.appProperties.backupId;
      let response;
      try {
        response = await drive.files.create({
          requestBody: {
            id: input.id,
            name: 'mira-hfm-emergency-' + backupId + '.mhe',
            mimeType: CONTENT_TYPE,
            parents: [parentId],
            appProperties: { ...input.appProperties }
          },
          media: { mimeType: CONTENT_TYPE, body: Readable.from([Buffer.from(input.bytes)]) },
          uploadType: 'resumable',
          fields: 'id,mimeType,parents,appProperties,size,createdTime'
        });
      } catch (error) {
        throw error;
      }
      const returnedId = response && response.data && response.data.id;
      if (returnedId !== input.id) {
        reject('Google Drive create response did not preserve the pre-generated ID.',
          'HFM_GOOGLE_DRIVE_CREATE_ID_MISMATCH');
      }
      return { id: returnedId, created: true };
    },

    async getFile({ id, accountBinding: account, driveSpace: space } = {}) {
      await assertAccount(account, space);
      const fileId = validateFileId(id);
      let response;
      try {
        response = await drive.files.get({
          fileId, fields: 'id,mimeType,parents,appProperties,size,createdTime'
        });
      } catch (error) {
        if (error && (error.code === 404 || error.status === 404)) return null;
        throw error;
      }
      const data = response && response.data;
      if (!data) return null;
      const properties = data.appProperties || {};
      const size = Number(data.size);
      const propertyBytes = Number(properties.bytes);
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_OBJECT_BYTES ||
          propertyBytes !== size || !Array.isArray(data.parents) ||
          data.parents.length !== 1 || data.parents[0] !== parentId ||
          data.mimeType !== CONTENT_TYPE) {
        reject('Google Drive metadata is outside the encrypted backup contract.',
          'HFM_GOOGLE_DRIVE_METADATA_INVALID');
      }
      return {
        id: data.id,
        metadata: {
          accountBinding, driveSpace, projectId: properties.projectId,
          backupId: properties.backupId, backupSchema: properties.schema,
          backupVersion: properties.version, backupCreatedAt: properties.createdAt,
          ciphertextSha256: properties.ciphertextSha256, bytes: size,
          contentType: data.mimeType, encryption: properties.encryption, parentId
        }
      };
    },

    async downloadFile({ id, accountBinding: account, driveSpace: space } = {}) {
      await assertAccount(account, space);
      const fileId = validateFileId(id);
      let response;
      try {
        response = await drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'stream' }
        );
      } catch (_) {
        reject('Google Drive exact-ID media download failed.',
          'HFM_GOOGLE_DRIVE_DOWNLOAD_FAILED');
      }
      const stream = response && response.data;
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        reject('Google Drive media response is not a bounded byte stream.',
          'HFM_GOOGLE_DRIVE_DOWNLOAD_INVALID');
      }
      const chunks = [];
      let total = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.length;
        if (total > MAX_OBJECT_BYTES) {
          reject('Google Drive media response exceeds the encrypted object limit.',
            'HFM_GOOGLE_DRIVE_OBJECT_TOO_LARGE');
        }
        chunks.push(bytes);
      }
      if (total < 1) reject('Google Drive returned an empty backup object.',
        'HFM_GOOGLE_DRIVE_DOWNLOAD_INVALID');
      return Buffer.concat(chunks, total);
    }
  });
}
module.exports = { createGoogleDriveGeneratedIdProvider };
