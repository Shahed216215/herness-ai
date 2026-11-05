'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalStagingSnapshotSource } = require('../services/mira-hfm-local-staging-snapshot-source');
const { canonicalize } = require('../services/mira-hfm-authoritative-snapshot');
const { canonicalizeProvenancePolicy } = require('../services/mira-hfm-signed-provenance-policy');
const { REQUIRED_FIELDS } = require('../services/mira-hfm-source-provenance-contract');
const { runStagingBackupDrill } = require('../services/mira-hfm-staging-backup-drill');

function makeSnapshotSigningProvider(privateKey, keyId) { return { descriptor: { contractVersion: '1', providerId: 'fixture-snapshot-signer-' + keyId, providerVersion: '1', keyId, keyVersion: '1', keyPurpose: 'MIRA_HFM_SNAPSHOT_ATTESTATION', algorithm: 'Ed25519', environment: 'staging' }, async sign({ message }) { return crypto.sign(null, message, privateKey); } }; }
function makeAuthorization(privateKey, request) {
  const issued = Date.now();
  const decision = {
    issuerId: 'synthetic-policy-' + request.projectId,
    keyId: 'synthetic-policy-key-v1',
    decisionId: 'decision-' + request.requestId,
    policyVersion: 'synthetic-policy-v1',
    decision: 'ALLOW',
    projectId: request.projectId,
    actorId: request.actorId,
    scope: request.scope,
    requestId: request.requestId,
    nonce: request.nonce,
    issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(issued + 60000).toISOString()
  };
  decision.signature = crypto.sign(null, Buffer.from(canonicalize(decision), 'utf8'), privateKey).toString('base64');
  return decision;
}
function fixture(sourceId, knowledgeText = 'synthetic staging knowledge') {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-drill-source-'));
  const memoryFile = path.join(rootDir, 'memory.json');
  const knowledgeFile = path.join(rootDir, 'knowledge.json');
  fs.writeFileSync(memoryFile, JSON.stringify([{ id: 'm1', text: 'synthetic staging memory' }]), { mode: 0o600 });
  fs.writeFileSync(knowledgeFile, JSON.stringify([{ id: 'k1', text: knowledgeText }]), { mode: 0o600 });
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const signingKeyId = sourceId + '-key-v1';
  const signingProvider = makeSnapshotSigningProvider(pair.privateKey, signingKeyId);
  const provenance = {
    storageSystemId: sourceId + '-storage-system',
    storageInstanceId: sourceId + '-storage-instance',
    securityPrincipalId: sourceId + '-workload-principal',
    trustDomainId: sourceId + '-trust-domain',
    sourceSystemId: sourceId + '-source-system',
    snapshotIssuerId: sourceId + '-snapshot-issuer'
  };
  const policyPair = crypto.generateKeyPairSync('ed25519');
  const policyPublicPem = policyPair.publicKey.export({ type: 'spki', format: 'pem' });
  const policyPublic = crypto.createPublicKey(policyPublicPem);
  const authorizationTrust = {
    ['synthetic-policy-mira-staging']: {
      keyId: 'synthetic-policy-key-v1',
      policyVersion: 'synthetic-policy-v1',
      publicKeyPem: policyPublicPem,
      publicKeySha256: crypto.createHash('sha256').update(policyPublic.export({ type: 'spki', format: 'der' })).digest('hex')
    }
  };
  const replayed = new Set();
  const replayGuard = { async consume(item) {
    const key = item.issuerId + ':' + item.decisionId;
    if (replayed.has(key)) return false;
    replayed.add(key);
    return true;
  }};
  const source = createLocalStagingSnapshotSource({
    environment: 'staging',
    sourceId,
    signingKeyId,
    signingProvider,
    provenance,
    rootDir,
    memoryFile,
    knowledgeFile,
    authorizationTrust,
    replayGuard,
    authorize: async request => request.projectId === 'mira-staging' &&
      request.actorId.startsWith('staging-operator-') && request.scope === 'backup:read'
        ? makeAuthorization(policyPair.privateKey, request) : makeAuthorization(policyPair.privateKey, { ...request, actorId: 'denied-actor' })
  });
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const trusted = {
    publicKeyPem,
    provenance,
    keyId: signingKeyId,
    keyVersion: '1',
    publicKeySha256: crypto.createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  };
  return { rootDir, memoryFile, knowledgeFile, source, trusted, authorizationTrust, replayGuard };
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

function makeEd25519Key() {
  const pair = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    publicKeySha256: crypto.createHash('sha256')
      .update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  };
}
function makeTrust(key, keyId, keyVersion = '1') {
  return { keyId, keyVersion, publicKeyPem: key.publicKeyPem, publicKeySha256: key.publicKeySha256 };
}
function signPolicyPayload(payload, key) {
  return {
    payload,
    signature: crypto.sign(null, Buffer.from(canonicalizeProvenancePolicy(payload)), key.privateKey).toString('base64')
  };
}
function makePolicyAcceptance(backupSource, baselineSource) {
  const now = Date.now();
  const issuedAt = new Date(now - 1000).toISOString();
  const expiresAt = new Date(now + 120000).toISOString();
  const policyKey = makeEd25519Key();
  const stateKey = makeEd25519Key();
  const reviewerA = makeEd25519Key();
  const reviewerB = makeEd25519Key();
  const evidenceKey = makeEd25519Key();
  const policyIssuer = 'synthetic-staging-policy-issuer';
  const stateAuthority = 'synthetic-staging-policy-state-authority';
  const evidenceIssuer = 'synthetic-staging-evidence-issuer';
  const reviewerIds = ['synthetic-reviewer-a', 'synthetic-reviewer-b'];
  const sources = {
    [baselineSource.source.descriptor.sourceId]: baselineSource.trusted.provenance,
    [backupSource.source.descriptor.sourceId]: backupSource.trusted.provenance
  };
  const evidenceRecords = new Map();
  const evidence = {};
  for (const [sourceId, profile] of Object.entries(sources)) {
    evidence[sourceId] = {};
    for (const dimension of REQUIRED_FIELDS) {
      const evidenceId = sourceId + ':' + dimension;
      const record = {
        sourceId,
        dimension,
        observedValue: profile[dimension],
        environment: 'staging',
        projectId: 'mira-staging'
      };
      const digest = crypto.createHash('sha256')
        .update(canonicalizeProvenancePolicy(record)).digest('hex');
      const evidencePayload = {
        contractVersion: '1',
        evidenceId,
        sourceId,
        dimension,
        issuerId: evidenceIssuer,
        signerKeyId: 'staging-evidence-key',
        signerKeyVersion: '1',
        issuedAt,
        expiresAt,
        scope: { environment: 'staging', projectId: 'mira-staging' },
        reviewerIds,
        record
      };
      evidenceRecords.set(evidenceId, signPolicyPayload(evidencePayload, evidenceKey));
      evidence[sourceId][dimension] = {
        evidenceId,
        sha256: digest,
        issuerId: evidenceIssuer,
        reviewerIds
      };
    }
  }

  const policyPayload = {
    contractVersion: '1',
    policyId: 'synthetic-staging-policy-' + crypto.randomBytes(6).toString('hex'),
    policyVersion: 'staging-provenance-v1',
    sequence: 1,
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
    scope: { environment: 'staging', projectId: 'mira-staging' },
    signer: { issuerId: policyIssuer, keyId: 'staging-policy-key', keyVersion: '1' },
    sources,
    evidence,
    approvals: []
  };
  const reviewPayload = { ...policyPayload };
  delete reviewPayload.approvals;
  const reviewMessage = Buffer.from(canonicalizeProvenancePolicy(reviewPayload));
  policyPayload.approvals = [
    {
      reviewerId: reviewerIds[0], keyId: 'staging-review-key-a', role: 'security-reviewer',
      signature: crypto.sign(null, reviewMessage, reviewerA.privateKey).toString('base64')
    },
    {
      reviewerId: reviewerIds[1], keyId: 'staging-review-key-b', role: 'policy-owner',
      signature: crypto.sign(null, reviewMessage, reviewerB.privateKey).toString('base64')
    }
  ];

  const statePayload = {
    contractVersion: '1',
    authorityId: stateAuthority,
    signer: { authorityId: stateAuthority, keyId: 'staging-state-key', keyVersion: '1' },
    issuedAt,
    expiresAt,
    statusAvailable: true,
    durable: true,
    atomic: true,
    highestAcceptedSequence: 0,
    lastAcceptedPolicyId: null,
    lastAcceptedPolicyDigest: null,
    revokedPolicyIds: []
  };
  let currentState = signPolicyPayload(statePayload, stateKey);
  const committedReceipts = new Map();
  const policyStateProvider = {
    async readState() { return currentState; },
    async getCommitReceipt({ authorityId, idempotencyKey, requestDigest }) {
      if (authorityId !== stateAuthority) throw new Error('wrong state authority');
      const entry = committedReceipts.get(idempotencyKey);
      if (!entry) return null;
      if (entry.requestDigest !== requestDigest) throw new Error('receipt request digest mismatch');
      return entry.receipt;
    },
    async compareAndSwap(input) {
      const requestDigest = crypto.createHash('sha256').update(canonicalizeProvenancePolicy({
        authorityId: input.authorityId,
        expectedSequence: input.expectedSequence,
        expectedDigest: input.expectedDigest,
        nextState: input.nextState
      })).digest('hex');
      const prior = committedReceipts.get(input.idempotencyKey);
      if (prior) {
        if (prior.requestDigest !== requestDigest) throw new Error('idempotency request mismatch');
        return prior.receipt;
      }
      if (input.expectedSequence !== currentState.payload.highestAcceptedSequence ||
          input.expectedDigest !== currentState.payload.lastAcceptedPolicyDigest) {
        const error = new Error('synthetic policy-state CAS conflict');
        error.code = 'HFM_POLICY_STATE_CAS_CONFLICT';
        throw error;
      }
      const next = {
        ...statePayload,
        highestAcceptedSequence: input.nextState.highestAcceptedSequence,
        lastAcceptedPolicyId: input.nextState.lastAcceptedPolicyId,
        lastAcceptedPolicyDigest: input.nextState.lastAcceptedPolicyDigest
      };
      const receiptPayload = {
        contractVersion: '1',
        authorityId: stateAuthority,
        signer: { authorityId: stateAuthority, keyId: 'staging-state-key', keyVersion: '1' },
        issuedAt,
        expiresAt,
        previousSequence: input.expectedSequence,
        nextSequence: input.nextState.highestAcceptedSequence,
        policyId: input.nextState.lastAcceptedPolicyId,
        policyDigest: input.nextState.lastAcceptedPolicyDigest,
        idempotencyKey: input.idempotencyKey,
        requestDigest
      };
      const receipt = signPolicyPayload(receiptPayload, stateKey);
      currentState = signPolicyPayload(next, stateKey);
      committedReceipts.set(input.idempotencyKey, { requestDigest, receipt });
      return receipt;
    }
  };

  return {
    policyEnvelope: signPolicyPayload(policyPayload, policyKey),
    policyStateProvider,
    trustedStateAuthorities: { [stateAuthority]: makeTrust(stateKey, 'staging-state-key') },
    expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers: { [policyIssuer]: makeTrust(policyKey, 'staging-policy-key') },
    trustedPolicyReviewers: {
      [reviewerIds[0]]: { ...makeTrust(reviewerA, 'staging-review-key-a'), role: 'security-reviewer' },
      [reviewerIds[1]]: { ...makeTrust(reviewerB, 'staging-review-key-b'), role: 'policy-owner' }
    },
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers: {
      [evidenceIssuer]: makeTrust(evidenceKey, 'staging-evidence-key')
    }
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
    let blockedSourceReads = 0;
    await assert.rejects(() => runStagingBackupDrill({
      source: { descriptor: backupSource.source.descriptor, async readSnapshot() { blockedSourceReads += 1; } },
      baselineSource: { descriptor: baselineSource.source.descriptor, async readSnapshot() { blockedSourceReads += 1; } },
      request: request('staging-operator-backup', 'unsigned-policy-request-0001', 'unsigned-policy-nonce-0001'),
      baselineRequest: request('staging-operator-baseline', 'unsigned-policy-baseline-0001', 'unsigned-policy-baseline-nonce-01'),
      trustedSources: {
        [backupSource.source.descriptor.sourceId]: backupSource.trusted,
        [baselineSource.source.descriptor.sourceId]: baselineSource.trusted
      },
      keyProvider: testKeyProvider(),
      provenancePolicy: { contractVersion: '1', policyVersion: 'caller-controlled', sources: {} },
      backupDirectory,
      backupFileName: 'mira-hfm-staging-unsigned-policy.mira-hfm.enc.json',
      supportedSchemaVersions: ['1.0.0']
    }), error => error.code === 'HFM_STAGING_POLICY_ACCEPTANCE_REQUIRED');
    assert.equal(blockedSourceReads, 0);
    process.stdout.write('MIRA_HFM_PHASE7_UNSIGNED_POLICY_BLOCKED_BEFORE_SOURCE_READ_PASS\\n');
    const outagePolicy = makePolicyAcceptance(backupSource, baselineSource);
    outagePolicy.policyStateProvider = {
      async readState() { throw new Error('synthetic state authority outage'); },
      async compareAndSwap() { throw new Error('must not commit'); },
      async getCommitReceipt() { throw new Error('must not look up receipt before a state read'); }
    };
    await assert.rejects(() => runStagingBackupDrill({
      source: { descriptor: backupSource.source.descriptor, async readSnapshot() { blockedSourceReads += 1; } },
      baselineSource: { descriptor: baselineSource.source.descriptor, async readSnapshot() { blockedSourceReads += 1; } },
      request: request('staging-operator-backup', 'state-outage-request-0001', 'state-outage-nonce-0001'),
      baselineRequest: request('staging-operator-baseline', 'state-outage-baseline-0001', 'state-outage-baseline-nonce-01'),
      trustedSources: {
        [backupSource.source.descriptor.sourceId]: backupSource.trusted,
        [baselineSource.source.descriptor.sourceId]: baselineSource.trusted
      },
      keyProvider: testKeyProvider(),
      ...outagePolicy,
      backupDirectory,
      backupFileName: 'mira-hfm-staging-state-outage.mira-hfm.enc.json',
      supportedSchemaVersions: ['1.0.0']
    }), error => error.code === 'HFM_POLICY_STATE_UNAVAILABLE');
    assert.equal(blockedSourceReads, 0);
    process.stdout.write('MIRA_HFM_PHASE7_POLICY_STATE_OUTAGE_BLOCKED_BEFORE_SOURCE_READ_PASS\\n');


    const eventOrder = [];
    const policyAcceptance = makePolicyAcceptance(backupSource, baselineSource);
    const baseProvider = policyAcceptance.policyStateProvider;
    policyAcceptance.policyStateProvider = {
      async readState(input) {
        eventOrder.push('policy-state-read');
        return baseProvider.readState(input);
      },
      async compareAndSwap(input) {
        eventOrder.push('policy-state-commit');
        return baseProvider.compareAndSwap(input);
      },
      async getCommitReceipt(input) {
        eventOrder.push('policy-state-receipt-lookup');
        return baseProvider.getCommitReceipt(input);
      }
    };
    const baseEvidenceProvider = policyAcceptance.evidenceProvider;
    policyAcceptance.evidenceProvider = {
      async resolve(input) {
        eventOrder.push('evidence-resolved');
        return baseEvidenceProvider.resolve(input);
      }
    };
    const backupSourceAdapter = {
      descriptor: backupSource.source.descriptor,
      async readSnapshot(input) {
        eventOrder.push('backup-source-read');
        return backupSource.source.readSnapshot(input);
      }
    };
    const baselineSourceAdapter = {
      descriptor: baselineSource.source.descriptor,
      async readSnapshot(input) {
        eventOrder.push('baseline-source-read');
        return baselineSource.source.readSnapshot(input);
      }
    };
    const result = await runStagingBackupDrill({
      source: backupSourceAdapter,
      baselineSource: baselineSourceAdapter,
      request: request('staging-operator-backup', 'backup-request-0001', 'backup-nonce-00000001'),
      baselineRequest: request('staging-operator-baseline', 'baseline-request-0001', 'baseline-nonce-00000001'),
      trustedSources: {
        [backupSource.source.descriptor.sourceId]: backupSource.trusted,
        [baselineSource.source.descriptor.sourceId]: baselineSource.trusted
      },
      keyProvider: testKeyProvider(),
      ...policyAcceptance,
      backupDirectory,
      backupFileName: 'mira-hfm-staging-drill-001.mira-hfm.enc.json',
      supportedSchemaVersions: ['1.0.0']
    });
    assert.equal(result.policyAcceptance.stateCommit.committed, true);
    assert.equal(result.policyAcceptance.evidenceVerification.verifiedCount, 12);
    assert.equal(eventOrder[0], 'policy-state-read');
    assert.equal(eventOrder.filter(event => event === 'evidence-resolved').length, 12);
    assert.ok(eventOrder.indexOf('policy-state-commit') < eventOrder.indexOf('baseline-source-read'));
    assert.ok(eventOrder.indexOf('policy-state-commit') < eventOrder.indexOf('backup-source-read'));
    process.stdout.write('MIRA_HFM_PHASE7_SIGNED_POLICY_BEFORE_SOURCE_READ_PASS\\n');
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
      ...makePolicyAcceptance(backupSource, baselineSource),
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

  const changedBackup = fixture('synthetic-staging-backup-changed', 'different staging knowledge payload');
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
      ...makePolicyAcceptance(changedBackup, independentBaseline),
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
