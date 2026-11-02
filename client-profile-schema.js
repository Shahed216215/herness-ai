'use strict';

const ALLOWED_TOP_LEVEL = Object.freeze([
  'id',
  'name',
  'requirements',
  'communication',
  'previousWork',
  'feedback',
  'scope',
  'activeProjects',
  'completedProjects',
  'createdAt',
  'updatedAt'
]);

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pass',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'apikey',
  'authorization',
  'cookie',
  'session',
  'sessionId',
  'privateKey',
  'private_key',
  'cardNumber',
  'card_number',
  'cvv',
  'cvc',
  'pin',
  'otp',
  'nid',
  'nationalId',
  'national_id',
  'passport',
  'passportNumber',
  'passport_number',
  'bankAccount',
  'bank_account',
  'routingNumber',
  'routing_number'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitize(value, depth = 0) {
  if (depth > 12) return undefined;

  if (Array.isArray(value)) {
    return value
      .map(item => sanitize(item, depth + 1))
      .filter(item => item !== undefined);
  }

  if (!isObject(value)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    return undefined;
  }

  const output = {};

  for (const [key, raw] of Object.entries(value)) {
    const normalized = String(key).replace(/[\s_-]/g, '').toLowerCase();

    if (
      SENSITIVE_KEYS.has(key) ||
      SENSITIVE_KEYS.has(String(key)) ||
      [
        'password',
        'passwd',
        'pass',
        'secret',
        'token',
        'accesstoken',
        'refreshtoken',
        'apikey',
        'authorization',
        'cookie',
        'sessionid',
        'privatekey',
        'cardnumber',
        'cvv',
        'cvc',
        'pin',
        'otp',
        'nid',
        'nationalid',
        'passport',
        'passportnumber',
        'bankaccount',
        'routingnumber'
      ].includes(normalized)
    ) {
      continue;
    }

    const clean = sanitize(raw, depth + 1);
    if (clean !== undefined) output[key] = clean;
  }

  return output;
}

function validateProfile(input) {
  if (!isObject(input)) {
    throw new TypeError('CLIENT_PROFILE_OBJECT_REQUIRED');
  }

  if (!input.id || typeof input.id !== 'string') {
    throw new TypeError('CLIENT_PROFILE_ID_REQUIRED');
  }

  if (input.id.length > 160) {
    throw new TypeError('CLIENT_PROFILE_ID_TOO_LONG');
  }

  const unknown = Object.keys(input).filter(
    key => !ALLOWED_TOP_LEVEL.includes(key)
  );

  if (unknown.length) {
    throw new TypeError(
      `CLIENT_PROFILE_UNKNOWN_FIELDS:${unknown.join(',')}`
    );
  }

  return true;
}

function createEmptyProfile(id, name = null) {
  const now = new Date().toISOString();

  return {
    id,
    name: typeof name === 'string' ? name.slice(0, 240) : null,
    requirements: [],
    communication: {
      preferences: [],
      notes: []
    },
    previousWork: [],
    feedback: [],
    scope: {
      included: [],
      excluded: [],
      constraints: []
    },
    activeProjects: [],
    completedProjects: [],
    createdAt: now,
    updatedAt: now
  };
}

module.exports = {
  ALLOWED_TOP_LEVEL,
  SENSITIVE_KEYS,
  sanitize,
  validateProfile,
  createEmptyProfile
};
