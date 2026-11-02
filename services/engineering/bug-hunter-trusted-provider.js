'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KEY_ENV = 'MIRA_BUG_HUNTER_APPROVAL_HMAC_KEY';
const STORE_ENV = 'MIRA_BUG_HUNTER_REPLAY_STORE';

function getKey() {
  const value = process.env[KEY_ENV];
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32) {
    throw new Error('trusted approval key is not provisioned');
  }
  return Buffer.from(value, 'utf8');
}

function canonicalApproval(a) {
  if (!a || typeof a !== 'object') throw new Error('approval missing');
  const fields = {
    approvalId: a.approvalId,
    planId: a.planId,
    action: a.action,
    approverId: a.approverId,
    issuedAt: a.issuedAt,
    expiresAt: a.expiresAt
  };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== 'string' || !v.trim()) {
      throw new Error('approval field missing: ' + k);
    }
  }
  if (fields.action !== 'stage_repair') throw new Error('approval action mismatch');
  const now = Date.now();
  const issued = Date.parse(fields.issuedAt);
  const expires = Date.parse(fields.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) ||
      issued > now + 30000 || expires <= now || expires <= issued) {
    throw new Error('approval time window invalid');
  }
  return JSON.stringify(fields);
}

function verifySignature(approval) {
  const key = getKey();
  const body = canonicalApproval(approval);
  if (typeof approval.signature !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(approval.signature)) {
    throw new Error('approval signature missing or malformed');
  }
  const expected = crypto.createHmac('sha256', key).update(body).digest();
  const supplied = Buffer.from(approval.signature, 'hex');
  if (supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error('approval signature invalid');
  }
  return body;
}

function storePath() {
  const p = process.env[STORE_ENV];
  if (!p || !path.isAbsolute(p)) {
    throw new Error('absolute durable replay-store path is not configured');
  }
  return p;
}

/*
 * Atomic directory creation serializes consumers on a single local
 * filesystem. A persistent per-approval marker prevents reuse after restart.
 * Fail closed if the lock is already held or storage is unavailable.
 */
function consumeApproval(approvalId) {
  if (typeof approvalId !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,200}$/.test(approvalId)) {
    throw new Error('approval ID invalid');
  }
  const base = storePath();
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const lock = path.join(base, '.consume.lock');
  let locked = false;
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
    locked = true;
    const marker = path.join(
      base,
      crypto.createHash('sha256').update(approvalId).digest('hex') + '.used'
    );
    if (fs.existsSync(marker)) throw new Error('approval replay blocked');
    const fd = fs.openSync(marker, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({
        approvalIdHash: path.basename(marker, '.used'),
        consumedAt: new Date().toISOString()
      }));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const dirFd = fs.openSync(base, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    return true;
  } finally {
    if (locked) fs.rmdirSync(lock);
  }
}

async function validateTrustedApproval(input) {
  // Fail closed until an authenticated, project-owned approval authority
  // can verify issuer identity, approver role, provenance, and replay.
  return Object.freeze({
    valid: false,
    verified: false,
    planId: input && typeof input.planId === 'string' ? input.planId : '',
    approvalId: input && typeof input.approvalId === 'string' ? input.approvalId : '',
    authorityVerified: false,
    provenanceVerified: false,
    replayChecked: false,
    issuerAuthenticated: false,
    approverIdentityVerified: false,
    reason: 'authenticated approval authority is not configured'
  });
}

async function verifyGateEvidence(input) {
  // Never execute caller-selected test paths. A trusted gate registry and
  // project-owned evidence verifier have not been configured.
  return Object.freeze({
    verified: false,
    assertionsPassed: false,
    coverageComplete: false,
    executed: false,
    exitCode: null,
    evidenceRef: input && typeof input.evidenceRef === 'string'
      ? input.evidenceRef : '',
    evidenceHash: '',
    reason: 'trusted gate registry is not configured'
  });
}

module.exports = {
  validateTrustedApproval,
  verifyGateEvidence,
  consumeApproval
};
