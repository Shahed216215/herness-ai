'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256Canonical, CANONICALIZATION_PROFILE, HASH_ALGORITHM, validCanonicalTimestamp } =
  require('./mira-audit-chain-independent-verifier');

const HASH_PATTERN = /^[a-f0-9]{64}$/;
function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function safeRoot(root) {
  if (!nonEmpty(root)) throw new Error('Genesis anchor root is required.');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Genesis anchor root is unsafe.');
  return root;
}
function anchorPath(root, projectId, chainId) {
  const key = crypto.createHash('sha256').update(projectId + '\0' + chainId, 'utf8').digest('hex');
  return path.join(root, key + '.genesis-anchor.json');
}
function validateGenesis(genesis, projectId, chainId) {
  if (!genesis || typeof genesis !== 'object' || Array.isArray(genesis)) throw new Error('Genesis object is required.');
  const required = [
    'genesisSchemaVersion', 'genesisId', 'projectId', 'chainId', 'initialSequence',
    'canonicalizationProfile', 'hashAlgorithm', 'createdAt', 'createdBy', 'genesisHash'
  ];
  if (Object.keys(genesis).length !== required.length || required.some(key => !Object.prototype.hasOwnProperty.call(genesis, key))) {
    throw new Error('Genesis fields do not match the strict schema.');
  }
  if (genesis.genesisSchemaVersion !== '1.0.0' || !nonEmpty(genesis.genesisId) ||
      genesis.projectId !== projectId || genesis.chainId !== chainId ||
      genesis.initialSequence !== 0 || genesis.canonicalizationProfile !== CANONICALIZATION_PROFILE ||
      genesis.hashAlgorithm !== HASH_ALGORITHM || !validCanonicalTimestamp(genesis.createdAt) ||
      !nonEmpty(genesis.createdBy) || !HASH_PATTERN.test(genesis.genesisHash || '')) {
    throw new Error('Genesis schema, scope or canonical metadata is invalid.');
  }
  const calculated = sha256Canonical(genesis, 'genesisHash');
  if (calculated !== genesis.genesisHash) throw new Error('Genesis content hash mismatch.');
  return calculated;
}
function createGenesisAnchor({
  root, genesis, projectId, chainId, trustedGenesisHash, trustAnchorId,
  authorityReference, authorizedBy, authorizeCreate, auditWriter
}) {
  if (typeof authorizeCreate !== 'function' || authorizeCreate({
    projectId, chainId, trustAnchorId, authorityReference, authorizedBy
  }) !== true) throw new Error('Explicit genesis creation authorization denied.');
  if (typeof auditWriter !== 'function') throw new Error('Genesis auditWriter is required.');
  if (!nonEmpty(trustAnchorId) || !nonEmpty(authorityReference) || !nonEmpty(authorizedBy)) {
    throw new Error('External trust-anchor and authority references are required.');
  }
  const genesisHash = validateGenesis(genesis, projectId, chainId);
  if (genesisHash !== trustedGenesisHash) throw new Error('Externally provisioned trusted genesis hash mismatch.');
  const directory = safeRoot(root);
  const target = anchorPath(directory, projectId, chainId);
  const envelope = {
    envelopeSchemaVersion: '1.0.0',
    projectId, chainId, trustAnchorId, authorityReference, authorizedBy,
    authenticity: 'PINNED_HASH_ONLY',
    genesisHash,
    genesis,
    createdAt: new Date().toISOString()
  };
  const payload = JSON.stringify(envelope, null, 2) + '\n';
  const envelopeDigest = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  auditWriter({ action: 'hfm_genesis_anchor_create_intent', projectId, chainId, genesisHash, envelopeDigest });
  let fd;
  try {
    fd = fs.openSync(target, 'wx', 0o600);
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    const readback = fs.readFileSync(target, 'utf8');
    if (crypto.createHash('sha256').update(readback, 'utf8').digest('hex') !== envelopeDigest) {
      throw new Error('Genesis anchor readback digest mismatch.');
    }
    auditWriter({ action: 'hfm_genesis_anchor_create_committed', projectId, chainId, genesisHash, envelopeDigest });
    return { ok: true, status: 'CREATED_PINNED_HASH_ONLY', projectId, chainId, genesisHash, envelopeDigest };
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    if (error.code === 'EEXIST') throw new Error('Immutable genesis anchor already exists.');
    if (fs.existsSync(target)) { error.stateCommitted = true; error.envelopeDigest = envelopeDigest; }
    throw error;
  }
}
function verifyGenesisAnchor({ root, projectId, chainId, trustedGenesisHash }) {
  const directory = safeRoot(root);
  const target = anchorPath(directory, projectId, chainId);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Genesis anchor file is unsafe.');
  const raw = fs.readFileSync(target, 'utf8');
  const envelope = JSON.parse(raw);
  if (envelope.envelopeSchemaVersion !== '1.0.0' || envelope.projectId !== projectId ||
      envelope.chainId !== chainId || envelope.authenticity !== 'PINNED_HASH_ONLY') {
    throw new Error('Genesis anchor envelope scope or schema mismatch.');
  }
  const genesisHash = validateGenesis(envelope.genesis, projectId, chainId);
  if (genesisHash !== trustedGenesisHash || envelope.genesisHash !== trustedGenesisHash) {
    throw new Error('Genesis anchor does not match the externally provisioned trust pin.');
  }
  return {
    status: 'VERIFIED_PINNED_HASH_ONLY',
    projectId, chainId, genesisHash, trustAnchorId: envelope.trustAnchorId,
    authorityReference: envelope.authorityReference,
    signatureAuthenticity: 'NOT_PROVIDED',
    writesPerformed: false
  };
}
module.exports = { createGenesisAnchor, verifyGenesisAnchor, validateGenesis };
