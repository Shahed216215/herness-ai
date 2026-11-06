'use strict';
const assert = require('node:assert/strict');
const { PROFILE_ID, normalizeTimestamp, isCanonicalTimestamp } = require('../services/mira-hfm-timestamp-profile');

assert.equal(PROFILE_ID, 'MIRA-HFM-TIMESTAMP-RFC3339-UTC-MS-v1');
console.log('U06_VERSIONED_PROFILE_ID=PASS');
assert.equal(normalizeTimestamp('2026-11-03T12:00:00.000Z'), '2026-11-03T12:00:00.000Z');
assert.equal(normalizeTimestamp('2026-11-03T12:00:00Z'), '2026-11-03T12:00:00.000Z');
console.log('U06_CANONICAL_UTC_MILLISECOND_OUTPUT=PASS');
assert.equal(normalizeTimestamp('2026-11-03T17:30:00.000+05:30'), '2026-11-03T12:00:00.000Z');
assert.equal(normalizeTimestamp('2026-11-03T07:00:00.000-05:00'), '2026-11-03T12:00:00.000Z');
console.log('U06_EQUIVALENT_OFFSETS_NORMALIZE_IDENTICALLY=PASS');
assert.equal(normalizeTimestamp('2026-11-03T12:00:00.1Z'), '2026-11-03T12:00:00.100Z');
assert.equal(normalizeTimestamp('2026-11-03T12:00:00.12Z'), '2026-11-03T12:00:00.120Z');
console.log('U06_FRACTIONAL_PRECISION_PADDED_TO_MILLISECONDS=PASS');
for (const bad of [
  '2026-11-03', '2026-11-03T12:00:00', '2026-02-30T12:00:00.000Z',
  '2026-11-03T12:00:60.000Z', '2026-11-03T12:00:00.0001Z',
  '2026-11-03T12:00:00.000-00:00', '2026-11-03T12:00:00.000+24:00',
  '2026-11-03T12:60:00.000Z'
]) assert.throws(() => normalizeTimestamp(bad));
console.log('U06_INVALID_DATE_TIME_OFFSET_LEAP_AND_PRECISION_REJECTED=PASS');
assert.equal(isCanonicalTimestamp('2026-11-03T12:00:00.000Z'), true);
assert.equal(isCanonicalTimestamp('2026-11-03T12:00:00Z'), false);
console.log('U06_CANONICAL_FORM_CHECKED_STRICTLY=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_TIMESTAMP_PROFILE_ISOLATED_PASS');
