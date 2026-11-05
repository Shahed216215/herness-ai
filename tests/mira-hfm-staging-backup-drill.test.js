'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalStagingSnapshotSource } = require('../services/mira-hfm-local-staging-snapshot-source');
const { runStagingBackupDrill } = require('../services/mira-hfm-staging-backup-drill');

function fixture(sourceId, knowledgeText = 'synthetic staging knowledge') {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-drill-source-'));
  const memoryFile = path.join(rootDir, 'memory.json');
  const knowledgeFile = path.join(rootDir, 'knowledge.json');
  fs.writeFileSync(memoryFile, JSON.stringify([{ id: 'm1', text: 'synthetic staging memory' }]), { mode: 0o600 });
  fs.writeFileSync(knowledgeFile, JSON.stringify([{ id: 'k1', text: knowledgeText }]), { mode: 0o600 });
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const signingKeyId = sourceId + '-key-v1';
  const source = createLocalStagingSnapshotSource({
    environment: 'staging',
    sourceId,
    signingKeyId,
    privateKeyPem,
    rootDir,
    memoryFile,
    knowledgeFile,
    authorize: async request => request.projectId === 'mira-staging' &&
      request.actorId.startsWith('staging-operator-') && request.scope === 'backup:read'
  });
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const trusted = {
    publicKeyPem,
    keyId: signingKeyId,
    publicKeySha256: crypto.createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  };
  return { rootDir, memoryFile, knowledgeFile, source, trusted };
}

function testKeyProvider() {
  const kek = crypto.randomBytes(32);
  return {
    descriptor: {
      contractVersion: '1',
      providerId: 'staging-drill-test-kek',
      providerVersion: '1',
      keyId: 'staging-drill-test-key',
      keyVersion: '1',
      keyPurpose: 'MIRA_HFM_BACKUP',
      environment: 'test'
    },
    async wrapDataKey({ dataKey }) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', kek, nonce);
      const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
      return Buffer.from(JSON.stringify({
        nonce: nonce.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        tag: cipher.getAuthTag().toString('base64')
      })).toString('base64');
    },
    async unwrapDataKey({ wrappedDataKey }) {
      const wrapped = JSON.parse(Buffer.from(wrappedDataKey, 'base64').toString('utf8'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(wrapped.nonce, 'base64'));
      decipher.setAuthTag(Buffer.from(wrapped.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(wrapped.ciphertext, 'base64')),
        decipher.final()
      ]);
    }
  };
}

function request(actorId, requestId, nonce) {
  return {
    projectId: 'mira-staging',
    actorId,
    scope: 'backup:read',
    requestId,
    nonce
  };
}

