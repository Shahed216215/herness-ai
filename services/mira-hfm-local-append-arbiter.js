'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  sha256Canonical, CANONICALIZATION_PROFILE, HASH_ALGORITHM, validCanonicalTimestamp
} = require('./mira-audit-chain-independent-verifier');
const { validateGenesis } = require('./mira-hfm-genesis-anchor-store');

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function pathsFor(root, projectId, chainId) {
  const key = crypto.createHash('sha256').update(projectId + '\0' + chainId, 'utf8').digest('hex');
  return {
    stateFile: path.join(root, key + '.chain-state.json'),
    lockFile: path.join(root, key + '.chain.lock')
  };
}
function safeRoot(root) {
  if (!nonEmpty(root)) throw new Error('Append arbiter root is required.');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Append arbiter root is unsafe.');
  return root;
}
function validateChainState(state, projectId, chainId) {
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      state.schemaVersion !== '1.0.0' || state.projectId !== projectId || state.chainId !== chainId ||
      !Array.isArray(state.events)) throw new Error('Append arbiter state schema or scope mismatch.');
  const genesisHash = validateGenesis(state.genesis, projectId, chainId);
  if (genesisHash !== state.trustedGenesisHash) throw new Error('Append arbiter genesis trust pin mismatch.');
  let previousHash = genesisHash;
  let sequence = 0;
  const seen = new Set();
  for (const event of state.events) {
    if (!event || event.projectId !== projectId || event.chainId !== chainId ||
        event.eventSchemaVersion !== '1.0.0' ||
        event.canonicalizationProfile !== CANONICALIZATION_PROFILE ||
        event.hashAlgorithm !== HASH_ALGORITHM ||
        !Number.isSafeInteger(event.sequence) || event.sequence !== sequence + 1 ||
        !nonEmpty(event.eventId) || seen.has(event.eventId) ||
        !validCanonicalTimestamp(event.timestamp) ||
        !nonEmpty(event.actorIdentity) || !nonEmpty(event.action) ||
        event.previousHash !== previousHash) throw new Error('Append arbiter event chain structure is invalid.');
    const calculated = sha256Canonical(event, 'eventHash');
    if (calculated !== event.eventHash) throw new Error('Append arbiter event hash mismatch.');
    seen.add(event.eventId);
    sequence = event.sequence;
    previousHash = event.eventHash;
  }
  if (state.headSequence !== sequence || state.headHash !== previousHash) {
    throw new Error('Append arbiter head does not match the event chain.');
  }
  return { sequence, hash: previousHash };
}
async function acquireLock(lockFile, attempts = 100, delayMs = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const handle = await fs.promises.open(lockFile, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await handle.sync();
      return handle;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  const error = new Error('Append arbiter lock is busy; stale lock recovery is manual and fail-closed.');
  error.code = 'ARBITER_LOCK_BUSY';
  throw error;
}
async function releaseLock(handle, lockFile) {
  await handle.close();
  await fs.promises.unlink(lockFile);
}
async function atomicWriteState(stateFile, state) {
  const directory = path.dirname(stateFile);
  const payload = JSON.stringify(state, null, 2) + '\n';
  const expected = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const temp = path.join(directory, '.' + path.basename(stateFile) + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex'));
  let handle;
  try {
    handle = await fs.promises.open(temp, 'wx', 0o600);
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.promises.rename(temp, stateFile);
    const readback = await fs.promises.readFile(stateFile, 'utf8');
    if (crypto.createHash('sha256').update(readback, 'utf8').digest('hex') !== expected) {
      throw new Error('Append arbiter state readback digest mismatch.');
    }
    return expected;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.unlink(temp).catch(() => {});
    throw error;
  }
}
async function initializeChain({
  root, projectId, chainId, genesis, trustedGenesisHash,
  authorizeInitialize, authorityReference, auditWriter
}) {
  if (typeof authorizeInitialize !== 'function' ||
      authorizeInitialize({ projectId, chainId, authorityReference }) !== true) {
    throw new Error('Explicit append-arbiter initialization authorization denied.');
  }
  if (!nonEmpty(authorityReference) || typeof auditWriter !== 'function') {
    throw new Error('Authority reference and auditWriter are required.');
  }
  const genesisHash = validateGenesis(genesis, projectId, chainId);
  if (genesisHash !== trustedGenesisHash) throw new Error('Trusted genesis hash mismatch.');
  safeRoot(root);
  const { stateFile } = pathsFor(root, projectId, chainId);
  const state = {
    schemaVersion: '1.0.0', projectId, chainId, genesis,
    trustedGenesisHash, headSequence: 0, headHash: genesisHash, events: []
  };
  const payload = JSON.stringify(state, null, 2) + '\n';
  const digest = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  auditWriter({ action: 'hfm_append_arbiter_initialize_intent', projectId, chainId, genesisHash, digest });
  let handle;
  try {
    handle = await fs.promises.open(stateFile, 'wx', 0o600);
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    const readback = JSON.parse(await fs.promises.readFile(stateFile, 'utf8'));
    validateChainState(readback, projectId, chainId);
    auditWriter({ action: 'hfm_append_arbiter_initialized', projectId, chainId, genesisHash, digest });
    return { status: 'INITIALIZED', headSequence: 0, headHash: genesisHash };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error.code === 'EEXIST') throw new Error('Append arbiter chain already exists.');
    if (fs.existsSync(stateFile)) error.stateCommitted = true;
    throw error;
  }
}
async function readChainState({ root, projectId, chainId }) {
  safeRoot(root);
  const { stateFile } = pathsFor(root, projectId, chainId);
  const stat = await fs.promises.lstat(stateFile);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Append arbiter state file is unsafe.');
  const state = JSON.parse(await fs.promises.readFile(stateFile, 'utf8'));
  const head = validateChainState(state, projectId, chainId);
  return { state, head };
}
async function appendEvent({
  root, projectId, chainId, expectedSequence, expectedHeadHash, eventId,
  timestamp, actorIdentity, action, payload = {}, auditWriter,
  lockAttempts = 100, lockDelayMs = 10
}) {
  if (typeof auditWriter !== 'function') throw new Error('Append arbiter auditWriter is required.');
  if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0 ||
      !/^[a-f0-9]{64}$/.test(expectedHeadHash || '')) throw new Error('Expected chain head token is invalid.');
  if (!nonEmpty(eventId) || !validCanonicalTimestamp(timestamp) ||
      !nonEmpty(actorIdentity) || !nonEmpty(action)) throw new Error('Append event identity or metadata is invalid.');
  safeRoot(root);
  const { stateFile, lockFile } = pathsFor(root, projectId, chainId);
  const lock = await acquireLock(lockFile, lockAttempts, lockDelayMs);
  try {
    const { state, head } = await readChainState({ root, projectId, chainId });
    if (head.sequence !== expectedSequence || head.hash !== expectedHeadHash) {
      return { status: 'STALE_HEAD', currentSequence: head.sequence, currentHeadHash: head.hash, writesPerformed: false };
    }
    if (state.events.some(event => event.eventId === eventId)) throw new Error('Duplicate eventId rejected.');
    const event = {
      eventSchemaVersion: '1.0.0', projectId, chainId, eventId,
      sequence: head.sequence + 1, timestamp, actorIdentity, action, payload,
      canonicalizationProfile: CANONICALIZATION_PROFILE, hashAlgorithm: HASH_ALGORITHM,
      previousHash: head.hash, eventHash: ''
    };
    event.eventHash = sha256Canonical(event, 'eventHash');
    const next = {
      ...state, events: [...state.events, event],
      headSequence: event.sequence, headHash: event.eventHash
    };
    validateChainState(next, projectId, chainId);
    auditWriter({ action: 'hfm_append_event_intent', projectId, chainId, eventId, sequence: event.sequence, eventHash: event.eventHash });
    let committed = false;
    try {
      const stateDigest = await atomicWriteState(stateFile, next);
      committed = true;
      const readback = await readChainState({ root, projectId, chainId });
      if (readback.head.sequence !== event.sequence || readback.head.hash !== event.eventHash) {
        throw new Error('Append arbiter authoritative readback mismatch.');
      }
      auditWriter({ action: 'hfm_append_event_committed', projectId, chainId, eventId, sequence: event.sequence, eventHash: event.eventHash, stateDigest });
      return { status: 'APPENDED', event, head: readback.head, stateDigest, writesPerformed: true };
    } catch (error) {
      if (committed) error.stateCommitted = true;
      throw error;
    }
  } finally {
    await releaseLock(lock, lockFile);
  }
}
module.exports = { initializeChain, readChainState, appendEvent, validateChainState, pathsFor };
