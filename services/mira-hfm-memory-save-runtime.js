'use strict';

const crypto = require('node:crypto');
const { createContentHash, validateCanonicalRecord } = require('./mira-hfm-record-schema');
const { createMemoryRecord } = require('./mira-hfm-memory-repository');
const { approveAndIssueMemoryOperationAuthority } = require('./mira-hfm-authority-approval');
const { executeWithConsumedAuthority } = require('./mira-hfm-authority-transaction');

const MAX_CONTENT_CHARS = 100000;
const MAX_TITLE_CHARS = 300;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function boundedText(value, max, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(code);
  return value.trim();
}

function hasExplicitSaveIntent(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) return false;
  const text = value.toLowerCase();
  const negative = /\b(?:do not|don't|never)\s+(?:remember|save|store|keep)\b/i.test(text) ||
    /(?:মনে\s*রাখ(?:ো|বে|বেন)?\s*না|মনে\s*রেখো\s*না|সংরক্ষণ\s*কর(?:ো|বেন)?\s*না|সেভ\s*কর(?:ো|বেন)?\s*না|রাখবে\s*না)/u.test(value);
  if (negative) return false;
  const english = /\bremember\s+(?:this|that|it)\b/i.test(value) ||
    /\b(?:save|store|keep|add)\b.{0,80}\b(?:to|in)\s+(?:your|my|mira(?:'s)?\s+)?memory\b/i.test(value) ||
    /\b(?:save|store)\s+(?:this|that|it)\s+(?:as|to|in)\s+(?:your|my|mira(?:'s)?\s+)?memory\b/i.test(value);
  const bengali = /(?:মনে\s*রাখ(?:ো|বে|বেন|তে)?|মনে\s*রেখ(?:ো|ো)|সংরক্ষণ\s*কর(?:ো|বেন|ে)?|সেভ\s*কর(?:ো|বেন|ে)?|মেমোরি(?:তে)?\s*(?:রাখ|সংরক্ষণ\s*কর)|নোট\s*করে\s*রাখ)/u.test(value);
  return english || bengali;
}

function deriveIdempotencyKey(taskId, toolCallId, toolName) {
  const task = boundedText(taskId, 256, 'HFM_MEMORY_SAVE_TASK_ID_REQUIRED');
  const call = boundedText(toolCallId, 256, 'HFM_MEMORY_SAVE_TOOL_CALL_ID_REQUIRED');
  const name = boundedText(toolName, 64, 'HFM_MEMORY_SAVE_TOOL_NAME_REQUIRED');
  return 'hfm-' + crypto.createHash('sha256')
    .update(task + '\u0000' + call + '\u0000' + name, 'utf8')
    .digest('hex');
}

function normalizeSourceUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    fail('HFM_KNOWLEDGE_SOURCE_URL_INVALID');
  }
  let parsed;
  try { parsed = new URL(value.trim()); } catch (_error) {
    fail('HFM_KNOWLEDGE_SOURCE_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
    fail('HFM_KNOWLEDGE_SOURCE_URL_NOT_ALLOWED');
  }
  // Remove tracking/query and fragment data before persisting the source reference.
  parsed.search = '';
  parsed.hash = '';
  return parsed.origin + parsed.pathname;
}

function buildCanonicalMemoryRecord(options = {}) {
  const projectId = boundedText(options.projectId, 128, 'HFM_MEMORY_SAVE_PROJECT_REQUIRED');
  const memoryId = boundedText(options.memoryId, 128, 'HFM_MEMORY_SAVE_ID_REQUIRED');
  const now = options.now || new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) fail('HFM_MEMORY_SAVE_TIMESTAMP_INVALID');

  const kind = options.kind;
  if (!['memory_save', 'knowledge_save'].includes(kind)) fail('HFM_MEMORY_SAVE_KIND_INVALID');
  const body = boundedText(options.content, MAX_CONTENT_CHARS, 'HFM_MEMORY_SAVE_CONTENT_REQUIRED');
  let content = body;
  let sourceType = 'manual';
  let sourceId = 'user-confirmed-memory';
  let sourceUrl;
  let trustStatus = 'HUMAN_VERIFIED';
  let lifecycle = 'ACTIVE';

  if (kind === 'knowledge_save') {
    const title = boundedText(options.title, MAX_TITLE_CHARS, 'HFM_KNOWLEDGE_TITLE_REQUIRED');
    sourceUrl = normalizeSourceUrl(options.url);
    content = title + '\n\n' + body;
    if (content.length > MAX_CONTENT_CHARS) fail('HFM_MEMORY_SAVE_CONTENT_TOO_LARGE');
    const parsed = new URL(sourceUrl);
    sourceType = 'web';
    sourceId = 'web-source:' + parsed.hostname + parsed.pathname.slice(0, 256);
    trustStatus = 'SOURCE_RECORDED';
    lifecycle = 'PENDING_REVIEW';
  }

  const record = {
    schemaVersion: '1.1.0',
    memoryId,
    projectId,
    recordType: 'knowledge_item',
    content,
    source: {
      sourceType,
      sourceId,
      ...(sourceUrl ? { sourceUrl } : {}),
      observedAt: now
    },
    timestamps: { createdAt: now, updatedAt: now },
    version: { revision: 1, contentHash: createContentHash(content) },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: trustStatus },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: [projectId] },
    lifecycle
  };
  const validation = validateCanonicalRecord(record);
  if (!validation.valid) fail('HFM_MEMORY_SAVE_RECORD_INVALID');
  return Object.freeze(record);
}

