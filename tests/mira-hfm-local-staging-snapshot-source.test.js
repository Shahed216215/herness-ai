'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalStagingSnapshotSource } = require('../services/mira-hfm-local-staging-snapshot-source');
const { captureAuthorizedSnapshot, sha256 } = require('../services/mira-hfm-authoritative-snapshot');
const { canonicalize } = require('../services/mira-hfm-authoritative-snapshot');
const { verifyAuthorizationDecision } = require('../services/mira-hfm-authorization-decision');

function makeSigningProvider(privateKey, keyId) { return { descriptor: { contractVersion: '1', providerId: 'fixture-signing-provider', providerVersion: '1', keyId, keyVersion: '1', keyPurpose: 'MIRA_HFM_SNAPSHOT_ATTESTATION', algorithm: 'Ed25519', environment: 'staging' }, async sign({ message }) { return crypto.sign(null, message, privateKey); } }; }
function makeReplayGuard() {
  const seen = new Set();
  return { async consume(item) {
    const key = item.issuerId + ':' + item.decisionId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }};
}
function makeAuthorizationTrust() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const publicKey = crypto.createPublicKey(publicKeyPem);
  return {
    privateKey: pair.privateKey,
    trust: { 'staging-policy-issuer': {
      keyId: 'staging-policy-key-v1', policyVersion: 'staging-policy-v1', publicKeyPem,
      publicKeySha256: sha256(publicKey.export({ type: 'spki', format: 'der' }))
    }}
  };
}
function signDecision(request, privateKey, overrides = {}) {
  const issued = Date.now();
  const decision = {
    issuerId: 'staging-policy-issuer', keyId: 'staging-policy-key-v1',
    decisionId: 'decision-' + request.requestId, policyVersion: 'staging-policy-v1',
    decision: 'ALLOW', projectId: request.projectId, actorId: request.actorId,
    scope: request.scope, requestId: request.requestId, nonce: request.nonce,
    issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(issued + 60000).toISOString(),
    ...overrides
  };
  decision.signature = crypto.sign(null, Buffer.from(canonicalize(decision), 'utf8'), privateKey).toString('base64');
  return decision;
}
function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-staging-'));
  const memoryFile = path.join(rootDir, 'memory.json');
  const knowledgeFile = path.join(rootDir, 'knowledge.json');
  fs.writeFileSync(memoryFile, JSON.stringify([{ id: 'm1', text: 'synthetic memory' }]));
  fs.writeFileSync(knowledgeFile, JSON.stringify([{ id: 'k1', text: 'synthetic knowledge' }]));
  const sourcePair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = sourcePair.publicKey.export({ type: 'spki', format: 'pem' });
  const signingKeyId = 'synthetic-ed25519-v1';
  const sourceId = 'synthetic-local-staging';
  const auth = makeAuthorizationTrust();
  const replayGuard = makeReplayGuard();
  const source = createLocalStagingSnapshotSource({
    environment: 'staging', sourceId, signingKeyId,
    signingProvider: makeSigningProvider(sourcePair.privateKey, signingKeyId),
    rootDir, memoryFile, knowledgeFile,
    authorizationTrust: auth.trust, replayGuard,
    authorize: async request => signDecision(request, auth.privateKey)
  });
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const trustedSources = { [sourceId]: {
    publicKeyPem, keyId: signingKeyId, keyVersion: '1',
    publicKeySha256: sha256(publicKey.export({ type: 'spki', format: 'der' }))
  }};
  return { rootDir, memoryFile, knowledgeFile, source, trustedSources, auth, replayGuard };
}
function request(requestId = 'staging-request-0001', actorId = 'test-operator') {
  return { projectId: 'mira-staging', actorId, scope: 'backup:read',
    requestId, nonce: 'staging-nonce-' + requestId.padEnd(16, '0') };
}

