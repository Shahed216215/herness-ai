'use strict';

const PROFILE_ID = 'MIRA-HFM-TIMESTAMP-RFC3339-UTC-MS-v1';
const INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
function leapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function normalizeTimestamp(value) {
  if (typeof value !== 'string') throw new Error('Timestamp must be a string.');
  const match = INPUT_PATTERN.exec(value);
  if (!match) throw new Error('Timestamp must be a full RFC 3339 date-time with timezone and at most millisecond precision.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] || '';
  const zone = match[8];
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw new Error('Timestamp component is outside the accepted range.');
  }
  const monthDays = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > monthDays[month - 1]) throw new Error('Timestamp calendar date is invalid.');
  if (zone === '-00:00') throw new Error('Unknown local offset -00:00 is not accepted.');
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) throw new Error('Timestamp timezone offset is invalid.');
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (zone[0] === '+' ? 1 : -1);
  }
  const milliseconds = Number((fraction + '000').slice(0, 3));
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, milliseconds);
  const utc = new Date(local.getTime() - offsetMinutes * 60 * 1000);
  if (!Number.isFinite(utc.getTime())) throw new Error('Timestamp cannot be represented.');
  const normalized = utc.toISOString();
  if (!/^\d{4}-/.test(normalized)) throw new Error('Timestamp is outside the supported four-digit year range.');
  return normalized;
}
function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  try {
    return normalizeTimestamp(value) === value;
  } catch {
    return false;
  }
}
module.exports = { PROFILE_ID, normalizeTimestamp, isCanonicalTimestamp };
