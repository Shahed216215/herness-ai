'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildDailyKnowledgePost,
  saveDailyKnowledgePost,
  dateInTimeZone,
  redactObviousSensitiveText
} = require('../services/mira-hfm-daily-knowledge-post');
const { createContentHash, validateCanonicalRecord } = require('../services/mira-hfm-record-schema');

const now = '2026-11-06T12:00:00.000Z';

function sourceRecord(overrides = {}) {
  const content = overrides.content || 'Completed a Python practice session.';
  return {
    schemaVersion: '1.1.0',
    memoryId: overrides.memoryId || 'daily-record-0001',
    projectId: overrides.projectId || 'project-001',
    recordType: overrides.recordType || 'daily_activity',
    content,
    source: {
      sourceType: 'internal_system',
      sourceId: 'mira-session-001',
      observedAt: overrides.observedAt || now
    },
    timestamps: { createdAt: now, updatedAt: now },
    version: { revision: 1, contentHash: createContentHash(content) },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: {
      classification: overrides.classification || 'PROJECT_PRIVATE',
      allowedProjectIds: [overrides.projectId || 'project-001']
    },
    lifecycle: overrides.lifecycle || 'ACTIVE'
  };
}

test('timezone date conversion respects Asia/Dhaka day boundary', () => {
  assert.equal(dateInTimeZone('2026-11-06T17:59:00.000Z', 'Asia/Dhaka'), '2026-11-06');
  assert.equal(dateInTimeZone('2026-11-06T18:00:00.000Z', 'Asia/Dhaka'), '2026-11-07');
});

test('obvious email, link, phone and amount patterns are removed from draft text', () => {
  const clean = redactObviousSensitiveText(
    'Contact user@example.com or +880 1712-345678; budget BDT 5,000. https://example.com/private'
  );
  assert.equal(clean.includes('user@example.com'), false);
  assert.equal(clean.includes('+880'), false);
  assert.equal(clean.includes('5,000'), false);
  assert.equal(clean.includes('https://'), false);
  assert.match(clean, /\[email omitted\]/);
  assert.match(clean, /\[phone\/number omitted\]/);
  assert.match(clean, /\[amount omitted\]/);
  assert.match(clean, /\[link omitted\]/);
});

test('daily post contains only same-project active private activity and learning records for the selected local date', () => {
  const records = [
    sourceRecord({
      memoryId: 'activity-0001',
      content: 'Practised Python functions and lists.',
      observedAt: '2026-11-06T12:00:00.000Z'
    }),
    sourceRecord({
      memoryId: 'learning-0001',
      recordType: 'learning_note',
      content: 'Learned how JSON objects are structured.',
      observedAt: '2026-11-06T13:00:00.000Z'
    }),
    sourceRecord({
      memoryId: 'other-project-01',
      projectId: 'project-002',
      content: 'This belongs to another project.'
    }),
    sourceRecord({
      memoryId: 'wrong-day-0001',
      content: 'This belongs to the next local day.',
      observedAt: '2026-11-06T18:30:00.000Z'
    }),
    sourceRecord({
      memoryId: 'archived-00001',
      content: 'This was archived.',
      lifecycle: 'ARCHIVED'
    }),
    sourceRecord({
      memoryId: 'restricted-001',
      recordType: 'client_vault_record',
      classification: 'RESTRICTED',
      content: JSON.stringify({ client: 'Private Client' })
    })
  ];
  const result = buildDailyKnowledgePost({
    records,
    projectId: 'project-001',
    localDate: '2026-11-06',
    timeZone: 'Asia/Dhaka',
    now
  });
  assert.equal(result.status, 'DRAFT_READY');
  assert.deepEqual([...result.sourceRecordIds].sort(), ['activity-0001', 'learning-0001']);
  assert.deepEqual(result.sourceCounts, { activities: 1, learnings: 1 });
  assert.match(result.draft.content, /আজ যা করেছি:/);
  assert.match(result.draft.content, /আজ যা শিখেছি:/);
  assert.equal(result.draft.content.includes('another project'), false);
  assert.equal(result.draft.content.includes('next local day'), false);
  assert.equal(result.draft.recordType, 'social_post_draft');
  assert.equal(result.draft.access.classification, 'PROJECT_PRIVATE');
  assert.equal(result.draft.projectId, 'project-001');
  assert.equal(result.idempotencyKey, 'daily-post:project-001:2026-11-06');
  assert.equal(result.reviewRequired, true);
  assert.equal(result.autoPublish, false);
  assert.equal(validateCanonicalRecord(result.draft).valid, true);
});

