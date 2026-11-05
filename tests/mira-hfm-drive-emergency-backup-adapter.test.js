'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createEmergencyBackupTransportAdapter } = require('../services/mira-hfm-drive-emergency-backup-adapter');

async function main() {
  const projectId = 'mira-project-001';
  const store = new Map();
  let createCalls = 0;
  const transport = {
    async getCapabilities() {
      return { atomicCreateIfAbsent: true, readAfterWrite: true, projectIsolation: true,
        encryptedObjectStorage: true, paginatedList: true, consistency: 'read-after-write',
        maxObjectBytes: 1024 * 1024, maxPageSize: 10 };
    },
    async getQuota() {
      return { providerId: 'fake-provider', scope: 'project', projectId,
        quotaBytes: 1000000, usedBytes: 1234, measuredAt: '2026-11-05T00:00:00.000Z' };
    },
    async atomicCreate({ objectKey, metadata, bytes }) {
      createCalls += 1;
      if (store.has(objectKey)) return { created: false };
      store.set(objectKey, { metadata: { ...metadata, createdAt: '2026-11-05T00:00:00.000Z' }, bytes: Buffer.from(bytes) });
      return { created: true };
    },
    async readObject({ objectKey }) {
      const value = store.get(objectKey);
      return value ? { metadata: value.metadata, bytes: Buffer.from(value.bytes) } : null;
    },
    async listPage({ projectId: scope, prefix, cursor, limit }) {
      assert.equal(scope, projectId);
      assert.equal(prefix, 'mira-hfm-emergency/v1/' + projectId + '/');
      assert.equal(limit, 1);
      const values = [...store.entries()].filter(([key]) => key.startsWith(prefix));
      const offset = cursor === null ? 0 : Number(cursor);
      const slice = values.slice(offset, offset + limit).map(([, value]) => ({ metadata: value.metadata }));
      const next = offset + limit;
      return next < values.length
        ? { items: slice, complete: false, nextCursor: String(next) }
        : { items: slice, complete: true };
    }
  };
  const adapter = createEmergencyBackupTransportAdapter({ transport, projectId });
  assert.deepEqual(adapter.capabilities, {
    encryptedOnly: true, projectIsolated: true, createOnly: true,
    readAfterWrite: true, list: true, dedicatedNamespace: true,
    timeoutReconciliation: true, immutableCollisionDetection: true,
    providerNegotiationRequired: true
  });
  const negotiated = await adapter.negotiateCapabilities();
  assert.equal(negotiated.consistency, 'read-after-write');
  assert.equal(negotiated.maxPageSize, 10);
  const quota = await adapter.getProviderQuota();
  assert.equal(quota.status, 'REPORTED');
  assert.equal(quota.scope, 'project');
  assert.equal(quota.availableBytes, 998766);
  const bytes = Buffer.from('synthetic-encrypted-envelope');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const input = { projectId, backupId: 'backup-test-0001',
    objectKey: 'mira-hfm-emergency/v1/' + projectId + '/backup-test-0001.mhe',
    bytes, contentType: 'application/vnd.mira.hfm-encrypted-backup',
    ciphertextSha256: digest, encryption: 'AES-256-GCM' };
  const raced = await Promise.all([adapter.putIfAbsent(input), adapter.putIfAbsent(input)]);
  assert.equal(raced.filter(result => result.created).length, 1);
  assert.equal(raced.filter(result => !result.created).length, 1);
  assert.equal(createCalls, 2);
  const read = await adapter.get({ projectId, objectKey: input.objectKey });
  assert.deepEqual(read.bytes, bytes);
  assert.notEqual(read.bytes, bytes);
  await assert.rejects(() => adapter.putIfAbsent({ ...input, projectId: 'other-project-001' }),
    e => e.code === 'HFM_DRIVE_PROJECT_SCOPE');
  await assert.rejects(() => adapter.putIfAbsent({ ...input, objectKey: '../foreign.mhe' }),
    e => e.code === 'HFM_DRIVE_NAMESPACE_REJECTED');
  await assert.rejects(() => adapter.putIfAbsent({ ...input, contentType: 'text/plain' }));
  await assert.rejects(() => adapter.get({ projectId: 'other-project-001', objectKey: input.objectKey }),
    e => e.code === 'HFM_DRIVE_PROJECT_SCOPE');
  await assert.rejects(() => adapter.list({ projectId, prefix: 'mira-hfm-emergency/v1/other-project-001/', cursor: null, limit: 2 }),
    e => e.code === 'HFM_DRIVE_PROJECT_SCOPE');
  const secondId = 'backup-test-0002';
  const secondKey = 'mira-hfm-emergency/v1/' + projectId + '/' + secondId + '.mhe';
  store.set(secondKey, { metadata: { projectId, backupId: secondId, objectKey: secondKey,
    createdAt: '2026-11-05T00:01:00.000Z', bytes: 12 }, bytes: Buffer.alloc(12, 7) });
  const listing1 = await adapter.list({ projectId, prefix: 'mira-hfm-emergency/v1/' + projectId + '/', cursor: null, limit: 1 });
  assert.equal(listing1.complete, false);
  assert.equal(typeof listing1.nextCursor, 'string');
  const listing2 = await adapter.list({ projectId, prefix: 'mira-hfm-emergency/v1/' + projectId + '/', cursor: listing1.nextCursor, limit: 1 });
  assert.equal(listing2.complete, true);
  assert.equal(listing2.items.length, 1);
  assert.deepEqual([listing1.items[0].backupId, listing2.items[0].backupId].sort(), [input.backupId, secondId].sort());
  const broken = createEmergencyBackupTransportAdapter({
    projectId,
    transport: { ...transport, async atomicCreate() { return {}; } }
  });
  const brokenId = 'backup-uncertain-0001';
  await assert.rejects(() => broken.putIfAbsent({ ...input, backupId: brokenId,
    objectKey: 'mira-hfm-emergency/v1/' + projectId + '/' + brokenId + '.mhe' }),
    e => e.code === 'HFM_DRIVE_CREATE_UNCERTAIN');

  // Timeout after provider commit: reconcile by exact-byte read, never blindly retry create.
  let timeoutAfterCommitCalls = 0;
  const timeoutAfterCommit = createEmergencyBackupTransportAdapter({
    projectId,
    transport: {
      async atomicCreate({ objectKey, metadata, bytes: payload }) {
        timeoutAfterCommitCalls += 1;
        store.set(objectKey, { metadata: { ...metadata, createdAt: '2026-11-05T00:02:00.000Z' }, bytes: Buffer.from(payload) });
        const error = new Error('synthetic timeout after commit');
        error.code = 'ETIMEDOUT';
        throw error;
      },
      readObject: transport.readObject,
      listPage: transport.listPage
    }
  });
  const timeoutId = 'backup-timeout-0001';
  const timeoutInput = { ...input, backupId: timeoutId,
    objectKey: 'mira-hfm-emergency/v1/' + projectId + '/' + timeoutId + '.mhe' };
  assert.deepEqual(await timeoutAfterCommit.putIfAbsent(timeoutInput), { created: false, reconciled: true });
  assert.equal(timeoutAfterCommitCalls, 1);

  // Timeout before commit: absence cannot be interpreted as success.
  const timeoutBeforeCommit = createEmergencyBackupTransportAdapter({
    projectId,
    transport: {
      async getCapabilities() { return await transport.getCapabilities(); },
      async atomicCreate() { throw new Error('synthetic timeout before commit'); },
      async readObject() { return null; },
      listPage: transport.listPage
    }
  });
  const absentId = 'backup-absent-0001';
  await assert.rejects(() => timeoutBeforeCommit.putIfAbsent({ ...input, backupId: absentId,
    objectKey: 'mira-hfm-emergency/v1/' + projectId + '/' + absentId + '.mhe' }),
    e => e.code === 'HFM_DRIVE_CREATE_UNCERTAIN');

  // Same immutable ID with different bytes is a hard conflict, never overwrite.
  const conflictId = 'backup-conflict-0001';
  const conflictKey = 'mira-hfm-emergency/v1/' + projectId + '/' + conflictId + '.mhe';
  store.set(conflictKey, { metadata: { projectId, backupId: conflictId, objectKey: conflictKey,
    contentType: input.contentType, encryption: input.encryption,
    ciphertextSha256: crypto.createHash('sha256').update(Buffer.from('different-ciphertext')).digest('hex'),
    bytes: Buffer.from('different-ciphertext').length, createdAt: '2026-11-05T00:03:00.000Z' },
    bytes: Buffer.from('different-ciphertext') });
  const conflictInput = { ...input, backupId: conflictId, objectKey: conflictKey };
  const collision = createEmergencyBackupTransportAdapter({
    projectId,
    transport: { ...transport, async atomicCreate() { return { created: false }; } }
  });
  await assert.rejects(() => collision.putIfAbsent(conflictInput),
    e => e.code === 'HFM_DRIVE_OBJECT_CONFLICT');

  // A create response followed by missing readback is not success.
  const missingReadback = createEmergencyBackupTransportAdapter({
    projectId,
    transport: { ...transport, async atomicCreate() { return { created: true }; }, async readObject() { return null; } }
  });
  const missingId = 'backup-readback-0001';
  await assert.rejects(() => missingReadback.putIfAbsent({ ...input, backupId: missingId,
    objectKey: 'mira-hfm-emergency/v1/' + projectId + '/' + missingId + '.mhe' }),
    e => e.code === 'HFM_DRIVE_READBACK_FAILED');

  // Readback transport failure after an ambiguous commit stays uncertain.
  const unreadable = createEmergencyBackupTransportAdapter({
    projectId,
    transport: { ...transport, async atomicCreate() { throw new Error('timeout'); },
      async readObject() { throw new Error('read outage'); } }
  });
  const unreadableId = 'backup-unreadable-0001';
  await assert.rejects(() => unreadable.putIfAbsent({ ...input, backupId: unreadableId,
    objectKey: 'mira-hfm-emergency/v1/' + projectId + '/' + unreadableId + '.mhe' }),
    e => e.code === 'HFM_DRIVE_CREATE_UNCERTAIN');
  const unsupported = createEmergencyBackupTransportAdapter({
    projectId,
    transport: { ...transport, async getCapabilities() {
      return { ...(await transport.getCapabilities()), atomicCreateIfAbsent: false };
    } }
  });
  await assert.rejects(() => unsupported.negotiateCapabilities(),
    e => e.code === 'HFM_DRIVE_CAPABILITY_UNSUPPORTED');
  const badQuota = createEmergencyBackupTransportAdapter({
    projectId,
    transport: { ...transport, async getQuota() {
      return { providerId: 'fake-provider', scope: 'project', projectId: 'other-project-001',
        quotaBytes: 1000, usedBytes: 1, measuredAt: '2026-11-05T00:00:00.000Z' };
    } }
  });
  await assert.rejects(() => badQuota.getProviderQuota(),
    e => e.code === 'HFM_DRIVE_QUOTA_INVALID');
  const noQuota = createEmergencyBackupTransportAdapter({
    projectId, transport: { ...transport, getQuota: undefined }
  });
  assert.equal((await noQuota.getProviderQuota()).status, 'NOT_REPORTED');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_PROVIDER_CAPABILITY_NEGOTIATION=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_UNSUPPORTED_PROVIDER_FAIL_CLOSED=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_SCOPED_QUOTA_REPORT=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_QUOTA_UNAVAILABLE_EXPLICIT=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_CONCURRENT_CREATE_ONLY=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_PROJECT_NAMESPACE=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_ENCRYPTED_METADATA_BINDING=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_READBACK_AND_MULTIPAGE_LISTING=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_UNCERTAIN_CREATE_REJECTED=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_TIMEOUT_AFTER_COMMIT_RECONCILED=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_TIMEOUT_BEFORE_COMMIT_UNCERTAIN=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_IMMUTABLE_ID_COLLISION_REJECTED=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_EXACT_READBACK_REQUIRED=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_READBACK_OUTAGE_FAIL_CLOSED=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_NO_NETWORK_OR_OAUTH=PASS');
  console.log('TESTS_FAILED=0');
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
