'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createEncryptedBackup } = require('../services/mira-hfm-encrypted-emergency-backup');
const { createGoogleDriveGeneratedIdProvider, getGoogleDriveAccountFingerprint } = require('../services/mira-hfm-google-drive-generated-id-provider');
const { CONTENT_TYPE } = require('../services/mira-hfm-drive-generated-id-upload');

const permissionId = 'synthetic-google-drive-permission-001';
const accountBinding = crypto.createHash('sha256').update(permissionId).digest('hex');
const driveSpace = 'drive';
const parentId = 'dedicated-folder-123456';
const projectId = 'mira-project-001';
const backupId = 'backup-google-provider-0001';
const fileId = 'aBcdEF0123456789_-xy';
const key = Buffer.alloc(32, 11);
const envelope = createEncryptedBackup({
  payload: Buffer.from('synthetic provider contract payload'), key, backupId,
  createdAt: '2026-11-05T00:00:00.000Z', metadata: { projectId }
});
const digest = crypto.createHash('sha256').update(envelope).digest('hex');
const header = JSON.parse(envelope.toString('utf8'));

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function fakeDrive() {
  const calls = { generate: 0, create: 0, metadataGet: 0, mediaGet: 0, list: 0, about: 0 };
  const files = new Map();
  const drive = { files: {
    async generateIds(args) {
      calls.generate += 1;
      assert.equal(args.count, 1);
      assert.equal(args.space, driveSpace);
      assert.equal(args.type, 'files');
      return { data: { ids: [fileId], space: driveSpace } };
    },
    async create(args) {
      calls.create += 1;
      assert.equal(args.uploadType, 'resumable');
      assert.equal(args.requestBody.id, fileId);
      assert.equal(args.requestBody.mimeType, CONTENT_TYPE);
      assert.deepEqual(args.requestBody.parents, [parentId]);
      const bytes = await collect(args.media.body);
      assert.deepEqual(bytes, envelope);
      files.set(fileId, {
        id: fileId, mimeType: args.requestBody.mimeType,
        parents: [...args.requestBody.parents],
        appProperties: { ...args.requestBody.appProperties },
        size: String(bytes.length), createdTime: '2026-11-05T00:00:01.000Z',
        bytes
      });
      return { data: { id: fileId } };
    },
    async list(args) {
      calls.list += 1;
      assert.equal(args.q, "'" + parentId + "' in parents and trashed = false");
      assert.equal(args.spaces, driveSpace);
      assert.equal(args.pageSize, 1);
      const item = files.get(fileId);
      if (args.pageToken == null) return { data: {
        files: item ? [{
          id: item.id, mimeType: item.mimeType, parents: item.parents,
          appProperties: item.appProperties, size: item.size, createdTime: item.createdTime
        }] : [], nextPageToken: 'page-2'
      } };
      assert.equal(args.pageToken, 'page-2');
      return { data: { files: [] } };
    },
    async get(args, options) {
      const item = files.get(args.fileId);
      if (!item) {
        const error = new Error('not found');
        error.code = 404;
        throw error;
      }
      if (args.alt === 'media') {
        calls.mediaGet += 1;
        assert.equal(options.responseType, 'stream');
        return { data: Readable.from([Buffer.from(item.bytes)]) };
      }
      calls.metadataGet += 1;
      return { data: {
        id: item.id, mimeType: item.mimeType, parents: [...item.parents],
        appProperties: { ...item.appProperties }, size: item.size, createdTime: item.createdTime
      } };
    }
  } };
  drive.about = {
    async get(args) {
      calls.about += 1;
      assert.ok(args.fields.includes('permissionId'));
      return { data: {
        user: { me: true, permissionId },
        storageQuota: { limit: '15000000000', usage: '6000000000',
          usageInDrive: '3000000000', usageInDriveTrash: '1000000' }
      } };
    }
  };
  return { drive, calls, files };
}

