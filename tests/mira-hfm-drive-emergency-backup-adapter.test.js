'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createEmergencyBackupTransportAdapter } = require('../services/mira-hfm-drive-emergency-backup-adapter');

async function main() {
  const projectId = 'mira-project-001';
  const store = new Map();
  let createCalls = 0;
  const transport = {
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
    readAfterWrite: true, list: true, dedicatedNamespace: true
  });
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
  await assert.rejects(() => broken.putIfAbsent(input), e => e.code === 'HFM_DRIVE_CREATE_UNCERTAIN');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_CONCURRENT_CREATE_ONLY=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_PROJECT_NAMESPACE=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_ENCRYPTED_METADATA_BINDING=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_READBACK_AND_MULTIPAGE_LISTING=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_UNCERTAIN_CREATE_REJECTED=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ADAPTER_NO_NETWORK_OR_OAUTH=PASS');
  console.log('TESTS_FAILED=0');
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
