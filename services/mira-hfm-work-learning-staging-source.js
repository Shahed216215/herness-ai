'use strict';

// Read-only staging snapshot source for the raw Work Learning JSON state store.
// Project ownership is NOT inferred here; owner-approved per-record mappings
// are applied later by mira-hfm-work-learning-adapter.
const fs = require('node:fs');
const path = require('node:path');
const { canonicalize, sha256 } = require('./mira-hfm-authoritative-snapshot');
const { verifyAuthorizationDecision } = require('./mira-hfm-authorization-decision');
const { validateSnapshotSigningProvider } = require('./mira-hfm-snapshot-signing-provider-contract');
const {
  openPinnedDirectory, assertPrivateDirectory, assertDirectChild, pinnedChildPath
} = require('./mira-hfm-pinned-directory');
const { assertNoSecretFields } = require('./mira-hfm-work-learning-adapter');

const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_RECORDS = 5000;
const PROVENANCE_KEYS = [
  'storageSystemId', 'storageInstanceId', 'securityPrincipalId',
  'trustDomainId', 'sourceSystemId', 'snapshotIssuerId'
];
function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function requiredText(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(label + ' is required bounded text.', 'HFM_WORK_LEARNING_SOURCE_CONFIG_INVALID');
  }
  return value.trim();
}
function validateProvenance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== PROVENANCE_KEYS.length ||
      PROVENANCE_KEYS.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail('All six pinned Work Learning source provenance dimensions are required.',
      'HFM_WORK_LEARNING_PROVENANCE_REQUIRED');
  }
  const result = {};
  for (const key of PROVENANCE_KEYS) result[key] = requiredText(value[key], 'provenance.' + key);
  return Object.freeze(result);
}
function readPinnedStore(pinnedRoot, fileName, expectedOwner) {
  const filePath = pinnedChildPath(pinnedRoot, fileName);
  let fd;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    if (!noFollow) fail('O_NOFOLLOW is required for Work Learning source capture.', 'HFM_WORK_LEARNING_NOFOLLOW_UNAVAILABLE');
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(fd, { bigint: true });
    const namedBefore = fs.lstatSync(filePath, { bigint: true });
    const mode = Number(before.mode & 0o777n);
    if (!before.isFile() || before.size > BigInt(MAX_SOURCE_FILE_BYTES) ||
        before.nlink !== 1n || mode !== 0o600 ||
        Number(before.uid) !== expectedOwner.uid ||
        Number(before.gid) !== expectedOwner.gid ||
        namedBefore.isSymbolicLink() || namedBefore.dev !== before.dev ||
        namedBefore.ino !== before.ino) {
      fail('Work Learning source must be a single-link regular file owned by the workload with mode 0600.',
        'HFM_WORK_LEARNING_SOURCE_FILE_UNSAFE');
    }
    const raw = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    const namedAfter = fs.lstatSync(filePath, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs || before.nlink !== after.nlink ||
        after.nlink !== 1n || namedAfter.isSymbolicLink() ||
        namedAfter.dev !== after.dev || namedAfter.ino !== after.ino ||
        BigInt(raw.length) !== after.size) {
      fail('Work Learning source changed during snapshot read; capture rejected.',
        'HFM_WORK_LEARNING_SOURCE_CHANGED_DURING_READ');
    }
    let store;
    try { store = JSON.parse(raw.toString('utf8')); }
    catch { fail('Work Learning source contains invalid JSON.', 'HFM_WORK_LEARNING_SOURCE_JSON_INVALID'); }
    if (!store || typeof store !== 'object' || Array.isArray(store) ||
        Object.keys(store).length !== 3 ||
        !['version', 'updatedAt', 'records'].every(key => Object.prototype.hasOwnProperty.call(store, key)) ||
        store.version !== 1 || typeof store.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(store.updatedAt)) ||
        !Array.isArray(store.records) || store.records.length > MAX_RECORDS) {
      fail('Work Learning store schema/version/record limit is invalid.',
        'HFM_WORK_LEARNING_SOURCE_SCHEMA_INVALID');
    }
    const ids = new Set();
    for (const record of store.records) {
      if (!record || typeof record !== 'object' || Array.isArray(record) ||
          typeof record.learningId !== 'string' || !record.learningId.trim() ||
          typeof record.taskId !== 'string' || !record.taskId.trim()) {
        fail('Every Work Learning source record requires stable learningId and taskId.',
          'HFM_WORK_LEARNING_SOURCE_RECORD_INVALID');
      }
      if (ids.has(record.learningId)) {
        fail('Duplicate learningId in Work Learning source snapshot.',
          'HFM_WORK_LEARNING_SOURCE_DUPLICATE_ID');
      }
      ids.add(record.learningId);
      try { assertNoSecretFields(record); }
      catch { fail('Work Learning source contains prohibited secret-like fields.',
        'HFM_WORK_LEARNING_SOURCE_SECRET_FIELD'); }
    }
    return { store, rawSha256: sha256(raw), rawBytes: raw.length };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function createWorkLearningStagingSnapshotSource(config) {
  if (!config || typeof config !== 'object' || config.environment !== 'staging') {
    fail('This adapter only supports an explicitly declared staging environment.',
      'HFM_WORK_LEARNING_ENVIRONMENT_REQUIRED');
  }
  const sourceId = requiredText(config.sourceId, 'sourceId');
  const signingKeyId = requiredText(config.signingKeyId, 'signingKeyId');
  const provenance = validateProvenance(config.provenance);
  if (typeof config.authorize !== 'function' || !config.authorizationTrust ||
      !config.replayGuard || typeof config.replayGuard.consume !== 'function' ||
      !config.signingProvider) {
    fail('Signed authorization, independent issuer trust, replay guard and sign-only provider are required.',
      'HFM_WORK_LEARNING_SOURCE_CONFIG_INVALID');
  }
  if (typeof config.rootDir !== 'string' || !path.isAbsolute(config.rootDir) ||
      typeof config.learningFile !== 'string' || !path.isAbsolute(config.learningFile)) {
    fail('Explicit absolute staging root and Work Learning file paths are required.',
      'HFM_WORK_LEARNING_ROOT_REQUIRED');
  }
  const rootStat = fs.lstatSync(config.rootDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('Work Learning staging root must be a real directory.', 'HFM_WORK_LEARNING_ROOT_UNSAFE');
  }
  const rootReal = fs.realpathSync(config.rootDir);
  if (rootReal !== path.resolve(config.rootDir)) {
    fail('Work Learning staging root must not traverse a symbolic link.', 'HFM_WORK_LEARNING_ROOT_UNSAFE');
  }
  const pinnedRoot = openPinnedDirectory(rootReal);
  try {
    if (pinnedRoot.identity.dev !== String(rootStat.dev) ||
        pinnedRoot.identity.ino !== String(rootStat.ino)) {
      fail('Work Learning staging root identity changed before pinning.', 'HFM_PINNED_DIRECTORY_CHANGED');
    }
    const owner = assertPrivateDirectory(pinnedRoot, {
      expectedUid: config.expectedUid,
      expectedGid: config.expectedGid
    });
    const fileName = assertDirectChild(rootReal, config.learningFile, 'Work Learning source');
    const pinnedFile = pinnedChildPath(pinnedRoot, fileName);
    const stat = fs.lstatSync(pinnedFile);
    if (stat.isSymbolicLink() || !stat.isFile() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.uid !== owner.uid || stat.gid !== owner.gid ||
        stat.nlink !== 1 || stat.size > MAX_SOURCE_FILE_BYTES) {
      fail('Work Learning source file must be workload-owned mode 0600, single-link and bounded.',
        'HFM_WORK_LEARNING_SOURCE_FILE_UNSAFE');
    }
  } catch (error) {
    pinnedRoot.close();
    throw error;
  }
  const signingProviderResult = validateSnapshotSigningProvider(config.signingProvider, {
    environment: config.environment, keyId: signingKeyId
  });
  const descriptor = Object.freeze({
    contractVersion: '1',
    sourceId,
    signingKeyId,
    signingKeyVersion: signingProviderResult.keyVersion,
    signingProviderId: signingProviderResult.providerId,
    provenance,
    mode: 'read-only',
    environment: 'staging'
  });

  return Object.freeze({
    descriptor,
    close: pinnedRoot.close,
    async readSnapshot(request) {
      if (!request || typeof request.projectId !== 'string' || !request.projectId.trim() ||
          typeof request.actorId !== 'string' || !request.actorId.trim() ||
          request.scope !== 'backup:read' ||
          typeof request.requestId !== 'string' || !request.requestId.trim() ||
          typeof request.nonce !== 'string' || request.nonce.length < 16) {
        fail('A complete authorized Work Learning store-snapshot request is required.',
          'HFM_WORK_LEARNING_REQUEST_INVALID');
      }
      const decision = await config.authorize({
        projectId: request.projectId,
        actorId: request.actorId,
        scope: request.scope,
        requestId: request.requestId,
        nonce: request.nonce
      });
      const authorization = await verifyAuthorizationDecision({
        decision, request,
        trustedIssuers: config.authorizationTrust,
        replayGuard: config.replayGuard
      });
      const owner = assertPrivateDirectory(pinnedRoot, {
        expectedUid: config.expectedUid,
        expectedGid: config.expectedGid
      });
      const captured = readPinnedStore(pinnedRoot, path.basename(config.learningFile), owner);
      const snapshot = {
        schemaVersion: '1.0.0',
        storeId: 'MIRA_WORK_LEARNING_STORE',
        storeVersion: captured.store.version,
        updatedAt: captured.store.updatedAt,
        sourceFileDigest: captured.rawSha256,
        records: captured.store.records
      };
      const sourceRevision = captured.rawSha256;
      const attestation = {
        sourceId: descriptor.sourceId,
        signingKeyId: descriptor.signingKeyId,
        signingKeyVersion: descriptor.signingKeyVersion,
        projectId: request.projectId,
        actorId: request.actorId,
        authorizationDecision: 'ALLOW',
        authorizationScope: request.scope,
        authorizationIssuerId: authorization.issuerId,
        authorizationDecisionId: authorization.decisionId,
        authorizationPolicyVersion: authorization.policyVersion,
        authorizationExpiresAt: authorization.expiresAt,
        requestId: request.requestId,
        nonce: request.nonce,
        provenance: descriptor.provenance,
        sourceRevision,
        schemaVersion: snapshot.schemaVersion,
        capturedAt: new Date().toISOString(),
        recordCount: snapshot.records.length,
        payloadSha256: sha256(Buffer.from(canonicalize(snapshot), 'utf8'))
      };
      let signature;
      try {
        signature = await config.signingProvider.sign({
          algorithm: 'Ed25519',
          keyId: descriptor.signingKeyId,
          keyVersion: descriptor.signingKeyVersion,
          purpose: 'MIRA_HFM_SNAPSHOT_ATTESTATION',
          message: Buffer.from(canonicalize(attestation), 'utf8')
        });
      } catch {
        fail('Work Learning snapshot signer failed; unsigned snapshots are rejected.',
          'HFM_WORK_LEARNING_SIGNING_FAILED');
      }
      if (Buffer.isBuffer(signature)) signature = signature.toString('base64');
      if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(signature)) {
        fail('Work Learning snapshot signer returned invalid signature encoding.',
          'HFM_WORK_LEARNING_SIGNATURE_INVALID');
      }
      attestation.signature = signature;
      return { snapshot, attestation };
    }
  });
}
module.exports = { createWorkLearningStagingSnapshotSource, MAX_SOURCE_FILE_BYTES, MAX_RECORDS };