async function run() {
  const backupSource = fixture('synthetic-staging-backup-source');
  const baselineSource = fixture('synthetic-staging-independent-baseline');
  const backupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-drill-output-'));
  try {
    const before = [
      crypto.createHash('sha256').update(fs.readFileSync(backupSource.memoryFile)).digest('hex'),
      crypto.createHash('sha256').update(fs.readFileSync(backupSource.knowledgeFile)).digest('hex'),
      crypto.createHash('sha256').update(fs.readFileSync(baselineSource.memoryFile)).digest('hex'),
      crypto.createHash('sha256').update(fs.readFileSync(baselineSource.knowledgeFile)).digest('hex')
    ];
    const result = await runStagingBackupDrill({
      source: backupSource.source,
      baselineSource: baselineSource.source,
      request: request('staging-operator-backup', 'backup-request-0001', 'backup-nonce-00000001'),
      baselineRequest: request('staging-operator-baseline', 'baseline-request-0001', 'baseline-nonce-00000001'),
      trustedSources: {
        [backupSource.source.descriptor.sourceId]: backupSource.trusted,
        [baselineSource.source.descriptor.sourceId]: baselineSource.trusted
      },
      keyProvider: testKeyProvider(),
      backupDirectory,
      backupFileName: 'mira-hfm-staging-drill-001.mira-hfm.enc.json',
      supportedSchemaVersions: ['1.0.0']
    });
    assert.equal(result.status, 'STAGING_BACKUP_AND_RECOVERY_PREVIEW_VERIFIED');
    assert.equal(result.publicationStatus, 'LOCAL_WRITE_VERIFIED');
    assert.equal(result.recovery.status, 'RECOVERY_VERIFIED_PREVIEW_ONLY');
    assert.equal(result.canonicalMemoryWritten, false);
    assert.equal(result.canonicalKnowledgeWritten, false);
    assert.equal(result.restoreExecuted, false);
    assert.equal(result.backupDeletionExecuted, false);
    assert.equal(result.liveDriveApiCalled, false);
    assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o600);
    assert.ok(fs.statSync(result.backupPath).size > 0);
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_BACKUP_PUBLICATION_PASS\n');
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_RECOVERY_PREVIEW_PASS\n');

    const after = [
      crypto.createHash('sha256').update(fs.readFileSync(backupSource.memoryFile)).digest('hex'),
      crypto.createHash('sha256').update(fs.readFileSync(backupSource.knowledgeFile)).digest('hex'),
      crypto.createHash('sha256').update(fs.readFileSync(baselineSource.memoryFile)).digest('hex'),
      crypto.createHash('sha256').update(fs.readFileSync(baselineSource.knowledgeFile)).digest('hex')
    ];
    assert.deepEqual(after, before);
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_SOURCE_IMMUTABLE_PASS\n');

    await assert.rejects(() => runStagingBackupDrill({
      source: backupSource.source,
      baselineSource: baselineSource.source,
      request: request('staging-operator-backup', 'backup-request-0002', 'backup-nonce-00000002'),
      baselineRequest: request('staging-operator-baseline', 'baseline-request-0002', 'baseline-nonce-00000002'),
      trustedSources: {
        [backupSource.source.descriptor.sourceId]: backupSource.trusted,
        [baselineSource.source.descriptor.sourceId]: baselineSource.trusted
      },
      keyProvider: testKeyProvider(),
      backupDirectory,
      backupFileName: 'mira-hfm-staging-drill-001.mira-hfm.enc.json',
      supportedSchemaVersions: ['1.0.0']
    }), error => error.code === 'BACKUP_ALREADY_EXISTS');
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_NO_OVERWRITE_PASS\n');
  } finally {
    fs.rmSync(backupSource.rootDir, { recursive: true, force: true });
    fs.rmSync(baselineSource.rootDir, { recursive: true, force: true });
    fs.rmSync(backupDirectory, { recursive: true, force: true });
  }

  const changedBackup = fixture('synthetic-staging-backup-changed');
  const independentBaseline = fixture('synthetic-staging-baseline-original');
  const mismatchOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-drill-mismatch-'));
  try {
    await assert.rejects(() => runStagingBackupDrill({
      source: changedBackup.source,
      baselineSource: independentBaseline.source,
      request: request('staging-operator-backup', 'changed-backup-0001', 'changed-backup-nonce-01'),
      baselineRequest: request('staging-operator-baseline', 'original-baseline-0001', 'original-baseline-nonce-01'),
      trustedSources: {
        [changedBackup.source.descriptor.sourceId]: changedBackup.trusted,
        [independentBaseline.source.descriptor.sourceId]: independentBaseline.trusted
      },
      keyProvider: testKeyProvider(),
      backupDirectory: mismatchOutput,
      backupFileName: 'mira-hfm-staging-mismatch.mira-hfm.enc.json',
      supportedSchemaVersions: ['1.0.0']
    }), error => error.code === 'HFM_STAGING_BASELINE_MISMATCH');
    assert.deepEqual(fs.readdirSync(mismatchOutput), []);
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_BASELINE_MISMATCH_BLOCK_PASS\n');
  } finally {
    fs.rmSync(changedBackup.rootDir, { recursive: true, force: true });
    fs.rmSync(independentBaseline.rootDir, { recursive: true, force: true });
    fs.rmSync(mismatchOutput, { recursive: true, force: true });
  }
  process.stdout.write('MIRA_HFM_PHASE7_STAGING_BACKUP_DRILL_COMPLETE\n');
}

run().catch(error => {
  process.stderr.write((error.stack || error.message) + '\n');
  process.exitCode = 1;
});
