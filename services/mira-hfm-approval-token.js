'use strict';

const crypto = require('node:crypto');

const MAX_TOKEN_LENGTH = 8192;
const MAX_APPROVAL_TTL_MS = 5 * 60 * 1000;
const REQUIRED_FIELDS = Object.freeze([
  'approvalRef', 'nonce', 'projectId', 'actorId', 'approverActorId',
  'operation', 'resource', 'purpose', 'issuedAt', 'expiresAt', 'maxUses'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function secretBytes(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw fail('HFM_APPROVAL_TOKEN_SECRET_INVALID');
  }
  return Buffer.from(secret, 'utf8');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonicalJson(value[key])
  ).join(',') + '}';
}

function bounded(value, max, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.trim() !== value) {
    throw fail(code);
  }
  return value;
}

function validatePayload(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw fail('HFM_APPROVAL_TOKEN_PAYLOAD_INVALID');
  }
  const keys = Object.keys(payload).sort();
  const expectedKeys = [...REQUIRED_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw fail('HFM_APPROVAL_TOKEN_FIELDS_INVALID');
  }
  const clean = {
    approvalRef: bounded(payload.approvalRef, 256, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    nonce: bounded(payload.nonce, 128, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    projectId: bounded(payload.projectId, 256, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    actorId: bounded(payload.actorId, 512, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    approverActorId: bounded(payload.approverActorId, 512, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    operation: bounded(payload.operation, 128, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    resource: bounded(payload.resource, 512, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    purpose: bounded(payload.purpose, 512, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    issuedAt: bounded(payload.issuedAt, 64, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    expiresAt: bounded(payload.expiresAt, 64, 'HFM_APPROVAL_TOKEN_FIELDS_INVALID'),
    maxUses: payload.maxUses
  };
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(clean.nonce) || clean.maxUses !== 1) {
    throw fail('HFM_APPROVAL_TOKEN_SINGLE_USE_REQUIRED');
  }
  const issuedAt = Date.parse(clean.issuedAt);
  const expiresAt = Date.parse(clean.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt > now || expiresAt <= now || expiresAt <= issuedAt ||
      expiresAt - issuedAt > MAX_APPROVAL_TTL_MS) {
    throw fail('HFM_APPROVAL_TOKEN_TIME_INVALID');
  }
  return Object.freeze(clean);
}

function signApprovalToken(options = {}) {
  const key = secretBytes(options.secret);
  const payload = validatePayload(options.payload);
  const encoded = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', key).update(encoded, 'utf8').digest('base64url');
  return encoded + '.' + signature;
}

function createApprovalTokenVerifier(options = {}) {
  const key = secretBytes(options.secret);
  if (typeof options.consumeNonce !== 'function') {
    throw fail('HFM_APPROVAL_NONCE_CONSUMER_REQUIRED');
  }

  return async function verifyApprovalToken(token, expected, control = {}) {
    if (control.consume !== true || control.singleUse !== true) {
      throw fail('HFM_APPROVAL_TOKEN_CONSUMPTION_REQUIRED');
    }
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) {
      throw fail('HFM_APPROVAL_TOKEN_FORMAT_INVALID');
    }
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw fail('HFM_APPROVAL_TOKEN_FORMAT_INVALID');
    }
    const expectedSignature = crypto.createHmac('sha256', key)
      .update(parts[0], 'utf8').digest();
    let suppliedSignature;
    try {
      suppliedSignature = Buffer.from(parts[1], 'base64url');
    } catch (_error) {
      throw fail('HFM_APPROVAL_TOKEN_SIGNATURE_INVALID');
    }
    if (suppliedSignature.length !== expectedSignature.length ||
        !crypto.timingSafeEqual(suppliedSignature, expectedSignature)) {
      throw fail('HFM_APPROVAL_TOKEN_SIGNATURE_INVALID');
    }

    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch (_error) {
      throw fail('HFM_APPROVAL_TOKEN_PAYLOAD_INVALID');
    }
    const payload = validatePayload(parsed);
    if (!expected || typeof expected !== 'object' ||
        payload.projectId !== expected.projectId ||
        payload.actorId !== expected.actorId ||
        payload.approverActorId !== expected.approverActorId ||
        payload.operation !== expected.operation ||
        payload.resource !== expected.resource ||
        payload.purpose !== expected.purpose) {
      throw fail('HFM_APPROVAL_TOKEN_SCOPE_MISMATCH');
    }

    const nonceHash = crypto.createHash('sha256').update(payload.nonce, 'utf8').digest('hex');
    let consumed = false;
    try {
      consumed = await options.consumeNonce(Object.freeze({
        nonceHash,
        approvalRef: payload.approvalRef,
        projectId: payload.projectId,
        actorId: payload.actorId,
        approverActorId: payload.approverActorId,
        operation: payload.operation,
        resource: payload.resource,
        purpose: payload.purpose,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        singleUse: true
      })) === true;
    } catch (_error) {
      throw fail('HFM_APPROVAL_TOKEN_NONCE_CONSUMPTION_FAILED');
    }
    if (!consumed) throw fail('HFM_APPROVAL_TOKEN_REPLAY_OR_UNKNOWN');

    return Object.freeze({
      verified: true,
      approved: true,
      consumed: true,
      maxUses: 1,
      approvalRef: payload.approvalRef,
      projectId: payload.projectId,
      actorId: payload.actorId,
      approverActorId: payload.approverActorId,
      operation: payload.operation,
      resource: payload.resource,
      purpose: payload.purpose,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt
    });
  };
}

module.exports = Object.freeze({
  MAX_TOKEN_LENGTH,
  MAX_APPROVAL_TTL_MS,
  canonicalJson,
  validatePayload,
  signApprovalToken,
  createApprovalTokenVerifier
});
