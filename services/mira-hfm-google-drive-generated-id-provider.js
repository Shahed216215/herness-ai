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
function validateAppProperties(properties, expectedProjectId, expectedBytes) {
  const required = ['backupId', 'bytes', 'createdAt', 'ciphertextSha256',
    'encryption', 'projectId', 'schema', 'version'];
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
  const keys = Object.keys(properties).sort();
  if (keys.length !== required.length ||
      keys.some((key, index) => key !== required.slice().sort()[index])) return false;
  for (const key of required) {
    if (typeof properties[key] !== 'string' || Buffer.byteLength(key + properties[key], 'utf8') > 124) {
      return false;
    }
  }
  const timestamp = Date.parse(properties.createdAt);
  return properties.projectId === expectedProjectId &&
    ID_RE.test(properties.backupId) &&
    properties.schema === 'MIRA_HFM_ENCRYPTED_EMERGENCY_BACKUP' &&
    properties.version === '1.0.0' &&
    properties.encryption === 'AES-256-GCM' &&
    DIGEST_RE.test(properties.ciphertextSha256) &&
    Number.isSafeInteger(Number(properties.bytes)) &&
    Number(properties.bytes) === expectedBytes &&
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === properties.createdAt &&
    timestamp <= Date.now();
}

function reject(message, code = 'HFM_GOOGLE_DRIVE_PROVIDER_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
async function getGoogleDriveAccountFingerprint(drive) {
  if (!drive || !drive.about || typeof drive.about.get !== 'function') {
    reject('Google Drive about.get is required to verify account identity.');
  }
  let response;
  try { response = await drive.about.get({ fields: 'user(me,permissionId)' }); }
  catch (_) { reject('Google Drive authenticated account identity lookup failed.',
    'HFM_GOOGLE_DRIVE_ACCOUNT_UNVERIFIED'); }
  const user = response && response.data && response.data.user;
  const permissionId = user && user.permissionId;
  if (!user || user.me !== true || typeof permissionId !== 'string' || !permissionId) {
    reject('Google Drive did not return an authenticated permissionId.',
      'HFM_GOOGLE_DRIVE_ACCOUNT_UNVERIFIED');
  }
  return sha256(Buffer.from(permissionId, 'utf8'));
}

function createGoogleDriveGeneratedIdProvider({ drive, accountBinding, getAccountFingerprint,
  driveSpace, projectId, parentId } = {}) {
  if (!drive || !drive.files || typeof drive.files.generateIds !== 'function' ||
      typeof drive.files.create !== 'function' || typeof drive.files.get !== 'function' || typeof drive.files.list !== 'function' ||
      !drive.about || typeof drive.about.get !== 'function') {
    reject('An injected Google Drive v3 files client is required.');
  }
  if (typeof accountBinding !== 'string' || !/^[a-f0-9]{64}$/.test(accountBinding)) {
    reject('accountBinding must be a SHA-256 account fingerprint.');
  }
  const accountFingerprintGetter = typeof getAccountFingerprint === 'function'
    ? getAccountFingerprint : async () => await getGoogleDriveAccountFingerprint(drive);
  if (typeof projectId !== 'string' || !ID_RE.test(projectId)) reject('projectId is invalid.');
  if (!['drive', 'appDataFolder'].includes(driveSpace)) reject('driveSpace is unsupported.');
  if (typeof parentId !== 'string' || !parentId.trim() || /[\r\n\u0000-\u001f]/.test(parentId) ||
      (driveSpace === 'drive' && !FILE_ID_RE.test(parentId))) {
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
    try { actual = await accountFingerprintGetter(); }
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
          !validateAppProperties(input.appProperties, projectId, input.bytes.length) ||
          sha256(input.bytes) !== input.appProperties.ciphertextSha256) {
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
      if (data.id !== fileId || !Number.isSafeInteger(size) || size < 1 ||
          size > MAX_OBJECT_BYTES || !validateAppProperties(properties, projectId, size) ||
          !Array.isArray(data.parents) || data.parents.length !== 1 ||
          data.parents[0] !== parentId || data.mimeType !== CONTENT_TYPE) {
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

    async listPage({ projectId: requestedProject, prefix, cursor = null, limit } = {}) {
      await assertAccount(accountBinding, driveSpace);
      if (requestedProject !== projectId ||
          prefix !== 'mira-hfm-emergency/v1/' + projectId + '/' ||
          !Number.isInteger(limit) || limit < 1 || limit > 500 ||
          (cursor !== null && (typeof cursor !== 'string' || !cursor ||
            cursor.length > 1024 || /[\u0000-\u001f]/.test(cursor)))) {
        reject('Google Drive listing request is outside the configured project/page boundary.',
          'HFM_GOOGLE_DRIVE_LIST_SCOPE');
      }
      let response;
      try {
        response = await drive.files.list({
          q: "'" + parentId + "' in parents and trashed = false",
          spaces: driveSpace,
          pageSize: limit,
          pageToken: cursor || undefined,
          fields: 'nextPageToken,files(id,mimeType,parents,appProperties,size,createdTime)'
        });
      } catch (_) {
        reject('Google Drive encrypted backup listing failed.',
          'HFM_GOOGLE_DRIVE_LIST_FAILED');
      }
      const data = response && response.data;
      if (!data || data.incompleteSearch === true || !Array.isArray(data.files) || data.files.length > limit ||
          (data.nextPageToken != null &&
            (typeof data.nextPageToken !== 'string' || !data.nextPageToken ||
             data.nextPageToken.length > 1024 || /[\u0000-\u001f]/.test(data.nextPageToken) ||
             data.nextPageToken === cursor))) {
        reject('Google Drive listing response is malformed or has an invalid cursor.',
          'HFM_GOOGLE_DRIVE_LIST_INVALID');
      }
      const items = data.files.map(file => {
        const p = file && file.appProperties || {};
        const size = Number(file && file.size);
        const propertyBytes = Number(p.bytes);
        const created = typeof p.createdAt === 'string' ? Date.parse(p.createdAt) : NaN;
        if (!file || !FILE_ID_RE.test(file.id || '') ||
            file.mimeType !== CONTENT_TYPE || !Array.isArray(file.parents) ||
            file.parents.length !== 1 || file.parents[0] !== parentId ||
            p.projectId !== projectId || !ID_RE.test(p.backupId || '') ||
            p.schema !== 'MIRA_HFM_ENCRYPTED_EMERGENCY_BACKUP' || p.version !== '1.0.0' ||
            !Number.isSafeInteger(size) || size < 1 || size > MAX_OBJECT_BYTES ||
            propertyBytes !== size || !validateAppProperties(p, projectId, size) ||
            !Number.isFinite(created) || new Date(created).toISOString() !== p.createdAt) {
          reject('Google Drive listed item failed encrypted metadata, project, parent, or size validation.',
            'HFM_GOOGLE_DRIVE_LIST_ITEM_INVALID');
        }
        return { metadata: {
          fileId: file.id, projectId, backupId: p.backupId,
          backupSchema: p.schema, backupVersion: p.version, backupCreatedAt: p.createdAt,
          objectKey: 'mira-hfm-emergency/v1/' + projectId + '/' + p.backupId + '.mhe',
          createdAt: p.createdAt, bytes: size,
          contentType: CONTENT_TYPE, encryption: p.encryption,
          ciphertextSha256: p.ciphertextSha256
        } };
      });
      return {
        items, complete: data.nextPageToken == null,
        nextCursor: data.nextPageToken == null ? undefined : data.nextPageToken
      };
    },

    async getQuota({ projectId: requestedProject } = {}) {
      await assertAccount(accountBinding, driveSpace);
      if (requestedProject !== projectId) {
        reject('Google Drive quota request project mismatch.', 'HFM_GOOGLE_DRIVE_ACCOUNT_SCOPE');
      }
      let response;
      try {
        response = await drive.about.get({
          fields: 'user(me,permissionId),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)'
        });
      } catch (_) {
        reject('Google Drive storage quota is unavailable.',
          'HFM_GOOGLE_DRIVE_QUOTA_UNAVAILABLE');
      }
      const data = response && response.data;
      const permissionId = data && data.user && data.user.permissionId;
      if (!data.user || data.user.me !== true || typeof permissionId !== 'string' ||
          sha256(Buffer.from(permissionId, 'utf8')) !== accountBinding) {
        reject('Google Drive quota identity does not match the configured account.',
          'HFM_GOOGLE_DRIVE_ACCOUNT_SCOPE');
      }
      const quotaBytes = Number(data.storageQuota && data.storageQuota.limit);
      const usedBytes = Number(data.storageQuota && data.storageQuota.usage);
      if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1 ||
          !Number.isSafeInteger(usedBytes) || usedBytes < 0 || usedBytes > quotaBytes) {
        reject('Google Drive account quota is absent, unlimited, or outside safe numeric bounds.',
          'HFM_GOOGLE_DRIVE_QUOTA_UNAVAILABLE');
      }
      return {
        providerId: 'google-drive-v3', scope: 'account', projectId: null,
        quotaBytes, usedBytes, measuredAt: new Date().toISOString()
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
        let chunkBytes;
        if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
          chunkBytes = chunk.byteLength;
        } else if (typeof chunk === 'string') {
          chunkBytes = Buffer.byteLength(chunk, 'utf8');
        } else {
          reject('Google Drive media stream emitted an unsupported chunk type.',
            'HFM_GOOGLE_DRIVE_DOWNLOAD_INVALID');
        }
        if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 0 ||
            total + chunkBytes > MAX_OBJECT_BYTES) {
          reject('Google Drive media response exceeds the encrypted object limit.',
            'HFM_GOOGLE_DRIVE_OBJECT_TOO_LARGE');
        }
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += chunkBytes;
        chunks.push(bytes);
      }
      if (total < 1) reject('Google Drive returned an empty backup object.',
        'HFM_GOOGLE_DRIVE_DOWNLOAD_INVALID');
      return Buffer.concat(chunks, total);
    }
  });
}
module.exports = { createGoogleDriveGeneratedIdProvider, getGoogleDriveAccountFingerprint };
