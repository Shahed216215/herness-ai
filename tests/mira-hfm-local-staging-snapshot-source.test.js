'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalStagingSnapshotSource } = require('../services/mira-hfm-local-staging-snapshot-source');
const { captureAuthorizedSnapshot } = require('../services/mira-hfm-authoritative-snapshot');
const { sha256 } = require('../services/mira-hfm-authoritative-snapshot');

function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-staging-'));
  const memoryFile = path.join(rootDir, 'memory.json');
  const knowledgeFile = path.join(rootDir, 'knowledge.json');
  fs.writeFileSync(memoryFile, JSON.stringify([{ id: 'm1', text: 'synthetic memory' }]));
  fs.writeFileSync(knowledgeFile, JSON.stringify([{ id: 'k1', text: 'synthetic knowledge' }]));
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const sourceId = 'synthetic-local-staging';
  const signingKeyId = 'synthetic-ed25519-v1';
  const source = createLocalStagingSnapshotSource({
    environment: 'staging',
    sourceId,
    signingKeyId,
    privateKeyPem,
    rootDir,
    memoryFile,
    knowledgeFile,
    authorize: async request => request.projectId === 'mira-staging' &&
      request.actorId === 'test-operator' && request.scope === 'backup:read'
  });
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const trustedSources = {
    [sourceId]: {
      publicKeyPem,
      keyId: signingKeyId,
      publicKeySha256: sha256(publicKey.export({ type: 'spki', format: 'der' }))
    }
  };
  return { rootDir, memoryFile, knowledgeFile, source, trustedSources };
}

async function run() {
  const f = fixture();
  try {
    const beforeMemory = crypto.createHash('sha256').update(fs.readFileSync(f.memoryFile)).digest('hex');
    const beforeKnowledge = crypto.createHash('sha256').update(fs.readFileSync(f.knowledgeFile)).digest('hex');
    const result = await captureAuthorizedSnapshot({
      source: f.source,
      trustedSources: f.trustedSources,
      request: {
        projectId: 'mira-staging',
        actorId: 'test-operator',
        scope: 'backup:read',
        requestId: 'staging-request-0001',
        nonce: 'staging-nonce-00000001'
      }
    });
    assert.equal(result.evidence.signatureVerified, true);
    assert.equal(result.evidence.authorizationIndependentlyEnforced, false);
    assert.equal(result.snapshot.records.length, 2);
    assert.equal(result.snapshot.records[0].storeId, 'MIRA_GENERAL_MEMORY');
    assert.equal(result.snapshot.records[1].storeId, 'MIRA_KNOWLEDGE');
    assert.equal(beforeMemory, crypto.createHash('sha256').update(fs.readFileSync(f.memoryFile)).digest('hex'));
    assert.equal(beforeKnowledge, crypto.createHash('sha256').update(fs.readFileSync(f.knowledgeFile)).digest('hex'));
    process.stdout.write('MIRA_HFM_PHASE7_LOCAL_STAGING_SOURCE_PASS\n');

    const denied = fixture();
    try {
      const deniedSource = createLocalStagingSnapshotSource({
        environment: 'staging',
        sourceId: 'denied-source',
        signingKeyId: 'denied-key',
        privateKeyPem: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
        rootDir: denied.rootDir,
        memoryFile: denied.memoryFile,
        knowledgeFile: denied.knowledgeFile,
        authorize: async () => false
      });
      await assert.rejects(() => deniedSource.readSnapshot({
        projectId: 'mira-staging', actorId: 'intruder', scope: 'backup:read',
        requestId: 'staging-request-denied', nonce: 'staging-nonce-denied-01'
      }), error => error.code === 'HFM_STAGING_AUTHORIZATION_DENIED');
    } finally {
      fs.rmSync(denied.rootDir, { recursive: true, force: true });
    }
    process.stdout.write('MIRA_HFM_PHASE7_LOCAL_STAGING_AUTH_DENY_PASS\n');

    assert.throws(() => createLocalStagingSnapshotSource({
      environment: 'production',
      sourceId: 'forbidden',
      signingKeyId: 'forbidden-key',
      privateKeyPem: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
      rootDir: f.rootDir,
      memoryFile: f.memoryFile,
      knowledgeFile: f.knowledgeFile,
      authorize: async () => true
    }), error => error.code === 'HFM_STAGING_ENVIRONMENT_REQUIRED');
    process.stdout.write('MIRA_HFM_PHASE7_PRODUCTION_ENV_BLOCK_PASS\n');

    const outsideFile = path.join(path.dirname(f.rootDir), path.basename(f.rootDir) + '-outside.json');
    fs.writeFileSync(outsideFile, '[]');
    try {
      assert.throws(() => createLocalStagingSnapshotSource({
        environment: 'staging',
        sourceId: 'outside',
        signingKeyId: 'outside-key',
        privateKeyPem: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
        rootDir: f.rootDir,
        memoryFile: outsideFile,
        knowledgeFile: f.knowledgeFile,
        authorize: async () => true
      }), error => error.code === 'HFM_STAGING_PATH_OUTSIDE_ROOT');
    } finally {
      fs.unlinkSync(outsideFile);
    }
    const symlinkFile = path.join(f.rootDir, 'memory-link.json');
    fs.symlinkSync(f.memoryFile, symlinkFile);
    assert.throws(() => createLocalStagingSnapshotSource({
      environment: 'staging',
      sourceId: 'symlink',
      signingKeyId: 'symlink-key',
      privateKeyPem: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
      rootDir: f.rootDir,
      memoryFile: symlinkFile,
      knowledgeFile: f.knowledgeFile,
      authorize: async () => true
    }), error => error.code === 'HFM_STAGING_PATH_OUTSIDE_ROOT');
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_PATH_PIN_PASS\n');
  } finally {
    fs.rmSync(f.rootDir, { recursive: true, force: true });
  }
  process.stdout.write('MIRA_HFM_PHASE7_LOCAL_STAGING_SOURCE_COMPLETE\n');
}

run().catch(error => {
  process.stderr.write((error.stack || error.message) + '\n');
  process.exitCode = 1;
});
