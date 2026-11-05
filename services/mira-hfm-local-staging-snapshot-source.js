'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalize, sha256 } = require('./mira-hfm-authoritative-snapshot');
const { verifyAuthorizationDecision } = require('./mira-hfm-authorization-decision');
const { validateSnapshotSigningProvider } = require('./mira-hfm-snapshot-signing-provider-contract');
const { openPinnedDirectory, assertDirectChild } = require('./mira-hfm-pinned-directory');

const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function resolvePinnedFile(rootReal, filePath, label) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    fail(label + ' must be an explicit absolute path inside the staging root.', 'HFM_STAGING_PATH_INVALID');
  }
  let real;
  try { real = fs.realpathSync(filePath); }
  catch { fail(label + ' cannot be resolved.', 'HFM_STAGING_FILE_UNAVAILABLE'); }
  if (real !== path.resolve(filePath) || !isWithin(rootReal, real) || real === rootReal) {
    fail(label + ' is outside the staging root or traverses a symbolic link.', 'HFM_STAGING_PATH_OUTSIDE_ROOT');
  }
  const stat = fs.lstatSync(real);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(label + ' must be a regular, non-symlink file.', 'HFM_STAGING_FILE_UNSAFE');
  }
  if (stat.size > MAX_SOURCE_FILE_BYTES) fail(label + ' exceeds the staging snapshot size limit.', 'HFM_STAGING_FILE_TOO_LARGE');
  return real;
}
function readPinnedJsonArray(filePath, label) {
  let fd;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_SOURCE_FILE_BYTES)) {
      fail(label + ' is not a bounded regular file.', 'HFM_STAGING_FILE_UNSAFE');
    }
    const raw = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs || before.nlink !== 1n ||
        BigInt(raw.length) !== after.size) {
      fail(label + ' changed while being read; snapshot was rejected.', 'HFM_STAGING_FILE_CHANGED_DURING_READ');
    }
    let value;
    try { value = JSON.parse(raw.toString('utf8')); }
    catch { fail(label + ' contains invalid JSON.', 'HFM_STAGING_JSON_INVALID'); }
    if (!Array.isArray(value)) fail(label + ' must contain a JSON array.', 'HFM_STAGING_SCHEMA_INVALID');
    return { entries: value, rawSha256: sha256(raw) };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/**
 * Staging-only source. Authorization is a short-lived signed decision from a
 * separately pinned issuer; a durable atomic replay guard is mandatory.
 */
