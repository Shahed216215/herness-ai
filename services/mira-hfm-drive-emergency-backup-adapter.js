'use strict';

// Offline/provider-neutral boundary for a future dedicated emergency-backup transport.
// No network, OAuth, credentials, or provider SDK are used by this module.
const crypto = require('node:crypto');
const MAX_PAGE_SIZE = 500;
const MAX_ENVELOPE_BYTES = 64 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;

function reject(message, code = 'HFM_DRIVE_ADAPTER_REJECTED') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) reject(label + ' is invalid.');
  return value;
}
function bytesCopy(value) {
  if (!Buffer.isBuffer(value) || value.length < 1) reject('Encrypted object bytes are required.');
  return Buffer.from(value);
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function validateStoredItem(item, expected) {
  if (!item || !item.metadata || !Buffer.isBuffer(item.bytes)) return false;
  const m = item.metadata;
  return m.projectId === expected.projectId &&
    m.backupId === expected.backupId &&
    m.objectKey === expected.objectKey &&
    m.contentType === 'application/vnd.mira.hfm-encrypted-backup' &&
    m.encryption === 'AES-256-GCM' &&
    m.ciphertextSha256 === expected.ciphertextSha256 &&
    m.bytes === expected.bytes.length &&
    item.bytes.length === expected.bytes.length &&
    sha256(item.bytes) === expected.ciphertextSha256 &&
    item.bytes.equals(expected.bytes);
}
function createEmergencyBackupTransportAdapter({ transport, projectId, namespace = 'mira-hfm-emergency/v1' } = {}) {
  const project = validId(projectId, 'projectId');
  if (namespace !== 'mira-hfm-emergency/v1') reject('Only the dedicated emergency-backup namespace is permitted.');
  if (!transport || typeof transport.atomicCreate !== 'function' ||
      typeof transport.readObject !== 'function' || typeof transport.listPage !== 'function' ||
      typeof transport.getCapabilities !== 'function') {
    reject('Transport must implement getCapabilities, atomicCreate, readObject, and listPage.');
  }

  let negotiated;
  let negotiationPromise;
  async function negotiateCapabilities() {
    if (negotiated) return negotiated;
    if (!negotiationPromise) {
      negotiationPromise = (async () => {
        let raw;
        try {
          raw = await transport.getCapabilities({ projectId: project, namespace });
        } catch (_) {
          reject('Provider capability negotiation failed.', 'HFM_DRIVE_CAPABILITY_NEGOTIATION_FAILED');
        }
        const required = ['atomicCreateIfAbsent', 'readAfterWrite', 'projectIsolation',
          'encryptedObjectStorage', 'paginatedList'];
        if (!raw || required.some(name => raw[name] !== true) ||
            raw.consistency !== 'read-after-write' ||
            !Number.isSafeInteger(raw.maxObjectBytes) || raw.maxObjectBytes < 1 ||
            raw.maxObjectBytes > MAX_ENVELOPE_BYTES ||
            !Number.isInteger(raw.maxPageSize) || raw.maxPageSize < 1 ||
            raw.maxPageSize > MAX_PAGE_SIZE) {
          reject('Provider capabilities do not satisfy the bounded HFM consistency contract.',
            'HFM_DRIVE_CAPABILITY_UNSUPPORTED');
        }
        negotiated = Object.freeze({
          atomicCreateIfAbsent: true, readAfterWrite: true, projectIsolation: true,
          encryptedObjectStorage: true, paginatedList: true,
          consistency: raw.consistency, maxObjectBytes: raw.maxObjectBytes,
          maxPageSize: raw.maxPageSize
        });
        return negotiated;
      })();
    }
    return negotiationPromise;
  }

  const prefix = namespace + '/' + project + '/';
  function expectedKey(backupId) {
    return prefix + validId(backupId, 'backupId') + '.mhe';
  }
  async function readForReconciliation(expected) {
    let item;
    try {
      item = await transport.readObject({ objectKey: expected.objectKey });
    } catch (_) {
      reject('Create outcome could not be reconciled safely.', 'HFM_DRIVE_CREATE_UNCERTAIN');
    }
    if (!item) return null;
    if (!validateStoredItem(item, expected)) {
      reject('Existing object conflicts with the requested immutable backup.', 'HFM_DRIVE_OBJECT_CONFLICT');
    }
    return item;
  }

  return Object.freeze({
    capabilities: Object.freeze({
      encryptedOnly: true, projectIsolated: true, createOnly: true,
      readAfterWrite: true, list: true, dedicatedNamespace: true,
      timeoutReconciliation: true, immutableCollisionDetection: true,
      providerNegotiationRequired: true
    }),

    async negotiateCapabilities() {
      return await negotiateCapabilities();
    },

    async getProviderQuota() {
      await negotiateCapabilities();
      if (typeof transport.getQuota !== 'function') {
        return Object.freeze({ status: 'NOT_REPORTED', providerQuotaAvailable: false });
      }
      let raw;
      try {
        raw = await transport.getQuota({ projectId: project });
      } catch (_) {
        reject('Provider quota could not be retrieved.', 'HFM_DRIVE_QUOTA_UNAVAILABLE');
      }
      const validTimestamp = raw && typeof raw.measuredAt === 'string' &&
        Number.isFinite(Date.parse(raw.measuredAt)) &&
        new Date(Date.parse(raw.measuredAt)).toISOString() === raw.measuredAt;
      if (!raw || typeof raw.providerId !== 'string' ||
          !/^[A-Za-z0-9._-]{2,80}$/.test(raw.providerId) ||
          !['account', 'project'].includes(raw.scope) ||
          (raw.scope === 'project' && raw.projectId !== project) ||
          (raw.scope === 'account' && raw.projectId != null) ||
          !Number.isSafeInteger(raw.quotaBytes) || raw.quotaBytes < 1 ||
          !Number.isSafeInteger(raw.usedBytes) || raw.usedBytes < 0 ||
          raw.usedBytes > raw.quotaBytes || !validTimestamp) {
        reject('Provider quota response is malformed or has an invalid scope.',
          'HFM_DRIVE_QUOTA_INVALID');
      }
      return Object.freeze({
        status: 'REPORTED', providerQuotaAvailable: true,
        providerId: raw.providerId, scope: raw.scope,
        projectId: raw.scope === 'project' ? project : null,
        measuredAt: raw.measuredAt, quotaBytes: raw.quotaBytes,
        usedBytes: raw.usedBytes, availableBytes: raw.quotaBytes - raw.usedBytes
      });
    },

    async putIfAbsent(input = {}) {
      const provider = await negotiateCapabilities();
      if (input.projectId !== project) reject('Cross-project upload rejected.', 'HFM_DRIVE_PROJECT_SCOPE');
      const backupId = validId(input.backupId, 'backupId');
      const key = expectedKey(backupId);
      if (input.objectKey !== key) reject('Object key is outside the dedicated project namespace.', 'HFM_DRIVE_NAMESPACE_REJECTED');
      const bytes = bytesCopy(input.bytes);
      if (bytes.length > provider.maxObjectBytes) {
        reject('Encrypted object exceeds the negotiated provider limit.', 'HFM_DRIVE_OBJECT_TOO_LARGE');
      }
      if (input.contentType !== 'application/vnd.mira.hfm-encrypted-backup' ||
          input.encryption !== 'AES-256-GCM' ||
          typeof input.ciphertextSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.ciphertextSha256) ||
          sha256(bytes) !== input.ciphertextSha256) {
        reject('Only a digest-bound AES-256-GCM backup envelope is accepted.');
      }
      const metadata = Object.freeze({
        projectId: project, backupId, objectKey: key,
        contentType: input.contentType, encryption: input.encryption,
        ciphertextSha256: input.ciphertextSha256, bytes: bytes.length
      });
      const expected = {
        projectId: project, backupId, objectKey: key,
        ciphertextSha256: input.ciphertextSha256, bytes
      };
      let result;
      try {
        // Must be a provider-side atomic create-if-absent; search-then-upload is non-compliant.
        result = await transport.atomicCreate({
          objectKey: key, metadata, bytes: Buffer.from(bytes)
        });
      } catch (_) {
        const recovered = await readForReconciliation(expected);
        if (recovered) return { created: false, reconciled: true };
        reject('Create outcome is unknown and no matching object can be verified.',
          'HFM_DRIVE_CREATE_UNCERTAIN');
      }
      if (!result || typeof result.created !== 'boolean') {
        const recovered = await readForReconciliation(expected);
        if (recovered) return { created: false, reconciled: true };
        reject('Transport returned an uncertain create result with no matching readback.',
          'HFM_DRIVE_CREATE_UNCERTAIN');
      }
      const readback = await readForReconciliation(expected);
      if (!readback) reject('Create result was not visible during exact-byte readback.',
        'HFM_DRIVE_READBACK_FAILED');
      if (result.created === true) return { created: true, reconciled: false };
      return { created: false, reconciled: false, alreadyPresent: true };
    },

    async get(input = {}) {
      await negotiateCapabilities();
      if (input.projectId !== project) reject('Cross-project read rejected.', 'HFM_DRIVE_PROJECT_SCOPE');
      const match = typeof input.objectKey === 'string' &&
        input.objectKey.match(new RegExp('^' +
          namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/' +
          project + '/([A-Za-z0-9][A-Za-z0-9._-]{7,95})\\.mhe$'));
      if (!match) reject('Object key is outside the dedicated project namespace.', 'HFM_DRIVE_NAMESPACE_REJECTED');
      const item = await transport.readObject({ objectKey: input.objectKey });
      if (!item) return null;
      const metadata = item.metadata;
      const provider = await negotiateCapabilities();
      if (!metadata || metadata.projectId !== project || metadata.backupId !== match[1] ||
          metadata.objectKey !== input.objectKey || !Buffer.isBuffer(item.bytes) ||
          !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 1 ||
          metadata.bytes > provider.maxObjectBytes || item.bytes.length !== metadata.bytes ||
          item.bytes.length > provider.maxObjectBytes ||
          metadata.contentType !== 'application/vnd.mira.hfm-encrypted-backup' ||
          metadata.encryption !== 'AES-256-GCM' ||
          typeof metadata.ciphertextSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(metadata.ciphertextSha256) ||
          sha256(item.bytes) !== metadata.ciphertextSha256) {
        reject('Transport object metadata, digest, or byte length failed project binding.',
          'HFM_DRIVE_OBJECT_INVALID');
      }
      return { projectId: project, backupId: match[1], bytes: Buffer.from(item.bytes) };
    },

    async list(input = {}) {
      const provider = await negotiateCapabilities();
      if (input.projectId !== project || input.prefix !== prefix) {
        reject('Listing is restricted to the configured project prefix.', 'HFM_DRIVE_PROJECT_SCOPE');
      }
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_PAGE_SIZE) {
        reject('Listing page size is outside the adapter bounded limit.');
      }
      const effectiveLimit = Math.min(input.limit, provider.maxPageSize);
      const page = await transport.listPage({
        projectId: project, prefix,
        cursor: input.cursor === undefined ? null : input.cursor,
        limit: effectiveLimit
      });
      if (!page || !Array.isArray(page.items) || page.items.length > effectiveLimit ||
          typeof page.complete !== 'boolean' ||
          (!page.complete && (typeof page.nextCursor !== 'string' || !page.nextCursor)) ||
          (page.complete && page.nextCursor != null)) {
        reject('Transport returned an invalid explicit pagination envelope.', 'HFM_DRIVE_LIST_INVALID');
      }
      const items = page.items.map(item => {
        if (!item || !item.metadata) reject('Listed object is missing bound metadata.', 'HFM_DRIVE_OBJECT_INVALID');
        const m = item.metadata;
        const key = expectedKey(m.backupId);
        const createdAtMs = typeof m.createdAt === 'string' ? Date.parse(m.createdAt) : NaN;
        if (m.projectId !== project || m.objectKey !== key ||
            !Number.isFinite(createdAtMs) || new Date(createdAtMs).toISOString() !== m.createdAt ||
            !Number.isSafeInteger(m.bytes) || m.bytes < 1) {
          reject('Listed object metadata is invalid or cross-project.', 'HFM_DRIVE_OBJECT_INVALID');
        }
        return {
          projectId: project, backupId: m.backupId, objectKey: key,
          createdAt: m.createdAt, bytes: m.bytes
        };
      });
      return {
        items, complete: page.complete,
        nextCursor: page.complete ? undefined : page.nextCursor
      };
    }
  });
}

module.exports = { createEmergencyBackupTransportAdapter, MAX_PAGE_SIZE, MAX_ENVELOPE_BYTES };
