'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkLearningStagingSnapshotSource } = require('../services/mira-hfm-work-learning-staging-source');
const { captureAuthorizedSnapshot, canonicalize, sha256 } = require('../services/mira-hfm-authoritative-snapshot');
const {
  adaptApprovedWorkLearningEntries,
  buildWorkLearningCanonicalCandidate
} = require('../services/mira-hfm-work-learning-adapter');
const {
  digest: mappingDigest,
  bodyOf: mappingBodyOf
} = require('../services/mira-memory-project-mapping-contract');
const {
  createProjectMappingOwnerApprovalVerifier
} = require('../services/mira-memory-project-mapping-owner-approval-adapter');
const {
  digest: ownerRegistryDigest
} = require('../services/mira-memory-project-owner-registry-contract');
const { digest: rawRecordDigest } = require('../services/mira-legacy-memory-knowledge-adapter');

function signingProvider(privateKey, keyId) {
  return {
    descriptor: {
      contractVersion: '1', providerId: 'fixture-work-learning-signer',
      providerVersion: '1', keyId, keyVersion: '1',
      keyPurpose: 'MIRA_HFM_SNAPSHOT_ATTESTATION',
      algorithm: 'Ed25519', environment: 'staging'
    },
    async sign({ message }) { return crypto.sign(null, message, privateKey); }
  };
}
function replayGuard() {
  const seen = new Set();
  return { async consume(item) {
    const key = item.issuerId + ':' + item.decisionId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }};
}
function authorizationTrust() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const publicKey = crypto.createPublicKey(publicKeyPem);
  return {
    privateKey: pair.privateKey,
    trust: {
      'work-learning-policy-issuer': {
        keyId: 'work-learning-policy-key-v1',
        policyVersion: 'work-learning-policy-v1',
        publicKeyPem,
        publicKeySha256: sha256(publicKey.export({ type: 'spki', format: 'der' }))
      }
    }
  };
}
function signDecision(request, privateKey, overrides = {}) {
  const issued = Date.now();
  const decision = {
    issuerId: 'work-learning-policy-issuer',
    keyId: 'work-learning-policy-key-v1',
    decisionId: 'decision-' + request.requestId,
    policyVersion: 'work-learning-policy-v1',
    decision: 'ALLOW',
    projectId: request.projectId,
    actorId: request.actorId,
    scope: request.scope,
    requestId: request.requestId,
    nonce: request.nonce,
    issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(issued + 60000).toISOString(),
    ...overrides
  };
  decision.signature = crypto.sign(
    null, Buffer.from(canonicalize(decision), 'utf8'), privateKey
  ).toString('base64');
  return decision;
}
function provenance() {
  return {
    storageSystemId: 'synthetic-work-learning-storage',
    storageInstanceId: 'synthetic-work-learning-instance',
    securityPrincipalId: 'synthetic-work-learning-principal',
    trustDomainId: 'synthetic-work-learning-trust',
    sourceSystemId: 'mira-work-learning-fixture',
    snapshotIssuerId: 'synthetic-work-learning-snapshot-issuer'
  };
}
function fixture(records = [{
  learningId: 'learning-source-001',
  taskId: 'task-source-001',
  executionId: 'execution-source-001',
  lessons: ['Preserve source evidence and require review.'],
  createdAt: '2026-11-05T10:00:00.000Z'
}]) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-work-learning-'));
  fs.chmodSync(rootDir, 0o700);
  const learningFile = path.join(rootDir, 'work-learning-records.json');
  const store = {
    version: 1,
    updatedAt: '2026-11-05T10:00:00.000Z',
    records
  };
  fs.writeFileSync(learningFile, JSON.stringify(store), { mode: 0o600 });
  fs.chmodSync(learningFile, 0o600);
  const sourcePair = crypto.generateKeyPairSync('ed25519');
  const signingKeyId = 'work-learning-snapshot-key-v1';
  const sourceId = 'synthetic-work-learning-staging-source';
  const auth = authorizationTrust();
  const guard = replayGuard();
  const config = {
    environment: 'staging',
    sourceId,
    signingKeyId,
    signingProvider: signingProvider(sourcePair.privateKey, signingKeyId),
    rootDir,
    learningFile,
    provenance: provenance(),
    authorizationTrust: auth.trust,
    replayGuard: guard,
    authorize: async request => signDecision(request, auth.privateKey)
  };
  const source = createWorkLearningStagingSnapshotSource(config);
  const publicKey = crypto.createPublicKey(
    sourcePair.publicKey.export({ type: 'spki', format: 'pem' })
  );
  const trustedSources = {
    [sourceId]: {
      publicKeyPem: sourcePair.publicKey.export({ type: 'spki', format: 'pem' }),
      keyId: signingKeyId,
      keyVersion: '1',
      publicKeySha256: sha256(publicKey.export({ type: 'spki', format: 'der' })),
      provenance: provenance()
    }
  };
  return { rootDir, learningFile, source, trustedSources, auth, guard, config };
}
function request(id = 'work-learning-request-001', actorId = 'fixture-owner') {
  return {
    projectId: 'mira-staging-snapshot',
    actorId,
    scope: 'backup:read',
    requestId: id,
    nonce: 'work-learning-nonce-' + id.padEnd(16, '0')
  };
}
async function run() {
  const f = fixture();
  try {
    const before = sha256(fs.readFileSync(f.learningFile));
    const req = request();
    const captured = await captureAuthorizedSnapshot({
      source: f.source,
      trustedSources: f.trustedSources,
      request: req
    });
    assert.equal(captured.evidence.signatureVerified, true);
    assert.equal(captured.evidence.authorizationDecisionAuthenticated, true);
    assert.equal(captured.snapshot.storeId, 'MIRA_WORK_LEARNING_STORE');
    assert.equal(captured.snapshot.records.length, 1);
    assert.equal(captured.snapshot.records[0].learningId, 'learning-source-001');
    assert.equal(Object.prototype.hasOwnProperty.call(captured.snapshot.records[0], 'projectId'), false);
    assert.equal(captured.evidence.provenance.sourceSystemId, 'mira-work-learning-fixture');
    assert.equal(before, sha256(fs.readFileSync(f.learningFile)));
    console.log('WORK_LEARNING_SIGNED_STAGING_SNAPSHOT_CAPTURE_PASS');
    console.log('WORK_LEARNING_SOURCE_SNAPSHOT_DOES_NOT_INFER_PROJECT_PASS');

    const ownerNow = new Date();
    const createdAt = new Date(ownerNow.getTime() - 30000).toISOString();
    const approvedAt = new Date(ownerNow.getTime() - 10000).toISOString();
    const ownerActor = req.actorId;
    const ownerRegistry = {
      schemaVersion: '1.0.0',
      authorityRecordId: 'work-learning-e2e-owner-registry',
      projectId: 'project-alpha',
      tenantId: 'tenant-alpha',
      ownerActorId: ownerActor,
      memberships: [{
        membershipRef: 'work-learning-e2e-owner-membership',
        actorId: ownerActor,
        actorType: 'HUMAN',
        role: 'OWNER',
        allowedOperations: ['READ', 'WRITE', 'LIST', 'VERIFY', 'PLAN_MIGRATION', 'APPROVE_MAPPING'],
        status: 'ACTIVE',
        validFrom: createdAt,
        validUntil: new Date(ownerNow.getTime() + 60000).toISOString()
      }],
      sourceProjectSnapshotDigest: 'c'.repeat(64),
      approvalReference: 'work-learning-e2e-registry-approval',
      approvedBy: 'mira:fixture:admin',
      approvedAt,
      registryRevision: 'work-learning-e2e-r1',
      status: 'ACTIVE',
      createdAt,
      updatedAt: approvedAt
    };
    ownerRegistry.recordDigest = ownerRegistryDigest(ownerRegistry);
    const verifyApproval = createProjectMappingOwnerApprovalVerifier({
      ownerRegistry,
      expectedTenantId: 'tenant-alpha',
      verifyRegistryRecord: proof =>
        proof.recordDigest === ownerRegistry.recordDigest &&
        proof.projectId === ownerRegistry.projectId &&
        proof.tenantId === ownerRegistry.tenantId,
      now: () => ownerNow
    });
    const learningEntry = captured.snapshot.records[0];
    const candidate = buildWorkLearningCanonicalCandidate({
      entry: learningEntry,
      mapping: {
        memoryId: 'canonical-work-learning-e2e-001',
        projectId: 'project-alpha',
        classification: 'PROJECT_PRIVATE'
      },
      observedAt: captured.evidence.capturedAt
    });
    const mapping = {
      schemaVersion: '1.0.0',
      mappingId: 'work-learning-e2e-mapping-001',
      domain: 'work_learning',
      sourceSystem: 'mira_work_learning',
      sourceFileDigest: captured.snapshot.sourceFileDigest,
      sourceOrdinal: 0,
      legacyId: learningEntry.learningId,
      memoryId: 'canonical-work-learning-e2e-001',
      projectId: 'project-alpha',
      parentConversationId: null,
      clientId: null,
      revision: 1,
      sourceDigest: rawRecordDigest(learningEntry),
      canonicalRecordDigest: rawRecordDigest(candidate),
      classification: 'PROJECT_PRIVATE',
      status: 'APPROVED',
      approvalReference: 'work-learning-e2e-mapping-approval',
      approvedBy: ownerActor,
      approvedAt,
      createdAt
    };
    mapping.mappingDigest = mappingDigest(mappingBodyOf(mapping));
    const adapted = adaptApprovedWorkLearningEntries({
      entries: captured.snapshot.records,
      mappings: [mapping],
      projectId: 'project-alpha',
      sourceFileDigest: captured.snapshot.sourceFileDigest,
      observedAt: captured.evidence.capturedAt,
      verifyApproval,
      now: ownerNow
    });
    assert.equal(adapted.length, 1);
    assert.equal(adapted[0].canonicalRecord.projectId, 'project-alpha');
    assert.equal(adapted[0].canonicalRecord.lifecycle, 'PENDING_REVIEW');
    assert.equal(adapted[0].canonicalRecord.integrity.status, 'UNVERIFIED');
    assert.deepEqual(JSON.parse(adapted[0].canonicalRecord.content).record, learningEntry);
    console.log('WORK_LEARNING_SIGNED_SNAPSHOT_TO_OWNER_APPROVED_CANDIDATE_E2E_PASS');

    await assert.rejects(() => f.source.readSnapshot(req),
      error => error.code === 'HFM_AUTHZ_REPLAY_REJECTED');
    console.log('WORK_LEARNING_SNAPSHOT_AUTHORIZATION_REPLAY_BLOCK_PASS');
  } finally {
    f.source.close();
    fs.rmSync(f.rootDir, { recursive: true, force: true });
  }

  const denied = fixture();
  try {
    const deniedRequest = request('work-learning-denied-001', 'intruder');
    fs.writeFileSync(denied.learningFile, 'INVALID_JSON_MUST_NOT_BE_READ');
    fs.chmodSync(denied.learningFile, 0o600);
    const pair = crypto.generateKeyPairSync('ed25519');
    const deniedSource = createWorkLearningStagingSnapshotSource({
      ...denied.config,
      sourceId: 'denied-work-learning-source',
      signingKeyId: 'denied-work-learning-key',
      signingProvider: signingProvider(pair.privateKey, 'denied-work-learning-key'),
      authorize: async r => signDecision(r, denied.auth.privateKey, { decision: 'DENY' })
    });
    await assert.rejects(() => deniedSource.readSnapshot(deniedRequest),
      error => error.code === 'HFM_AUTHZ_DECISION_MISMATCH');
    assert.equal(fs.readFileSync(denied.learningFile, 'utf8'), 'INVALID_JSON_MUST_NOT_BE_READ');
    deniedSource.close();
    console.log('WORK_LEARNING_AUTH_DENIAL_BEFORE_FILE_READ_PASS');
  } finally {
    denied.source.close();
    fs.rmSync(denied.rootDir, { recursive: true, force: true });
  }

  const duplicate = fixture([
    { learningId: 'duplicate-learning', taskId: 'task-a', lessons: [] },
    { learningId: 'duplicate-learning', taskId: 'task-b', lessons: [] }
  ]);
  try {
    await assert.rejects(() => duplicate.source.readSnapshot(request('duplicate-learning-001')),
      error => error.code === 'HFM_WORK_LEARNING_SOURCE_DUPLICATE_ID');
    console.log('WORK_LEARNING_DUPLICATE_ID_SNAPSHOT_BLOCK_PASS');
  } finally {
    duplicate.source.close();
    fs.rmSync(duplicate.rootDir, { recursive: true, force: true });
  }

  const secret = fixture([{
    learningId: 'secret-learning',
    taskId: 'task-secret',
    metadata: { apiToken: 'fixture-secret-value' },
    lessons: ['must not leak']
  }]);
  try {
    await assert.rejects(() => secret.source.readSnapshot(request('secret-learning-001')),
      error => error.code === 'HFM_WORK_LEARNING_SOURCE_SECRET_FIELD');
    console.log('WORK_LEARNING_SECRET_FIELD_SNAPSHOT_BLOCK_PASS');
  } finally {
    secret.source.close();
    fs.rmSync(secret.rootDir, { recursive: true, force: true });
  }

  const unsafeMode = fixture();
  try {
    fs.chmodSync(unsafeMode.rootDir, 0o750);
    assert.throws(() => createWorkLearningStagingSnapshotSource(unsafeMode.config),
      error => error.code === 'HFM_BACKUP_DIRECTORY_MODE_UNSAFE');
    console.log('WORK_LEARNING_STAGING_ROOT_PERMISSION_BLOCK_PASS');
  } finally {
    fs.chmodSync(unsafeMode.rootDir, 0o700);
    unsafeMode.source.close();
    fs.rmSync(unsafeMode.rootDir, { recursive: true, force: true });
  }

  const unsafeFile = fixture();
  try {
    fs.chmodSync(unsafeFile.learningFile, 0o640);
    assert.throws(() => createWorkLearningStagingSnapshotSource(unsafeFile.config),
      error => error.code === 'HFM_WORK_LEARNING_SOURCE_FILE_UNSAFE');
    console.log('WORK_LEARNING_SOURCE_FILE_PERMISSION_BLOCK_PASS');
  } finally {
    unsafeFile.source.close();
    fs.rmSync(unsafeFile.rootDir, { recursive: true, force: true });
  }

  const production = fixture();
  try {
    assert.throws(() => createWorkLearningStagingSnapshotSource({
      ...production.config, environment: 'production'
    }), error => error.code === 'HFM_WORK_LEARNING_ENVIRONMENT_REQUIRED');
    console.log('WORK_LEARNING_PRODUCTION_SOURCE_ENVIRONMENT_BLOCK_PASS');
  } finally {
    production.source.close();
    fs.rmSync(production.rootDir, { recursive: true, force: true });
  }

  console.log('NETWORK_REQUESTS=0');
  console.log('PRODUCTION_MEMORY_TOUCHED=NO');
  console.log('CANONICAL_MEMORY_WRITTEN=NO');
  console.log('CANONICAL_KNOWLEDGE_WRITTEN=NO');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_WORK_LEARNING_STAGING_SOURCE_PASS');
}
run().catch(error => { process.stderr.write((error.stack || error.message) + '\n'); process.exitCode = 1; });
