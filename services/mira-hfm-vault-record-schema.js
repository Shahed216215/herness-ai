'use strict';

const CLIENT_FIELDS = Object.freeze([
  'clientId', 'clientName', 'organization', 'contactName', 'email', 'phone',
  'address', 'website', 'contractReference', 'projectReference',
  'serviceScope', 'status', 'notes'
]);
const FINANCIAL_FIELDS = Object.freeze([
  'transactionReference', 'invoiceReference', 'counterparty', 'amount',
  'currency', 'transactionDate', 'dueDate', 'category', 'status',
  'paymentMethod', 'accountLast4', 'notes'
]);
const FORBIDDEN_KEYS = new Set([
  'password', 'passcode', 'secret', 'token', 'accesstoken', 'refreshtoken',
  'apikey', 'privatekey', 'clientsecret', 'authorization', 'bearer',
  'cookie', 'session', 'sessionid', 'otp', 'pin', 'cvv', 'cvc',
  'cardnumber', 'accountnumber', 'bankaccount', 'routingnumber',
  'iban', 'swift', 'recoverycode', 'sshkey', 'accesskey',
  'nationalid', 'passportnumber', 'taxid', 'taxpayerid'
]);
const FORBIDDEN_KEY_PATTERN = /(?:password|passcode|secret|token|apikey|privatekey|authorization|bearer|cookie|session|otp|pin|cvv|cvc|cardnumber|accountnumber|routingnumber|iban|swift|recoverycode|sshkey|accesskey|nationalid|passportnumber|taxid|taxpayerid)/;
const MAX_DEPTH = 5;
const MAX_STRING = 4096;
const MAX_FIELDS = 24;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeKey(value) {
  return String(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function validateScalar(value, path, errors, depth = 0) {
  if (depth > MAX_DEPTH) {
    errors.push(path + '.depth_exceeded');
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(path + '.number_invalid');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING || value.trim() !== value) errors.push(path + '.string_invalid');
    if (/(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|bearer\s+[A-Za-z0-9._~+/-]{12,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|(?:sk|pk)-[A-Za-z0-9_-]{24,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/i.test(value)) {
      errors.push(path + '.credential_value_rejected');
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 20) errors.push(path + '.array_too_large');
    value.forEach((item, index) => validateScalar(item, path + '[' + index + ']', errors, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > MAX_FIELDS) errors.push(path + '.too_many_fields');
    for (const key of keys) {
      const normalizedKey = normalizeKey(key);
      if (FORBIDDEN_KEYS.has(normalizedKey) || FORBIDDEN_KEY_PATTERN.test(normalizedKey)) {
        errors.push(path + '.credential_field_rejected:' + key);
      }
      validateScalar(value[key], path + '.' + key, errors, depth + 1);
    }
    return;
  }
  errors.push(path + '.unsupported_value_type');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

function normalizeUserIntent(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    : '';
}

function collectLeafValues(value, out = []) {
  if (typeof value === 'string' && value.trim()) out.push(value.trim());
  else if (typeof value === 'number' && Number.isFinite(value)) out.push(String(value));
  else if (Array.isArray(value)) value.forEach(item => collectLeafValues(item, out));
  else if (isPlainObject(value)) Object.values(value).forEach(item => collectLeafValues(item, out));
  return out;
}

function isVaultPayloadPresentInUserIntent(userIntent, payload) {
  const normalizedIntent = normalizeUserIntent(userIntent);
  if (!normalizedIntent || !isPlainObject(payload)) return false;
  const digitsInIntent = normalizedIntent.replace(/\D/g, '');
  return collectLeafValues(payload).every(value => {
    const normalizedValue = normalizeUserIntent(value);
    if (!normalizedValue) return true;
    if (normalizedIntent.includes(normalizedValue)) return true;
    const digits = normalizedValue.replace(/\D/g, '');
    return digits.length >= 3 && digitsInIntent.includes(digits);
  });
}

function validateClientVaultPayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) return Object.freeze({ valid: false, errors: Object.freeze(['client.object_required']) });
  const keys = Object.keys(payload);
  if (keys.length < 1 || keys.length > CLIENT_FIELDS.length ||
      keys.some(key => !CLIENT_FIELDS.includes(key))) {
    errors.push('client.fields_invalid');
  }
  validateScalar(payload, 'client', errors);
  for (const key of keys) {
    if (typeof payload[key] !== 'string') errors.push('client.' + key + '_must_be_string');
  }
  if (payload.status !== undefined &&
      !['prospect', 'active', 'paused', 'completed', 'inactive', 'unknown'].includes(payload.status)) {
    errors.push('client.status_invalid');
  }
  if (!payload.clientName && !payload.clientId && !payload.organization) {
    errors.push('client.identity_required');
  }
  if (payload.email !== undefined &&
      (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))) {
    errors.push('client.email_invalid');
  }
  if (payload.phone !== undefined &&
      (typeof payload.phone !== 'string' || !/^[+()\-\s\d]{7,24}$/.test(payload.phone) ||
       payload.phone.replace(/\D/g, '').length < 7 || payload.phone.replace(/\D/g, '').length > 15)) {
    errors.push('client.phone_invalid');
  }
  if (payload.website !== undefined) {
    try {
      const url = new URL(payload.website);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
          url.hostname === 'localhost' || url.hostname.endsWith('.local') ||
          /(?:^|[\\/._-])(?:access[_-]?token|auth(?:orization)?|session(?:id)?|api[_-]?key|client[_-]?secret|password|signature|credential|private[_-]?key)(?:[\\/._=-]|$)/i.test(decodeURIComponent(url.pathname))) {
        errors.push('client.website_invalid');
      }
    } catch (_error) {
      errors.push('client.website_invalid');
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function validateFinancialVaultPayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) return Object.freeze({ valid: false, errors: Object.freeze(['financial.object_required']) });
  const keys = Object.keys(payload);
  if (keys.length < 1 || keys.length > FINANCIAL_FIELDS.length ||
      keys.some(key => !FINANCIAL_FIELDS.includes(key))) {
    errors.push('financial.fields_invalid');
  }
  validateScalar(payload, 'financial', errors);
  for (const key of keys) {
    if (key !== 'amount' && typeof payload[key] !== 'string') {
      errors.push('financial.' + key + '_must_be_string');
    }
  }
  if (payload.status !== undefined &&
      !['pending', 'paid', 'overdue', 'refunded', 'cancelled', 'disputed', 'unknown'].includes(payload.status)) {
    errors.push('financial.status_invalid');
  }
  if (!payload.transactionReference && !payload.invoiceReference && !payload.counterparty) {
    errors.push('financial.reference_or_counterparty_required');
  }
  if ((payload.amount !== undefined) !== (payload.currency !== undefined)) {
    errors.push('financial.amount_currency_pair_required');
  }
  if (payload.amount !== undefined &&
      !((typeof payload.amount === 'number' && Number.isFinite(payload.amount) && payload.amount >= 0) ||
        (typeof payload.amount === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(payload.amount)))) {
    errors.push('financial.amount_invalid');
  }
  if (payload.currency !== undefined &&
      (typeof payload.currency !== 'string' || !/^[A-Z]{3}$/.test(payload.currency))) {
    errors.push('financial.currency_invalid');
  }
  for (const field of ['transactionDate', 'dueDate']) {
    if (payload[field] !== undefined &&
        !isCalendarDate(payload[field]))) {
      errors.push('financial.' + field + '_invalid');
    }
  }
  if (payload.paymentMethod !== undefined &&
      !['cash', 'bank_transfer', 'card', 'mobile_money', 'other'].includes(payload.paymentMethod)) {
    errors.push('financial.payment_method_invalid');
  }
  if (payload.accountLast4 !== undefined &&
      (typeof payload.accountLast4 !== 'string' || !/^\d{4}$/.test(payload.accountLast4))) {
    errors.push('financial.account_last4_invalid');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function canonicalVaultPayload(kind, payload) {
  const validation = kind === 'client_vault_save'
    ? validateClientVaultPayload(payload)
    : kind === 'financial_vault_save'
      ? validateFinancialVaultPayload(payload)
      : Object.freeze({ valid: false, errors: Object.freeze(['vault.kind_invalid']) });
  if (!validation.valid) {
    const error = new Error('HFM_VAULT_PAYLOAD_INVALID');
    error.code = 'HFM_VAULT_PAYLOAD_INVALID';
    error.details = validation.errors;
    throw error;
  }
  return Object.freeze(canonicalize(payload));
}

module.exports = Object.freeze({
  CLIENT_FIELDS,
  FINANCIAL_FIELDS,
  validateClientVaultPayload,
  validateFinancialVaultPayload,
  canonicalVaultPayload,
  isVaultPayloadPresentInUserIntent
});