async function run() {
  const f = fixture();
  try {
    const beforeMemory = sha256(fs.readFileSync(f.memoryFile));
    const beforeKnowledge = sha256(fs.readFileSync(f.knowledgeFile));
    const req = request();
    const result = await captureAuthorizedSnapshot({
      source: f.source, trustedSources: f.trustedSources, request: req
    });
    assert.equal(result.evidence.signatureVerified, true);
    assert.equal(result.evidence.authorizationIndependentlyEnforced, false);
    assert.equal(result.evidence.authorizationDecisionAuthenticated, true);
    assert.equal(result.snapshot.records.length, 2);
    assert.equal(result.snapshot.records[0].storeId, 'MIRA_GENERAL_MEMORY');
    assert.equal(result.snapshot.records[1].storeId, 'MIRA_KNOWLEDGE');
    assert.equal(beforeMemory, sha256(fs.readFileSync(f.memoryFile)));
    assert.equal(beforeKnowledge, sha256(fs.readFileSync(f.knowledgeFile)));
    process.stdout.write('MIRA_HFM_PHASE7_LOCAL_STAGING_SOURCE_PASS\n');
    process.stdout.write('MIRA_HFM_PHASE7_SIGNED_AUTHORIZATION_DECISION_PASS\n');

    await assert.rejects(() => f.source.readSnapshot(req),
      error => error.code === 'HFM_AUTHZ_REPLAY_REJECTED');
    process.stdout.write('MIRA_HFM_PHASE7_AUTHORIZATION_REPLAY_BLOCK_PASS\n');

    const denied = fixture();
    try {
      const deniedReq = request('denied-request-0001', 'intruder');
      fs.writeFileSync(denied.memoryFile, 'INVALID_JSON_MUST_NOT_BE_READ');
      const deniedSource = createLocalStagingSnapshotSource({
        environment: 'staging', sourceId: 'denied-source', signingKeyId: 'denied-key',
        signingProvider: makeSigningProvider(crypto.generateKeyPairSync('ed25519').privateKey, 'denied-key'),
        rootDir: denied.rootDir, memoryFile: denied.memoryFile, knowledgeFile: denied.knowledgeFile,
        authorizationTrust: denied.auth.trust, replayGuard: denied.replayGuard,
        authorize: async r => signDecision(r, denied.auth.privateKey, { decision: 'DENY' })
      });
      await assert.rejects(() => deniedSource.readSnapshot(deniedReq),
        error => error.code === 'HFM_AUTHZ_DECISION_MISMATCH');
      assert.equal(fs.readFileSync(denied.memoryFile, 'utf8'), 'INVALID_JSON_MUST_NOT_BE_READ');
      process.stdout.write('MIRA_HFM_PHASE7_AUTH_DENIAL_BEFORE_FILE_READ_PASS\n');
    } finally { fs.rmSync(denied.rootDir, { recursive: true, force: true }); }
    process.stdout.write('MIRA_HFM_PHASE7_LOCAL_STAGING_AUTH_DENY_PASS\n');

    const expiryReq = request('expired-request-0001');
    const expired = signDecision(expiryReq, f.auth.privateKey, {
      issuedAt: new Date(Date.now() - 600000).toISOString(),
      expiresAt: new Date(Date.now() - 300000).toISOString()
    });
    await assert.rejects(() => verifyAuthorizationDecision({
      decision: expired, request: expiryReq, trustedIssuers: f.auth.trust,
      replayGuard: makeReplayGuard()
    }), error => error.code === 'HFM_AUTHZ_DECISION_EXPIRED_OR_INVALID');
    process.stdout.write('MIRA_HFM_PHASE7_AUTHORIZATION_EXPIRY_BLOCK_PASS\n');

    const wrongActorReq = request('wrong-actor-request-0001', 'operator-A');
    const wrongActorDecision = signDecision(wrongActorReq, f.auth.privateKey, { actorId: 'operator-B' });
    await assert.rejects(() => verifyAuthorizationDecision({
      decision: wrongActorDecision, request: wrongActorReq, trustedIssuers: f.auth.trust,
      replayGuard: makeReplayGuard()
    }), error => error.code === 'HFM_AUTHZ_DECISION_MISMATCH');
    const wrongPolicyReq = request('wrong-policy-request-0001');
    const wrongPolicyDecision = signDecision(wrongPolicyReq, f.auth.privateKey, { policyVersion: 'retired-policy-v0' });
    await assert.rejects(() => verifyAuthorizationDecision({
      decision: wrongPolicyDecision, request: wrongPolicyReq, trustedIssuers: f.auth.trust,
      replayGuard: makeReplayGuard()
    }), error => error.code === 'HFM_AUTHZ_ISSUER_UNTRUSTED');
    process.stdout.write('MIRA_HFM_PHASE7_AUTHORIZATION_POLICY_VERSION_PIN_PASS\\n');
    process.stdout.write('MIRA_HFM_PHASE7_AUTHORIZATION_ACTOR_BINDING_PASS\n');

    const replayDecision = signDecision(request('replay-check-0001'), f.auth.privateKey);
    const replayGuard = makeReplayGuard();
    const args = { decision: replayDecision, request: request('replay-check-0001'),
      trustedIssuers: f.auth.trust, replayGuard };
    await verifyAuthorizationDecision(args);
    await assert.rejects(() => verifyAuthorizationDecision(args),
      error => error.code === 'HFM_AUTHZ_REPLAY_REJECTED');
    process.stdout.write('MIRA_HFM_PHASE7_AUTHORIZATION_ONE_TIME_CONSUME_PASS\n');

    assert.throws(() => createLocalStagingSnapshotSource({
      environment: 'production', sourceId: 'forbidden', signingKeyId: 'forbidden-key',
      privateKeyPem: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
      rootDir: f.rootDir, memoryFile: f.memoryFile, knowledgeFile: f.knowledgeFile,
      authorizationTrust: f.auth.trust, replayGuard: f.replayGuard, authorize: async () => true
    }), error => error.code === 'HFM_STAGING_ENVIRONMENT_REQUIRED');
    process.stdout.write('MIRA_HFM_PHASE7_PRODUCTION_ENV_BLOCK_PASS\n');

    const provenancePair = crypto.generateKeyPairSync('ed25519');
    const provenanceInput = { storageSystemId: 'storage-A', nested: { region: 'local-staging' } };
    const provenanceSource = createLocalStagingSnapshotSource({
      environment: 'staging', sourceId: 'provenance-freeze-test', signingKeyId: 'provenance-freeze-key',
      signingProvider: makeSigningProvider(provenancePair.privateKey, 'provenance-freeze-key'),
      rootDir: f.rootDir, memoryFile: f.memoryFile, knowledgeFile: f.knowledgeFile,
      authorizationTrust: f.auth.trust, replayGuard: makeReplayGuard(),
      authorize: async r => signDecision(r, f.auth.privateKey),
      provenance: provenanceInput
    });
    provenanceInput.nested.region = 'mutated-after-construction';
    assert.equal(provenanceSource.descriptor.provenance.nested.region, 'local-staging');
    assert.equal(Object.isFrozen(provenanceSource.descriptor.provenance.nested), true);
    assert.throws(() => { provenanceSource.descriptor.provenance.nested.region = 'mutation'; }, TypeError);
    provenanceSource.close();
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_PROVENANCE_IMMUTABLE_PASS\n');

    assert.throws(() => createLocalStagingSnapshotSource({
      environment: 'staging', sourceId: 'same-file', signingKeyId: 'same-file-key',
      signingProvider: makeSigningProvider(crypto.generateKeyPairSync('ed25519').privateKey, 'same-file-key'),
      rootDir: f.rootDir, memoryFile: f.memoryFile, knowledgeFile: f.memoryFile,
      authorizationTrust: f.auth.trust, replayGuard: makeReplayGuard(), authorize: async () => true
    }), error => error.code === 'HFM_STAGING_SOURCE_FILES_COLLIDE');
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_SAME_FILE_REJECT_PASS\n');

    assert.throws(() => createLocalStagingSnapshotSource({
      environment: 'staging', sourceId: 'invalid-provenance', signingKeyId: 'invalid-provenance-key',
      signingProvider: makeSigningProvider(crypto.generateKeyPairSync('ed25519').privateKey, 'invalid-provenance-key'),
      rootDir: f.rootDir, memoryFile: f.memoryFile, knowledgeFile: f.knowledgeFile,
      authorizationTrust: f.auth.trust, replayGuard: makeReplayGuard(), authorize: async () => true,
      provenance: []
    }), error => error.code === 'HFM_STAGING_PROVENANCE_INVALID');
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_PROVENANCE_SCHEMA_BLOCK_PASS\n');

    const outsideFile = path.join(path.dirname(f.rootDir), path.basename(f.rootDir) + '-outside.json');
    fs.writeFileSync(outsideFile, '[]');
    try {
      assert.throws(() => createLocalStagingSnapshotSource({
        environment: 'staging', sourceId: 'outside', signingKeyId: 'outside-key',
        signingProvider: makeSigningProvider(crypto.generateKeyPairSync('ed25519').privateKey, 'outside-key'),
        rootDir: f.rootDir, memoryFile: outsideFile, knowledgeFile: f.knowledgeFile,
        authorizationTrust: f.auth.trust, replayGuard: f.replayGuard, authorize: async () => true
      }), error => error.code === 'HFM_STAGING_PATH_OUTSIDE_ROOT');
    } finally { fs.unlinkSync(outsideFile); }
    const symlinkFile = path.join(f.rootDir, 'memory-link.json');
    fs.symlinkSync(f.memoryFile, symlinkFile);
    assert.throws(() => createLocalStagingSnapshotSource({
      environment: 'staging', sourceId: 'symlink', signingKeyId: 'symlink-key',
      signingProvider: makeSigningProvider(crypto.generateKeyPairSync('ed25519').privateKey, 'symlink-key'),
      rootDir: f.rootDir, memoryFile: symlinkFile, knowledgeFile: f.knowledgeFile,
      authorizationTrust: f.auth.trust, replayGuard: f.replayGuard, authorize: async () => true
    }), error => error.code === 'HFM_STAGING_PATH_OUTSIDE_ROOT');
    process.stdout.write('MIRA_HFM_PHASE7_STAGING_PATH_PIN_PASS\n');
  } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  process.stdout.write('MIRA_HFM_PHASE7_LOCAL_STAGING_SOURCE_COMPLETE\n');
}
run().catch(error => { process.stderr.write((error.stack || error.message) + '\n'); process.exitCode = 1; });
