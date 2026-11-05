'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const backup = require('../services/mira-hfm-emergency-backup');
const driveBackup = require('../services/mira-hfm-google-drive-backup-adapter');

const kek = crypto.randomBytes(32);
const keyProvider = {
  async wrapDataKey({ dataKey }) {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', kek, nonce);
    const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return Buffer.from(JSON.stringify({ nonce: nonce.toString('base64'), encrypted: encrypted.toString('base64'),
      tag: cipher.getAuthTag().toString('base64') })).toString('base64');
  },
  async unwrapDataKey({ wrappedDataKey }) {
    const item = JSON.parse(Buffer.from(wrappedDataKey, 'base64').toString('utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(item.nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(item.encrypted, 'base64')), decipher.final()]);
  }
};
(async () => {
  const encrypted = await backup.encryptSnapshot({
    snapshot: { records: [{ id: 'r1' }] },
    metadata: { schemaVersion: '1.0.0', projectId: 'project-1', sourceRevision: 'rev-1',
      recordCount: 1, keyId: 'test-kek', keyVersion: '1' }, keyProvider
  });
  let stored = null;
  let creates = 0;
  const drive = {
    about: { get: async () => ({ data: { storageQuota: { usage: '100', limit: '10000000000' } } }) },
    files: {
      list: async () => ({ data: { files: stored ? [{ id: 'remote-1', name: 'existing' }] : [] } }),
      create: async args => {
        creates++;
        const chunks = [];
        for await (const chunk of args.media.body) chunks.push(Buffer.from(chunk));
        stored = Buffer.concat(chunks);
        return { data: { id: 'remote-1', name: args.requestBody.name } };
      },
      get: async () => ({ data: Buffer.from(stored) })
    }
  };
  const uploaded = await driveBackup.uploadEncryptedBackup({
    drive, folderId: 'folder_123', fileName: 'mira-hfm-project-1-20261105T120000Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  });
  assert.equal(uploaded.status, 'VERIFIED');
  assert.equal(creates, 1);
  const downloaded = await driveBackup.downloadEncryptedBackup({
    drive, fileId: uploaded.fileId, expectedSha256: encrypted.sha256
  });
  assert.equal(downloaded.status, 'DOWNLOADED_UNVERIFIED');
  assert.deepEqual(downloaded.bytes, encrypted.bytes);
  await assert.rejects(() => driveBackup.uploadEncryptedBackup({
    drive, folderId: 'folder_123', fileName: 'mira-hfm-project-1-20261105T120000Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  }), error => error.code === 'DRIVE_BACKUP_ALREADY_EXISTS');
  const fullDrive = { ...drive, about: { get: async () => ({ data: { storageQuota: { usage: '999999', limit: '10000000' } } }) } };
  await assert.rejects(() => driveBackup.uploadEncryptedBackup({
    drive: fullDrive, folderId: 'folder_123', fileName: 'mira-hfm-project-1-20261106T120000Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  }), error => error.code === 'DRIVE_BACKUP_QUOTA_EXCEEDED');
  process.stdout.write('MIRA_HFM_PHASE7_GOOGLE_DRIVE_ADAPTER_PASS\nNETWORK_REQUESTS=0\nLIVE_DRIVE_API_CALLS=0\nBACKUP_DELETION=0\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
