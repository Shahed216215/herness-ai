'use strict';

const crypto = require('node:crypto');
const { createContentHash, validateCanonicalRecord } = require('./mira-hfm-record-schema');
const { createMemoryRecord } = require('./mira-hfm-memory-repository');

const MAX_SOURCE_RECORDS = 500;
const MAX_ITEM_CHARS = 700;
const MAX_POST_CHARS = 6000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateInTimeZone(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw fail('HFM_DAILY_POST_TIMESTAMP_INVALID');
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
  } catch (_error) {
    throw fail('HFM_DAILY_POST_TIME_ZONE_INVALID');
  }
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return map.year + '-' + map.month + '-' + map.day;
}

function localDateStartTimestamp(localDate, timeZone) {
  const [year, month, day] = localDate.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = target;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
  } catch (_error) {
    throw fail('HFM_DAILY_POST_TIME_ZONE_INVALID');
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .map(part => [part.type, part.value]));
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    const adjustment = target - represented;
    candidate += adjustment;
    if (adjustment === 0) return new Date(candidate).toISOString();
  }
  throw fail('HFM_DAILY_POST_TIME_ZONE_INVALID');
}

function redactObviousSensitiveText(value) {
  return String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email omitted]')
    .replace(/\bhttps?:\/\/\S+/gi, '[link omitted]')
    .replace(/(?:BDT|USD|৳|\$)\s?[\d,]+(?:\.\d{1,2})?/gi, '[amount omitted]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, '[phone/number omitted]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ITEM_CHARS);
}

function collectDailySourceRecords(records, projectId, localDate, timeZone) {
  if (!Array.isArray(records) || records.length > MAX_SOURCE_RECORDS) {
    throw fail('HFM_DAILY_POST_SOURCE_LIST_INVALID');
  }
  const activities = [];
  const learnings = [];
  const sourceRecordIds = [];
  for (const record of records) {
    const validation = validateCanonicalRecord(record);
    if (!validation.valid) continue;
    if (record.projectId !== projectId ||
        record.lifecycle !== 'ACTIVE' ||
        record.integrity.status !== 'VERIFIED' ||
        !['CONTENT_VERIFIED', 'HUMAN_VERIFIED'].includes(record.trust.status) ||
        record.access.classification !== 'PROJECT_PRIVATE' ||
        !['daily_activity', 'learning_note'].includes(record.recordType)) {
      continue;
    }
    if (dateInTimeZone(record.source.observedAt, timeZone) !== localDate) continue;
    const content = redactObviousSensitiveText(record.content);
    if (!content) continue;
    const item = { memoryId: record.memoryId, content };
    if (record.recordType === 'daily_activity') activities.push(item);
    if (record.recordType === 'learning_note') learnings.push(item);
    sourceRecordIds.push(record.memoryId);
  }
  return { activities, learnings, sourceRecordIds };
}

function buildDailyKnowledgePost(options = {}) {
  const projectId = options.projectId;
  const localDate = options.localDate;
  const timeZone = options.timeZone || 'Asia/Dhaka';
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 128) {
    throw fail('HFM_DAILY_POST_PROJECT_ID_INVALID');
  }
  if (!validDate(localDate)) throw fail('HFM_DAILY_POST_LOCAL_DATE_INVALID');
  const requestTimestamp = options.now || new Date().toISOString();
  if (typeof requestTimestamp !== 'string' || !Number.isFinite(Date.parse(requestTimestamp))) {
    throw fail('HFM_DAILY_POST_NOW_INVALID');
  }
  const collected = collectDailySourceRecords(options.records, projectId, localDate, timeZone);
  if (collected.activities.length === 0 && collected.learnings.length === 0) {
    return Object.freeze({
      status: 'NO_DAILY_SOURCE_RECORDS',
      draft: null,
      sourceRecordIds: [],
      reviewRequired: true,
      autoPublish: false
    });
  }

  // A fixed local-day boundary keeps the immutable draft digest stable across same-day retries.
  const stableTimestamp = localDateStartTimestamp(localDate, timeZone);
  const compareMemoryId = (left, right) => left.memoryId < right.memoryId ? -1 : left.memoryId > right.memoryId ? 1 : 0;
  collected.activities.sort(compareMemoryId);
  collected.learnings.sort(compareMemoryId);
  collected.sourceRecordIds.sort();

  const lines = [
    'আজকের কাজ ও শেখার সংক্ষিপ্ত নোট — ' + localDate,
    ''
  ];
  if (collected.activities.length) {
    lines.push('আজ যা করেছি:');
    for (const item of collected.activities) lines.push('• ' + item.content);
    lines.push('');
  }
  if (collected.learnings.length) {
    lines.push('আজ যা শিখেছি:');
    for (const item of collected.learnings) lines.push('• ' + item.content);
    lines.push('');
  }
  lines.push('প্রকাশের আগে ব্যক্তিগত, ক্লায়েন্ট ও আর্থিক তথ্য যাচাই করে নিন।');
  lines.push('#DailyProgress #Learning');
  const content = lines.join('\n').slice(0, MAX_POST_CHARS);
  const stableId = crypto.createHash('sha256').update(projectId + ':' + localDate, 'utf8').digest('hex').slice(0, 32);
  const memoryId = 'daily-post-' + stableId;
  const record = {
    schemaVersion: '1.1.0',
    memoryId,
    projectId,
    recordType: 'social_post_draft',
    content,
    source: {
      sourceType: 'internal_system',
      sourceId: 'daily-post:' + projectId + ':' + localDate,
      observedAt: stableTimestamp
    },
    timestamps: { createdAt: stableTimestamp, updatedAt: stableTimestamp },
    version: { revision: 1, contentHash: createContentHash(content) },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: [projectId] },
    lifecycle: 'ACTIVE'
  };
  const validation = validateCanonicalRecord(record);
  if (!validation.valid) throw fail('HFM_DAILY_POST_DRAFT_INVALID');

  return Object.freeze({
    status: 'DRAFT_READY',
    draft: Object.freeze(record),
    sourceRecordIds: Object.freeze(collected.sourceRecordIds),
    sourceCounts: Object.freeze({
      activities: collected.activities.length,
      learnings: collected.learnings.length
    }),
    idempotencyKey: 'daily-post:' + projectId + ':' + localDate,
    reviewRequired: true,
    autoPublish: false,
    timeZone
  });
}

async function saveDailyKnowledgePost(options = {}) {
  const generated = buildDailyKnowledgePost(options);
  if (generated.status !== 'DRAFT_READY') return generated;
  if (options.allowPrivateWrite !== true) throw fail('HFM_DAILY_POST_PRIVATE_WRITE_NOT_GRANTED');
  const saved = await createMemoryRecord({
    client: options.client,
    context: options.context,
    record: generated.draft,
    idempotencyKey: generated.idempotencyKey,
    allowPrivateWrite: true,
    env: options.env || process.env
  });
  return Object.freeze({ ...generated, saved });
}

module.exports = Object.freeze({
  buildDailyKnowledgePost,
  saveDailyKnowledgePost,
  dateInTimeZone,
  redactObviousSensitiveText
});