function createLocalStagingSnapshotSource(config) {
  if (!config || typeof config !== 'object' || config.environment !== 'staging') {
    fail('This adapter only supports an explicitly declared staging environment.', 'HFM_STAGING_ENVIRONMENT_REQUIRED');
  }
  if (typeof config.sourceId !== 'string' || !config.sourceId.trim() ||
      typeof config.signingKeyId !== 'string' || !config.signingKeyId.trim() ||
      !config.signingProvider ||
      typeof config.authorize !== 'function' || !config.authorizationTrust ||
      !config.replayGuard || typeof config.replayGuard.consume !== 'function') {
    fail('Source identity/key, signed authorization provider, independent authorization trust store and replay guard are required.',
      'HFM_STAGING_SOURCE_CONFIG_INVALID');
  }
  if (typeof config.rootDir !== 'string' || !path.isAbsolute(config.rootDir)) {
    fail('An explicit absolute staging root directory is required.', 'HFM_STAGING_ROOT_REQUIRED');
  }
  const rootStat = fs.lstatSync(config.rootDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('Staging root must be a real directory, not a symlink.', 'HFM_STAGING_ROOT_UNSAFE');
  }
  const rootReal = fs.realpathSync(config.rootDir);
  if (rootReal !== path.resolve(config.rootDir)) fail('Staging root path must not traverse a symbolic link.', 'HFM_STAGING_ROOT_UNSAFE');
  const pinnedRoot = openPinnedDirectory(rootReal);
  let memoryFile, knowledgeFile;
  try {
    const memoryName = assertDirectChild(rootReal, config.memoryFile, 'Memory source');
    const knowledgeName = assertDirectChild(rootReal, config.knowledgeFile, 'Knowledge source');
    memoryFile = pinnedRoot.path + '/' + memoryName;
    knowledgeFile = pinnedRoot.path + '/' + knowledgeName;
    for (const [filePath, label] of [[memoryFile, 'Memory source'], [knowledgeFile, 'Knowledge source']]) {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) fail(label + ' must be a regular file.', 'HFM_STAGING_FILE_UNSAFE');
      if (stat.size > MAX_SOURCE_FILE_BYTES) fail(label + ' exceeds the staging snapshot size limit.', 'HFM_STAGING_FILE_TOO_LARGE');
    }
  } catch (error) {
    pinnedRoot.close();
    if (error.code === 'HFM_PINNED_DIRECTORY_CHILD_REQUIRED') error.code = 'HFM_STAGING_PATH_OUTSIDE_ROOT';
    throw error;
  }
  if (memoryFile === knowledgeFile) fail('Memory and Knowledge source files must be distinct.', 'HFM_STAGING_SOURCE_FILES_COLLIDE');

  const signingProvider = config.signingProvider;
  const signingProviderResult = validateSnapshotSigningProvider(signingProvider, {
    environment: config.environment, keyId: config.signingKeyId
  });
  const signingKeyVersion = signingProvider.descriptor.keyVersion;

  const descriptor = Object.freeze({
    contractVersion: '1', sourceId: config.sourceId, signingKeyId: config.signingKeyId,
    signingKeyVersion, signingProviderId: signingProvider.descriptor.providerId,
    mode: 'read-only', environment: 'staging'
  });

  return Object.freeze({
    descriptor,
    close: pinnedRoot.close,
    async readSnapshot(request) {
      if (!request || typeof request.projectId !== 'string' || !request.projectId.trim() ||
          typeof request.actorId !== 'string' || !request.actorId.trim() ||
          request.scope !== 'backup:read' || typeof request.requestId !== 'string' ||
          !request.requestId.trim() || typeof request.nonce !== 'string' || request.nonce.length < 16) {
        fail('A complete project/actor/request/nonce backup-read request is required.', 'HFM_STAGING_REQUEST_INVALID');
      }
      const decision = await config.authorize({
        projectId: request.projectId, actorId: request.actorId, scope: request.scope,
        requestId: request.requestId, nonce: request.nonce
      });
      const authorization = await verifyAuthorizationDecision({
        decision, request, trustedIssuers: config.authorizationTrust,
        replayGuard: config.replayGuard
      });

      const memory = readPinnedJsonArray(memoryFile, 'Mira Memory');
      const knowledge = readPinnedJsonArray(knowledgeFile, 'Mira Knowledge');
      const records = [
        ...memory.entries.map((record, recordIndex) => ({ storeId: 'MIRA_GENERAL_MEMORY', recordIndex, record })),
        ...knowledge.entries.map((record, recordIndex) => ({ storeId: 'MIRA_KNOWLEDGE', recordIndex, record }))
      ];
      const snapshot = { schemaVersion: '1.0.0',
        stores: ['MIRA_GENERAL_MEMORY', 'MIRA_KNOWLEDGE'], records };
      const sourceRevision = sha256(canonicalize({
        memorySha256: memory.rawSha256, knowledgeSha256: knowledge.rawSha256
      }));
      const attestation = {
        sourceId: descriptor.sourceId, signingKeyId: descriptor.signingKeyId,
        signingKeyVersion: descriptor.signingKeyVersion,
        projectId: request.projectId, actorId: request.actorId,
        authorizationDecision: 'ALLOW', authorizationScope: request.scope,
        authorizationIssuerId: authorization.issuerId,
        authorizationDecisionId: authorization.decisionId,
        authorizationPolicyVersion: authorization.policyVersion,
        authorizationExpiresAt: authorization.expiresAt,
        requestId: request.requestId, nonce: request.nonce,
        sourceRevision, schemaVersion: snapshot.schemaVersion,
        capturedAt: new Date().toISOString(), recordCount: records.length,
        payloadSha256: sha256(Buffer.from(canonicalize(snapshot), 'utf8'))
      };
      const signingInput = Buffer.from(canonicalize(attestation), 'utf8');
      let signature;
      try {
        signature = await signingProvider.sign({
          algorithm: 'Ed25519', keyId: descriptor.signingKeyId,
          keyVersion: descriptor.signingKeyVersion, purpose: 'MIRA_HFM_SNAPSHOT_ATTESTATION',
          message: signingInput
        });
      } catch {
        fail('Snapshot signing provider failed; no unsigned snapshot may be returned.',
          'HFM_STAGING_SIGNING_PROVIDER_UNAVAILABLE');
      }
      if (Buffer.isBuffer(signature)) signature = signature.toString('base64');
      if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(signature)) {
        fail('Snapshot signing provider returned an invalid signature encoding.',
          'HFM_STAGING_SIGNING_PROVIDER_SIGNATURE_INVALID');
      }
      attestation.signature = signature;
      return { snapshot, attestation };
    }
  });
}
module.exports = { createLocalStagingSnapshotSource, MAX_SOURCE_FILE_BYTES };