async function saveHfmMemoryRecord(options = {}) {
  if (!hasExplicitSaveIntent(options.userIntent)) fail('HFM_MEMORY_SAVE_EXPLICIT_USER_INTENT_REQUIRED');
  const req = options.req;
  if (!req || !req.session || req.session.authenticated !== true ||
      req.session.role !== 'admin' || !req.session.hfmPrincipal) {
    fail('HFM_MEMORY_SAVE_VERIFIED_ADMIN_REQUIRED');
  }
  const binding = req.session.hfmProjectBinding;
  if (!binding || binding.verified !== true || typeof binding.projectId !== 'string' || !binding.projectId.trim()) {
    fail('HFM_MEMORY_SAVE_VERIFIED_PROJECT_REQUIRED');
  }
  const writerPool = options.writerPool;
  const issuerPool = options.issuerPool;
  if (!writerPool || typeof writerPool.connect !== 'function') fail('HFM_MEMORY_WRITER_POOL_REQUIRED');
  if (!issuerPool || typeof issuerPool.connect !== 'function') fail('HFM_AUTHORITY_ISSUER_POOL_REQUIRED');

  const kind = options.kind;
  const idempotencyKey = options.idempotencyKey ||
    deriveIdempotencyKey(options.taskId, options.toolCallId, options.toolName || kind);
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    fail('HFM_MEMORY_SAVE_IDEMPOTENCY_KEY_INVALID');
  }
  const projectId = binding.projectId;
  const memoryId = 'mem-' + crypto.createHash('sha256')
    .update(projectId + '\u0000' + idempotencyKey, 'utf8')
    .digest('hex').slice(0, 32);
  const record = buildCanonicalMemoryRecord({
    projectId, memoryId, kind, content: options.content,
    title: options.title, url: options.url, now: options.now
  });
  const resource = 'memory:' + memoryId;
  const purpose = kind === 'knowledge_save'
    ? 'User explicitly requested to save a web knowledge source as an unverified item for review.'
    : 'User explicitly requested to save this private memory item.';
  const env = options.env || process.env;

  const issueAuthority = options.issueAuthority || approveAndIssueMemoryOperationAuthority;
  const executeAuthority = options.executeAuthority || executeWithConsumedAuthority;
  const createRecord = options.createRecord || createMemoryRecord;
  const authority = await issueAuthority({
    req, pool: issuerPool, env,
    operation: 'memory.write',
    resource,
    purpose,
    approvalConfirmed: true
  });
  if (!authority || authority.status !== 'AUTHORITY_ISSUED' ||
      authority.projectId !== projectId || authority.operation !== 'memory.write' ||
      authority.resource !== resource || !authority.grant) {
    fail('HFM_MEMORY_SAVE_AUTHORITY_NOT_VERIFIED');
  }

  const committed = await executeAuthority({
    pool: writerPool,
    verifiedPrincipal: req.session.hfmPrincipal,
    request: {
      authorityId: authority.grant.authorityId,
      projectId,
      operation: 'memory.write',
      resource,
      purpose: authority.grant.purpose,
      requestId: authority.grant.requestId
    },
    perform: (client, context) => createRecord({
      client, context, record, idempotencyKey,
      allowPrivateWrite: true, env
    })
  });
  if (!committed || committed.status !== 'AUTHORIZED_AND_COMMITTED' ||
      !committed.value || !['CREATED', 'ALREADY_COMMITTED'].includes(committed.value.status)) {
    fail('HFM_MEMORY_SAVE_COMMIT_NOT_CONFIRMED');
  }

  return Object.freeze({
    success: true,
    saved: true,
    status: committed.value.status,
    memoryId,
    projectId,
    recordType: record.recordType,
    classification: 'PROJECT_PRIVATE',
    trust: record.trust.status,
    lifecycle: record.lifecycle,
    searchable: record.lifecycle === 'ACTIVE' && record.trust.status === 'HUMAN_VERIFIED',
    sourceUrl: record.source.sourceUrl || null,
    idempotencyKey,
    localFallback: false,
    driveFallback: false
  });
}

module.exports = Object.freeze({
  hasExplicitSaveIntent,
  deriveIdempotencyKey,
  normalizeSourceUrl,
  buildCanonicalMemoryRecord,
  saveHfmMemoryRecord
});
