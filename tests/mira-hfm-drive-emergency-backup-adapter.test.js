'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  createEmergencyBackupTransportAdapter,
  MAX_PAGE_SIZE
} = require('../services/mira-hfm-drive-emergency-backup-adapter');

const projectId = 'project01';
const backupId = 'backup001';
const objectKey = 'mira-hfm-emergency/v1/' + projectId + '/' + backupId + '.mhe';
const bytes = Buffer.from('encrypted-envelope-fixture');
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const objects = new Map();

const transport = {
  async atomicCreate(input) {
    if (objects.has(input.objectKey)) return { created: false };
    objects.set(input.objectKey, {
      metadata: {
        ...input.metadata,
        createdAt: '2026-11-05T00:00:00.000Z'
      },
      bytes: Buffer.from(input.bytes)
    });
    return { created: true };
  },
  async readObject({ objectKey: key }) {
    const value = objects.get(key);
    return value ? {
      metadata: { ...value.metadata },
      bytes: Buffer.from(value.bytes)
    } : null;
  },
  async listPage({ projectId: id, prefix, cursor, limit }) {
    assert.equal(id, projectId);
    assert.equal(prefix, 'mira-hfm-emergency/v1/' + projectId + '/');
    assert.equal(cursor, null);
    assert.ok(limit >= 1 && limit <= MAX_PAGE_SIZE);
    return {
      items: [...objects.values()].map(value => ({
        metadata: { ...value.metadata }
      })),
      complete: true,
      nextCursor: null
    };
  }
};

async function main() {
  const adapter = createEmergencyBackupTransportAdapter({ transport, projectId });

  assert.deepEqual(adapter.capabilities, {
    encryptedOnly: true,
    projectIsolated: true,
    createOnly: true,
    readAfterWrite: true,
    list: true,
    dedicatedNamespace: true
  });

  const created = await adapter.putIfAbsent({
    projectId,
    backupId,
    objectKey,
    bytes,
    contentType: 'application/vnd.mira.hfm-encrypted-backup',
    encryption: 'AES-256-GCM',
    ciphertextSha256: digest
  });
  assert.deepEqual(created, { created: true });

  const duplicate = await adapter.putIfAbsent({
    projectId,
    backupId,
    objectKey,
    bytes,
    contentType: 'application/vnd.mira.hfm-encrypted-backup',
    encryption: 'AES-256-GCM',
    ciphertextSha256: digest
  });
  assert.deepEqual(duplicate, { created: false });

  const read = await adapter.get({ projectId, objectKey });
  assert.equal(read.projectId, projectId);
  assert.equal(read.backupId, backupId);
  assert.deepEqual(read.bytes, bytes);

  const listed = await adapter.list({
    projectId,
    prefix: 'mira-hfm-emergency/v1/' + projectId + '/',
    limit: 20
  });
  assert.equal(listed.complete, true);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].objectKey, objectKey);

  await assert.rejects(
    adapter.putIfAbsent({
      projectId: 'otherproj',
      backupId,
      objectKey,
      bytes,
      contentType: 'application/vnd.mira.hfm-encrypted-backup',
      encryption: 'AES-256-GCM',
      ciphertextSha256: digest
    }),
    error => error.code === 'HFM_DRIVE_PROJECT_SCOPE'
  );

  await assert.rejects(
    adapter.get({ projectId, objectKey: 'mira-hfm-emergency/v1/otherproj/' + backupId + '.mhe' }),
    error => error.code === 'HFM_DRIVE_NAMESPACE_REJECTED'
  );

  await assert.rejects(
    adapter.putIfAbsent({
      projectId,
      backupId,
      objectKey,
      bytes,
      contentType: 'text/plain',
      encryption: 'AES-256-GCM',
      ciphertextSha256: digest
    })
  );

  await assert.rejects(
    adapter.list({
      projectId,
      prefix: 'mira-hfm-emergency/v1/' + projectId + '/',
      limit: MAX_PAGE_SIZE + 1
    })
  );

  assert.throws(
    () => createEmergencyBackupTransportAdapter({
      transport,
      projectId,
      namespace: 'shared/general'
    })
  );

  assert.throws(
    () => createEmergencyBackupTransportAdapter({
      transport: { atomicCreate() {}, readObject() {} },
      projectId
    })
  );

  console.log('HFM_PHASE7_TRANSPORT_ATOMIC_CREATE_AND_DUPLICATE_PROTECTION=PASS');
  console.log('HFM_PHASE7_TRANSPORT_PROJECT_ISOLATION=PASS');
  console.log('HFM_PHASE7_TRANSPORT_ENCRYPTED_ENVELOPE_GATES=PASS');
  console.log('HFM_PHASE7_TRANSPORT_READ_AFTER_WRITE=PASS');
  console.log('HFM_PHASE7_TRANSPORT_BOUNDED_PAGINATION=PASS');
  console.log('LIVE_DRIVE_REQUESTS=0');
  console.log('OAUTH_REQUESTS=0');
  console.log('PLAINTEXT_UPLOADS=0');
  console.log('TESTS_FAILED=0');
}

main().catch(error => {
  process.stderr.write(error.stack + '\\n');
  process.exitCode = 1;
});
