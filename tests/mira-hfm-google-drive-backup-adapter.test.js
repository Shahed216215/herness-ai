'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const backup = require('../services/mira-hfm-emergency-backup');
const driveBackup = require('../services/mira-hfm-google-drive-backup-adapter');

const kek = crypto.randomBytes(32);
const keyProvider = {
  descriptor: { contractVersion: '1', providerId: 'test-only-kek-fixture', providerVersion: '1',
    keyId: 'test-kek', keyVersion: '1', keyPurpose: 'MIRA_HFM_BACKUP', environment: 'test' },
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
  let storedFile = null;
  let creates = 0;
  const drive = {
    about: { get: async () => ({ data: { storageQuota: { usage: '100', limit: '10000000000' } } }) },
    files: {
      list: async () => ({ data: { files: storedFile ? [storedFile] : [] } }),
      create: async args => {
        creates++;
        const chunks = [];
        for await (const chunk of args.media.body) chunks.push(Buffer.from(chunk));
        stored = Buffer.concat(chunks);
        storedFile = { id: 'remote-1', name: args.requestBody.name, parents: args.requestBody.parents,
          appProperties: args.requestBody.appProperties };
        return { data: storedFile };
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
  let methodCaptureDrive;
  let methodCaptureFile = null;
  let methodCaptureBytes = null;
  const methodCaptureDriveOriginalCreate = async args => {
    const chunks = [];
    for await (const chunk of args.media.body) chunks.push(Buffer.from(chunk));
    methodCaptureBytes = Buffer.concat(chunks);
    methodCaptureFile = {
      id: 'remote-method-capture', name: args.requestBody.name,
      parents: args.requestBody.parents, appProperties: args.requestBody.appProperties
    };
    return { data: methodCaptureFile };
  };
  const methodCaptureDriveOriginalGet = async () => ({ data: Buffer.from(methodCaptureBytes) });
  const methodCaptureDriveOriginalQuota = async () =>
    ({ data: { storageQuota: { usage: '100', limit: '10000000000' } } });
  methodCaptureDrive = {
    about: { get: methodCaptureDriveOriginalQuota },
    files: {
      list: async () => {
        methodCaptureDrive.files.create = async () => { throw new Error('swapped create method must not run'); };
        methodCaptureDrive.about.get = async () => { throw new Error('swapped quota method must not run'); };
        return { data: { files: [] } };
      },
      create: methodCaptureDriveOriginalCreate,
      get: methodCaptureDriveOriginalGet
    }
  };
  const capturedMethodsUpload = await driveBackup.uploadEncryptedBackup({
    drive: methodCaptureDrive, folderId: 'folder_123',
    fileName: 'mira-hfm-project-1-20261105T120005Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  });
  assert.equal(capturedMethodsUpload.status, 'VERIFIED');
  assert.equal(capturedMethodsUpload.fileId, 'remote-method-capture');
  process.stdout.write('MIRA_HFM_DRIVE_ADAPTER_METHOD_SNAPSHOT_PASS\n');



  const malformedListDrive = {
    ...drive,
    files: { ...drive.files, list: async () => ({ data: { files: 'not-an-array' } }) }
  };
  await assert.rejects(() => driveBackup.uploadEncryptedBackup({
    drive: malformedListDrive, folderId: 'folder_123',
    fileName: 'mira-hfm-project-1-20261105T120001Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  }), error => error.code === 'DRIVE_BACKUP_DUPLICATE_CHECK_UNVERIFIED');
  assert.equal(creates, 1);

  const ambiguousDrive = {
    about: drive.about,
    files: {
      list: async () => ({ data: { files: [] } }),
      create: async () => { throw new Error('PRIVATE_REMOTE_CREATE_ERROR'); },
      get: async () => { throw new Error('must not read without a confirmed file ID'); }
    }
  };
  await assert.rejects(() => driveBackup.uploadEncryptedBackup({
    drive: ambiguousDrive, folderId: 'folder_123',
    fileName: 'mira-hfm-project-1-20261105T120002Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  }), error => error.code === 'DRIVE_BACKUP_CREATE_OUTCOME_UNKNOWN' &&
    error.stateCommitted === true && error.outcome === 'REVIEW_REQUIRED' &&
    !error.message.includes('PRIVATE_REMOTE_CREATE_ERROR'));

  let reconciledFile = null;
  const reconciledDrive = {
    about: drive.about,
    files: {
      list: async () => ({ data: { files: reconciledFile ? [reconciledFile] : [] } }),
      create: async args => {
        const chunks = [];
        for await (const chunk of args.media.body) chunks.push(Buffer.from(chunk));
        assert.deepEqual(Buffer.concat(chunks), encrypted.bytes);
        reconciledFile = {
          id: 'remote-reconciled', name: args.requestBody.name,
          parents: args.requestBody.parents, appProperties: args.requestBody.appProperties
        };
        throw new Error('PRIVATE_RESPONSE_LOST_AFTER_REMOTE_COMMIT');
      },
      get: async () => ({ data: Buffer.from(encrypted.bytes) })
    }
  };
  const reconciledUpload = await driveBackup.uploadEncryptedBackup({
    drive: reconciledDrive, folderId: 'folder_123',
    fileName: 'mira-hfm-project-1-20261105T120004Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  });
  assert.equal(reconciledUpload.status, 'VERIFIED_RECONCILED_AFTER_AMBIGUOUS_CREATE');
  assert.equal(reconciledUpload.fileId, 'remote-reconciled');

  const unverifiedCreateDrive = {
    about: drive.about,
    files: {
      list: async () => ({ data: { files: [] } }),
      create: async () => ({ data: { id: 'remote-unverified', name: 'wrong-name', parents: ['other-folder'], appProperties: {} } }),
      get: async () => { throw new Error('must not read unverified object'); }
    }
  };
  await assert.rejects(() => driveBackup.uploadEncryptedBackup({
    drive: unverifiedCreateDrive, folderId: 'folder_123',
    fileName: 'mira-hfm-project-1-20261105T120003Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  }), error => error.code === 'DRIVE_BACKUP_CREATE_RESPONSE_UNVERIFIED' &&
    error.stateCommitted === true && error.outcome === 'REVIEW_REQUIRED');

  const downloaded = await driveBackup.downloadEncryptedBackup({
    drive, fileId: uploaded.fileId, expectedSha256: encrypted.sha256
  });
  assert.equal(downloaded.status, 'DOWNLOADED_UNVERIFIED');
  assert.deepEqual(downloaded.bytes, encrypted.bytes);
  const idempotentReuse = await driveBackup.uploadEncryptedBackup({
    drive, folderId: 'folder_123', fileName: 'mira-hfm-project-1-20261105T120000Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  });
  assert.equal(idempotentReuse.status, 'VERIFIED_EXISTING_IDEMPOTENT');
  assert.equal(creates, 1);
  const fullButExistingDrive = {
    ...drive,
    about: { get: async () => ({ data: { storageQuota: { usage: '999999', limit: '10000000' } } }) }
  };
  const fullQuotaReuse = await driveBackup.uploadEncryptedBackup({
    drive: fullButExistingDrive, folderId: 'folder_123',
    fileName: 'mira-hfm-project-1-20261105T120000Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  });
  assert.equal(fullQuotaReuse.status, 'VERIFIED_EXISTING_IDEMPOTENT');
  assert.equal(fullQuotaReuse.quota, null);
  const conflictingExistingDrive = {
    ...drive,
    files: {
      ...drive.files,
      list: async () => ({ data: { files: [{
        ...storedFile,
        appProperties: { ...storedFile.appProperties, miraHfmSha256: '0'.repeat(64) }
      }] } })
    }
  };
  await assert.rejects(() => driveBackup.uploadEncryptedBackup({
    drive: conflictingExistingDrive, folderId: 'folder_123',
    fileName: 'mira-hfm-project-1-20261105T120000Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  }), error => error.code === 'DRIVE_BACKUP_ALREADY_EXISTS');
  assert.equal(creates, 1);


  const fullDrive = { ...drive, about: { get: async () => ({ data: { storageQuota: { usage: '999999', limit: '10000000' } } }) } };
  await assert.rejects(() => driveBackup.uploadEncryptedBackup({
    drive: fullDrive, folderId: 'folder_123', fileName: 'mira-hfm-project-1-20261106T120000Z.mira-hfm.enc.json',
    bytes: encrypted.bytes, projectId: 'project-1', allocatedLimitBytes: 1000000
  }), error => error.code === 'DRIVE_BACKUP_QUOTA_EXCEEDED');
  process.stdout.write('MIRA_HFM_PHASE7_GOOGLE_DRIVE_ADAPTER_PASS\nNETWORK_REQUESTS=0\nLIVE_DRIVE_API_CALLS=0\nBACKUP_DELETION=0\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
