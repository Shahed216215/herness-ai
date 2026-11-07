'use strict';

// Compare RFC3339/PostgreSQL timestamps without losing microsecond or
// nanosecond precision to JavaScript Date's millisecond resolution.
function compareTimestampToNow(value, nowMs) {
  if (typeof value !== 'string' || !Number.isFinite(nowMs)) return null;
  const match = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:[.]([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
  if (match) {
    const calendarParts = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})$/.exec(match[1]);
    if (!calendarParts) return null;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = calendarParts;
    const [year, month, day, hour, minute, second] =
      [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, month - 1, day);
    calendar.setUTCHours(hour, minute, second, 0);
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
        calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour ||
        calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) return null;
    if (match[3] !== 'Z') {
      const offset = /^([+-])([0-9]{2}):([0-9]{2})$/.exec(match[3]);
      if (!offset || Number(offset[2]) > 23 || Number(offset[3]) > 59) return null;
    }
    const wholeSecondMs = Date.parse(match[1] + match[3]);
    if (!Number.isFinite(wholeSecondMs)) return null;
    const fractionalNanos = BigInt(((match[2] || '') + '000000000').slice(0, 9));
    const valueNanos = BigInt(wholeSecondMs) * 1000000n + fractionalNanos;
    const nowNanos = BigInt(Math.trunc(nowMs)) * 1000000n;
    return valueNanos < nowNanos ? -1 : valueNanos > nowNanos ? 1 : 0;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed < nowMs ? -1 : parsed > nowMs ? 1 : 0;
}

module.exports = Object.freeze({ compareTimestampToNow });
