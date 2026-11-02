'use strict';

const FOLLOW_UP_STATUSES = Object.freeze([
  'eligible',
  'blocked',
  'cooldown',
  'duplicate',
  'already_followed',
  'limit_reached',
  'draft_ready',
  'sent'
]);

const ELIGIBILITY_REASONS = Object.freeze([
  'PROJECT_NOT_COMPLETE',
  'PROJECT_COMPLETE',
  'CLIENT_NOT_FOUND',
  'CLIENT_BLOCKED',
  'DO_NOT_CONTACT',
  'COOLDOWN_ACTIVE',
  'DUPLICATE_MESSAGE',
  'ALREADY_FOLLOWED_UP',
  'FOLLOW_UP_LIMIT_REACHED',
  'ELIGIBLE'
]);

function requiredString(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function normalizeFollowUp(input = {}) {
  if (!input || typeof input !== 'object') {
    throw new Error('FOLLOW_UP_OBJECT_REQUIRED');
  }

  const now = new Date().toISOString();

  const record = {
    id: requiredString(
      input.id,
      'id'
    ),

    projectId: requiredString(
      input.projectId,
      'projectId'
    ),

    clientId: requiredString(
      input.clientId,
      'clientId'
    ),

    status:
      input.status === undefined
        ? 'eligible'
        : input.status,

    eligibilityReason:
      input.eligibilityReason === undefined
        ? 'ELIGIBLE'
        : input.eligibilityReason,

    message:
      input.message === undefined ||
      input.message === null
        ? ''
        : String(input.message),

    messageHash:
      input.messageHash === undefined ||
      input.messageHash === null
        ? null
        : String(input.messageHash),

    attemptCount:
      Number.isInteger(input.attemptCount) &&
      input.attemptCount >= 0
        ? input.attemptCount
        : 0,

    lastFollowUpAt:
      input.lastFollowUpAt || null,

    nextEligibleAt:
      input.nextEligibleAt || null,

    createdAt:
      input.createdAt || now,

    updatedAt:
      input.updatedAt || now,

    auditId:
      input.auditId || null
  };

  if (!FOLLOW_UP_STATUSES.includes(record.status)) {
    throw new Error(
      `INVALID_FOLLOW_UP_STATUS:${record.status}`
    );
  }

  if (!ELIGIBILITY_REASONS.includes(record.eligibilityReason)) {
    throw new Error(
      `INVALID_ELIGIBILITY_REASON:${record.eligibilityReason}`
    );
  }

  return record;
}

function validateFollowUp(record) {
  const errors = [];

  if (!record || typeof record !== 'object') {
    return {
      valid: false,
      errors: ['follow-up must be an object']
    };
  }

  for (const field of [
    'id',
    'projectId',
    'clientId'
  ]) {
    if (
      typeof record[field] !== 'string' ||
      !record[field].trim()
    ) {
      errors.push(`${field} is required`);
    }
  }

  if (!FOLLOW_UP_STATUSES.includes(record.status)) {
    errors.push(
      `invalid status: ${record.status}`
    );
  }

  if (!ELIGIBILITY_REASONS.includes(
    record.eligibilityReason
  )) {
    errors.push(
      `invalid eligibilityReason: ${record.eligibilityReason}`
    );
  }

  if (
    typeof record.message !== 'string'
  ) {
    errors.push('message must be a string');
  }

  if (
    !Number.isInteger(record.attemptCount) ||
    record.attemptCount < 0
  ) {
    errors.push(
      'attemptCount must be a non-negative integer'
    );
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  FOLLOW_UP_STATUSES,
  ELIGIBILITY_REASONS,
  normalizeFollowUp,
  validateFollowUp
};