async function main() {
  const fake = fakeDrive();
  const provider = createGoogleDriveGeneratedIdProvider({
    drive: fake.drive, accountBinding, getAccountFingerprint: async () => accountBinding,
    driveSpace, projectId, parentId
  });
  const generated = await provider.generateFileId({ accountBinding, driveSpace });
  assert.equal(generated.id, fileId);
  const created = await provider.createFile({
    id: fileId, parents: [parentId], mimeType: CONTENT_TYPE, bytes: envelope,
    accountBinding, driveSpace,
    appProperties: {
      projectId, backupId, schema: header.schema, version: header.version,
      createdAt: header.createdAt, ciphertextSha256: digest,
      bytes: String(envelope.length), encryption: 'AES-256-GCM'
    }
  });
  assert.equal(created.id, fileId);
  assert.equal(created.created, true);
  await assert.rejects(() => provider.createFile({
    id: fileId, parents: [parentId], mimeType: CONTENT_TYPE, bytes: envelope,
    accountBinding, driveSpace,
    appProperties: {
      projectId, backupId, schema: header.schema, version: header.version,
      createdAt: header.createdAt, ciphertextSha256: 'a'.repeat(64),
      bytes: String(envelope.length), encryption: 'AES-256-GCM'
    }
  }), error => error.code === 'HFM_GOOGLE_DRIVE_PROVIDER_INVALID');
  assert.equal(fake.calls.create, 1);
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_GENERATE_ID_AND_RESUMABLE_CREATE_MAPPING=PASS');
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_UPLOAD_DIGEST_RECHECK=PASS');

  const metadata = await provider.getFile({ id: fileId, accountBinding, driveSpace });
  assert.equal(metadata.id, fileId);
  assert.equal(metadata.metadata.projectId, projectId);
  assert.equal(metadata.metadata.backupSchema, header.schema);
  assert.equal(metadata.metadata.backupVersion, header.version);
  assert.equal(metadata.metadata.backupCreatedAt, header.createdAt);
  assert.equal(metadata.metadata.parentId, parentId);
  const downloaded = await provider.downloadFile({ id: fileId, accountBinding, driveSpace });
  assert.deepEqual(downloaded, envelope);
  assert.equal(crypto.createHash('sha256').update(downloaded).digest('hex'), digest);
  assert.deepEqual(fake.calls, { generate: 1, create: 1, metadataGet: 1, mediaGet: 1, list: 0, about: 0 });
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_METADATA_AND_EXACT_MEDIA_READBACK=PASS');

  const firstPage = await provider.listPage({
    projectId, prefix: 'mira-hfm-emergency/v1/' + projectId + '/', cursor: null, limit: 1
  });
  assert.equal(firstPage.complete, false);
  assert.equal(firstPage.items[0].metadata.backupId, backupId);
  const secondPage = await provider.listPage({
    projectId, prefix: 'mira-hfm-emergency/v1/' + projectId + '/',
    cursor: firstPage.nextCursor, limit: 1
  });
  assert.equal(secondPage.complete, true);
  assert.equal(secondPage.items.length, 0);
  await assert.rejects(() => provider.listPage({
    projectId, prefix: 'mira-hfm-emergency/v1/' + projectId + '/',
    cursor: 'bad\npage-token', limit: 1
  }), error => error.code === 'HFM_GOOGLE_DRIVE_LIST_SCOPE');
  fake.drive.files.list = async () => ({ data: { files: [], incompleteSearch: true } });
  await assert.rejects(() => provider.listPage({
    projectId, prefix: 'mira-hfm-emergency/v1/' + projectId + '/', cursor: null, limit: 1
  }), error => error.code === 'HFM_GOOGLE_DRIVE_LIST_INVALID');
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_PROJECT_SCOPED_PAGINATION=PASS');
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_INCOMPLETE_SEARCH_REJECTED=PASS');

  const quota = await provider.getQuota({ projectId });
  assert.equal(quota.providerId, 'google-drive-v3');
  assert.equal(quota.scope, 'account');
  assert.equal(quota.quotaBytes, 15000000000);
  assert.equal(quota.usedBytes, 6000000000);
  assert.equal(await getGoogleDriveAccountFingerprint(fake.drive), accountBinding);
  const defaultVerifierProvider = createGoogleDriveGeneratedIdProvider({
    drive: fake.drive, accountBinding, driveSpace, projectId, parentId
  });
  const verifiedGenerated = await defaultVerifierProvider.generateFileId({ accountBinding, driveSpace });
  assert.equal(verifiedGenerated.id, fileId);
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_ACCOUNT_IDENTITY_AND_QUOTA=PASS');
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_DEFAULT_ABOUT_ACCOUNT_VERIFIER=PASS');

  assert.equal(await provider.getFile({
    id: 'missingFileId_123456', accountBinding, driveSpace
  }), null);
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_NOT_FOUND_IS_EXPLICIT=PASS');

  const wrongAccount = createGoogleDriveGeneratedIdProvider({
    drive: fake.drive, accountBinding, getAccountFingerprint: async () => 'c'.repeat(64),
    driveSpace, projectId, parentId
  });
  await assert.rejects(() => wrongAccount.generateFileId({ accountBinding, driveSpace }),
    error => error.code === 'HFM_GOOGLE_DRIVE_ACCOUNT_SCOPE');
  assert.equal(fake.calls.generate, 2);
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_ACCOUNT_SCOPE_FAIL_CLOSED=PASS');

  const appDataFake = fakeDrive();
  appDataFake.drive.files.generateIds = async args => {
    assert.equal(args.space, 'appDataFolder');
    return { data: { ids: [fileId], space: 'appDataFolder' } };
  };
  const appDataProvider = createGoogleDriveGeneratedIdProvider({
    drive: appDataFake.drive, accountBinding, getAccountFingerprint: async () => accountBinding,
    driveSpace: 'appDataFolder', projectId, parentId: 'appDataFolder'
  });
  const appDataGenerated = await appDataProvider.generateFileId({
    accountBinding, driveSpace: 'appDataFolder'
  });
  assert.equal(appDataGenerated.id, fileId);
  assert.throws(() => createGoogleDriveGeneratedIdProvider({
    drive: appDataFake.drive, accountBinding, getAccountFingerprint: async () => accountBinding,
    driveSpace: 'appDataFolder', projectId, parentId
  }), error => error.code === 'HFM_GOOGLE_DRIVE_PROVIDER_INVALID');
  const badSpaceFake = fakeDrive();
  badSpaceFake.drive.files.generateIds = async () => ({
    data: { ids: [fileId], space: 'drive' }
  });
  const badSpace = createGoogleDriveGeneratedIdProvider({
    drive: badSpaceFake.drive, accountBinding, getAccountFingerprint: async () => accountBinding,
    driveSpace: 'appDataFolder', projectId, parentId: 'appDataFolder'
  });
  await assert.rejects(() => badSpace.generateFileId({ accountBinding, driveSpace: 'appDataFolder' }),
    error => error.code === 'HFM_GOOGLE_DRIVE_ID_RESPONSE_INVALID');
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_GENERATED_ID_SPACE_BINDING=PASS');
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_APPDATAFOLDER_PARENT_BOUND=PASS');

  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_NO_OAUTH_OR_NETWORK_CLIENT_CREATION=PASS');
  console.log('HFM_PHASE7_GOOGLE_DRIVE_V3_PROVIDER_TESTS_FAILED=0');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