test('daily post ID and idempotency key are stable for the same project and local date', () => {
  const input = {
    records: [sourceRecord({ memoryId: 'stable-source-01' })],
    projectId: 'project-001',
    localDate: '2026-11-06',
    now
  };
  const first = buildDailyKnowledgePost(input);
  const second = buildDailyKnowledgePost(input);
  assert.equal(first.draft.memoryId, second.draft.memoryId);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
});

test('saving a daily draft requires an explicit private-write grant', async () => {
  await assert.rejects(
    saveDailyKnowledgePost({
      records: [sourceRecord()],
      projectId: 'project-001',
      localDate: '2026-11-06',
      now
    }),
    error => error.code === 'HFM_DAILY_POST_PRIVATE_WRITE_NOT_GRANTED'
  );
});

test('daily post persists only through the authority-scoped encrypted repository', async () => {
  const crypto = require('node:crypto');
  const env = {
    MIRA_VAULT_ACTIVE_KEK_VERSION: 'v1',
    MIRA_VAULT_KEK_V1: crypto.randomBytes(32).toString('base64')
  };
  const preview = buildDailyKnowledgePost({
    records: [sourceRecord({ content: 'Practised Python functions.' })],
    projectId: 'project-001',
    localDate: '2026-11-06',
    now
  });
  const context = {
    actorId: 'mira:mira.users:11111111-1111-4111-8111-111111111111',
    projectId: 'project-001',
    operation: 'memory.write',
    requestId: 'daily-post-request-001',
    resource: 'memory:' + preview.draft.memoryId,
    purpose: 'save reviewed daily knowledge draft',
    authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY'
  };
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('SELECT event_hash')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{}] };
    }
  };
  const result = await saveDailyKnowledgePost({
    records: [sourceRecord({ content: 'Practised Python functions.' })],
    projectId: 'project-001',
    localDate: '2026-11-06',
    now,
    client,
    context,
    allowPrivateWrite: true,
    env
  });
  assert.equal(result.status, 'DRAFT_READY');
  assert.equal(result.saved.status, 'CREATED');
  const insert = calls.find(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_records'));
  assert.ok(insert);
  assert.equal(insert.params[10], null);
  assert.equal(insert.params[11].includes('Practised Python functions.'), false);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.autoPublish, false);
});

test('daily post is not created when no eligible records exist', () => {
  const result = buildDailyKnowledgePost({
    records: [sourceRecord({ projectId: 'other-project' })],
    projectId: 'project-001',
    localDate: '2026-11-06',
    now
  });
  assert.equal(result.status, 'NO_DAILY_SOURCE_RECORDS');
  assert.equal(result.draft, null);
  assert.deepEqual(result.sourceRecordIds, []);
  assert.equal(result.autoPublish, false);
});

test('invalid date, project and timezone fail closed', () => {
  assert.throws(
    () => buildDailyKnowledgePost({ records: [], projectId: 'project-001', localDate: '2026-02-30', now }),
    error => error.code === 'HFM_DAILY_POST_LOCAL_DATE_INVALID'
  );
  assert.throws(
    () => buildDailyKnowledgePost({ records: [], projectId: '', localDate: '2026-11-06', now }),
    error => error.code === 'HFM_DAILY_POST_PROJECT_ID_INVALID'
  );
  assert.throws(
    () => buildDailyKnowledgePost({
      records: [sourceRecord()], projectId: 'project-001',
      localDate: '2026-11-06', timeZone: 'Invalid/Timezone', now
    }),
    error => error.code === 'HFM_DAILY_POST_TIME_ZONE_INVALID'
  );
});

console.log('HFM_DAILY_KNOWLEDGE_POST_TESTS=PASS');
