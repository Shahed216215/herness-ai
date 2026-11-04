'use strict';

// Structural request validation plus a mandatory trusted host authorization callback.
// This module does not authenticate callers or verify signatures by itself.
const ACTOR_TYPES = new Set(['HUMAN', 'SERVICE', 'AGENT', 'SYSTEM']);
const OPERATIONS = new Set(['READ', 'WRITE', 'LIST', 'VERIFY', 'PLAN_MIGRATION']);
const REQUEST_KEYS = [
  'actorId', 'actorType', 'projectId', 'purpose', 'requestId',
  'authorityRef', 'issuedAt', 'expiresAt'
];
const DECISION_KEYS = [
  'decision', 'actorId', 'actorType', 'projectId', 'purpose', 'requestId',
  'operation', 'resourceScope', 'authorityRef', 'issuedAt', 'expiresAt'
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value, keys) {
  return isObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function requiredText(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(label + ' is required and must be bounded text.');
  }
}
function validTimestamp(value, label) {
  if (typeof value !== 'string') {
    throw new Error(label + ' must be an RFC 3339 date-time.');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error(label + ' must be an RFC 3339 date-time.');
  const [, y, mo, d, h, mi, s, zone] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60) {
    throw new Error(label + ' must be a valid RFC 3339 date-time.');
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) {
    throw new Error(label + ' must be a valid RFC 3339 calendar date.');
  }
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw new Error(label + ' has an invalid UTC offset.');
    }
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(label + ' must be parseable.');
  }
}
function validateRequestContext(context) {
  if (!exactKeys(context, REQUEST_KEYS)) {
    throw new Error('Request context must contain the exact supported fields.');
  }
  requiredText(context.actorId, 'actorId');
  if (!ACTOR_TYPES.has(context.actorType)) throw new Error('actorType is unsupported.');
  requiredText(context.projectId, 'projectId', 128);
  requiredText(context.purpose, 'purpose', 256);
  requiredText(context.requestId, 'requestId', 256);
  requiredText(context.authorityRef, 'authorityRef', 256);
  validTimestamp(context.issuedAt, 'issuedAt');
  validTimestamp(context.expiresAt, 'expiresAt');
  if (Date.parse(context.expiresAt) <= Date.parse(context.issuedAt)) {
    throw new Error('Request context expiry must be after issue time.');
  }
  return Object.freeze({ ...context });
}
function authorizeMemoryRequest({
  requestContext, operation, resourceScope, authorizeRequest, now = new Date()
}) {
  const context = validateRequestContext(requestContext);
  if (!OPERATIONS.has(operation)) throw new Error('Unsupported memory operation.');
  requiredText(resourceScope, 'resourceScope', 512);
  if (typeof authorizeRequest !== 'function') {
    throw new Error('Trusted host authorizeRequest callback is required.');
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('Current time is invalid.');
  if (Date.parse(context.issuedAt) > nowMs) throw new Error('Request context is not yet valid.');
  if (Date.parse(context.expiresAt) <= nowMs) throw new Error('Request context has expired.');

  const decision = authorizeRequest(Object.freeze({
    actorId: context.actorId,
    actorType: context.actorType,
    projectId: context.projectId,
    purpose: context.purpose,
    requestId: context.requestId,
    authorityRef: context.authorityRef,
    operation,
    resourceScope
  }));
  if (!exactKeys(decision, DECISION_KEYS)) {
    throw new Error('Trusted host authorization decision has an invalid shape.');
  }
  if (decision.decision !== 'ALLOW') throw new Error('Memory operation denied by host policy.');
  for (const key of ['actorId', 'actorType', 'projectId', 'purpose', 'requestId', 'authorityRef']) {
    if (decision[key] !== context[key]) {
      throw new Error('Authorization decision binding mismatch: ' + key + '.');
    }
  }
  if (decision.operation !== operation || decision.resourceScope !== resourceScope) {
    throw new Error('Authorization decision operation/resource binding mismatch.');
  }
  validTimestamp(decision.issuedAt, 'authorization issuedAt');
  validTimestamp(decision.expiresAt, 'authorization expiresAt');
  if (Date.parse(decision.issuedAt) < Date.parse(context.issuedAt) ||
      Date.parse(decision.issuedAt) > nowMs || Date.parse(decision.expiresAt) <= nowMs ||
      Date.parse(decision.expiresAt) > Date.parse(context.expiresAt)) {
    throw new Error('Authorization decision is expired, future-dated or outlives request context.');
  }
  return Object.freeze({
    actorId: context.actorId,
    actorType: context.actorType,
    projectId: context.projectId,
    purpose: context.purpose,
    requestId: context.requestId,
    authorityRef: context.authorityRef,
    operation,
    resourceScope,
    authorized: true,
    decisionExpiresAt: decision.expiresAt
  });
}
module.exports = { validateRequestContext, authorizeMemoryRequest, ACTOR_TYPES, OPERATIONS };
