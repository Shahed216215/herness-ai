'use strict';

// Offline/provider-neutral boundary for a future dedicated emergency-backup transport.
// This module performs no network or OAuth work. The injected transport owns atomicity.
const crypto = require('node:crypto');
const MAX_PAGE_SIZE = 500;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
function reject(message, code = 'HFM_DRIVE_ADAPTER_REJECTED') {
  const error = new Error(message); error.code = code; throw error;
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
  if (typeof namespace !== 'string' || !/^mira-hfm-emergency\/v1$/.test(namespace)) {
    reject('Only the dedicated emergency-backup namespace is permitted.');
  }
  if (!transport || typeof transport.atomicCreate !== 'function' ||
      typeof transport.readObject !== 'function' || typeof transport.listPage !== 'function') {
    reject('Transport must implement atomicCreate, readObject, and listPage.');
  }
  const prefix = namespace + '/' + project + '/';
  function expectedKey(backupId) {
    return prefix + validId(backupId, 'backupId') + '.mhe';
  }
  async function readForReconciliation(expected) {
    let item;
    try { item = await transport.readObject({ objectKey: expected.objectKey }); }
    catch (_) { reject('Create outcome could not be reconciled safely.', 'HFM_DRIVE_CREATE_UNCERTAIN'); }
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
      timeoutReconciliation: true, immutableCollisionDetection: true
    }),
    async putIfAbsent(input = {}) {
      if (input.projectId !== project) reject('Cross-project upload rejected.', 'HFM_DRIVE_PROJECT_SCOPE');
      const backupId = validId(input.backupId, 'backupId');
      const key = expectedKey(backupId);
      if (input.objectKey !== key) reject('Object key is outside the dedicated project namespace.', 'HFM_DRIVE_NAMESPACE_REJECTED');
      const bytes = bytesCopy(input.bytes);
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
      const expected = { projectId: project, backupId, objectKey: key,
        ciphertextSha256: input.ciphertextSha256, bytes };
      let result;
      try {
        // MUST be provider-side atomic create-if-absent; search-then-upload is non-compliant.
        result = await transport.atomicCreate({ objectKey: key, metadata, bytes: Buffer.from(bytes) });
      } catch (_) {
        // Timeout/error is ambiguous: never retry create blindly. Read the immutable key first.
        const recovered = await readForReconciliation(expected);
        if (recovered) return { created: false, reconciled: true };
        reject('Create outcome is unknown and no matching object can be verified.', 'HFM_DRIVE_CREATE_UNCERTAIN');
      }
      if (!result || typeof result.created !== 'boolean') {
        const recovered = await readForReconciliation(expected);
        if (recovered) return { created: false, reconciled: true };
        reject('Transport returned an uncertain create result with no matching readback.', 'HFM_DRIVE_CREATE_UNCERTAIN');
      }
      const readback = await readForReconciliation(expected);
      if (!readback) reject('Create result was not visible during exact-byte readback.', 'HFM_DRIVE_READBACK_FAILED');
      if (result.created === true) return { created: true, reconciled: false };
      return { created: false, reconciled: false, alreadyPresent: true };
    },
    async get(input = {}) {
      if (input.projectId !== project) reject('Cross-project read rejected.', 'HFM_DRIVE_PROJECT_SCOPE');
      const match = typeof input.objectKey === 'string' &&
        input.objectKey.match(new RegExp('^' + namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/' + project + '/([A-Za-z0-9][A-Za-z0-9._-]{7,95})\\.mhe$'));
      if (!match) reject('Object key is outside the dedicated project namespace.', 'HFM_DRIVE_NAMESPACE_REJECTED');
      const item = await transport.readObject({ objectKey: input.objectKey });
      if (!item) return null;
      const metadata = item.metadata;
      if (!metadata || metadata.projectId !== project || metadata.backupId !== match[1] ||
          metadata.objectKey !== input.objectKey || !Buffer.isBuffer(item.bytes) ||
          item.bytes.length !== metadata.bytes ||
          metadata.contentType !== 'application/vnd.mira.hfm-encrypted-backup' ||
          metadata.encryption !== 'AES-256-GCM' ||
          typeof metadata.ciphertextSha256 !== 'string' ||
          sha256(item.bytes) !== metadata.ciphertextSha256) {
        reject('Transport object metadata, digest, or byte length failed project binding.', 'HFM_DRIVE_OBJECT_INVALID');
      }
      return { projectId: project, backupId: match[1], bytes: Buffer.from(item.bytes) };
    },
    async list(input = {}) {
      if (input.projectId !== project || input.prefix !== prefix) {
        reject('Listing is restricted to the configured project prefix.', 'HFM_DRIVE_PROJECT_SCOPE');
      }
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_PAGE_SIZE) {
        reject('Listing page size is outside the bounded limit.');
      }
      const page = await transport.listPage({
        projectId: project, prefix, cursor: input.cursor === undefined ? null : input.cursor,
        limit: input.limit
      });
      if (!page || !Array.isArray(page.items) || typeof page.complete !== 'boolean' ||
          (!page.complete && (typeof page.nextCursor !== 'string' || !page.nextCursor)) ||
          (page.complete && page.nextCursor != null)) {
        reject('Transport returned an invalid explicit pagination envelope.', 'HFM_DRIVE_LIST_INVALID');
      }
      const items = page.items.map(item => {
        if (!item || !item.metadata) reject('Listed object is missing bound metadata.', 'HFM_DRIVE_OBJECT_INVALID');
        const m = item.metadata;
        const key = expectedKey(m.backupId);
        if (m.projectId !== project || m.objectKey !== key ||
            typeof m.createdAt !== 'string' || !Number.isSafeInteger(m.bytes) || m.bytes < 1) {
          reject('Listed object metadata is invalid or cross-project.', 'HFM_DRIVE_OBJECT_INVALID');
        }
        return { projectId: project, backupId: m.backupId, objectKey: key,
          createdAt: m.createdAt, bytes: m.bytes };
      });
      return { items, complete: page.complete, nextCursor: page.complete ? undefined : page.nextCursor };
    }
  });
}
module.exports = { createEmergencyBackupTransportAdapter, MAX_PAGE_SIZE };
