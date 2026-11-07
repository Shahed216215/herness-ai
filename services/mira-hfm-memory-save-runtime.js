'use strict';

const crypto = require('node:crypto');
const { createContentHash, validateCanonicalRecord, SCHEMA_V1_2 } = require('./mira-hfm-record-schema');
const { normalizeTrustedActorIdentity } = require('./mira-memory-host-identity-contract');
const { buildUserSuppliedSourceReferencePayload } = require('./mira-hfm-source-reference-schema');
const { canonicalVaultPayload, isVaultPayloadPresentInUserIntent } = require('./mira-hfm-vault-record-schema');
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

function redactDailyActivityContent(value) {
  return String(value || '')
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|password|passwd|secret|authorization)\b\s*(?:is|[:=])\s*(?:bearer\s+)?[^\s,;]+/gi, '[credential omitted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]{12,}/gi, '[credential omitted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[credential omitted]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[credential omitted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email omitted]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, match =>
      match.replace(/\D/g, '').length >= 10 ? '[phone/number omitted]' : match)
    .replace(/(?:BDT|USD|৳|\$)\s?[\d,]+(?:\.\d{1,2})?/gi, '[amount omitted]')
    .replace(/\bhttps?:\/\/\S+/gi, '[link omitted]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasVaultOnlyDailyActivityContent(value) {
  const text = String(value || '');
  return /\b(?:private key|client email|client phone|client name|client address|client id|customer email|customer phone|customer name|customer address|bank account|account number|card number|invoice(?: number)?|transaction(?: id| reference)?|payment reference|contract(?: text| clause)?|national id|passport number|tax id|taxpayer id|tin|vat number|swift code|iban|routing number|sort code)\b/i.test(text) ||
    /\b(?:client|customer|account|contract|invoice|transaction|payment|bank|card|vendor|supplier)\s*(?:id|identifier|no\.?|number|#|code|reference|ref)\s*[:=#-]?\s*[A-Z0-9][A-Z0-9/_-]{2,}\b/i.test(text);
}
function hasExplicitDailyActivitySaveIntent(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) return false;
  const text = value.toLowerCase();
  if (/\b(?:do not|don't|never|should not|shouldn't|must not|avoid)\b.{0,70}\b(?:daily activity|daily work summary|activity log)\b/i.test(text) ||
      /(?:দৈনিক\s*কাজ|আজকের\s*কাজ|কাজের\s*সারাংশ|অ্যাক্টিভিটি\s*লগ).{0,80}(?:সংরক্ষণ\s*কর(?:ো|বেন)?|সেভ\s*কর(?:ো|বেন)?|রেকর্ড\s*কর(?:ো|বেন)?|লিখে\s*রাখ(?:ো|বে|বেন)?).{0,10}না/u.test(value)) {
    return false;
  }
  const english = /\b(?:save|store|record|log)\b.{0,100}\b(?:daily activity|daily work summary|activity log)\b/i.test(value) ||
    /\b(?:daily activity|daily work summary|activity log)\b.{0,100}\b(?:save|store|record|log)\b/i.test(value);
  const bengali = /(?:দৈনিক|আজকের).{0,100}(?:কাজ|কার্যক্রম|অ্যাক্টিভিটি).{0,80}(?:সংরক্ষণ|সেভ|রেকর্ড|লিখে\s*রাখ)/u.test(value) ||
    /(?:কাজের\s*সারাংশ|অ্যাক্টিভিটি\s*লগ).{0,80}(?:সংরক্ষণ|সেভ|রেকর্ড|লিখে\s*রাখ)/u.test(value) ||
    /(?:সংরক্ষণ|সেভ|রেকর্ড|লিখে\s*রাখ).{0,100}(?:দৈনিক|আজকের).{0,80}(?:কাজ|কার্যক্রম|অ্যাক্টিভিটি)/u.test(value);
  return english || bengali;
}

function hasExplicitSourceReferenceSaveIntent(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) return false;
  const text = value.toLowerCase();
  if (/\b(?:do not|don't|never|should not|shouldn't|must not|avoid)\b.{0,80}\b(?:source|reference|link|url)\b/i.test(text) ||
      /(?:সোর্স|উৎস|রেফারেন্স|লিংক|ইউআরএল).{0,80}(?:সংরক্ষণ|সেভ|রেকর্ড|রাখ).{0,10}না/u.test(value)) return false;
  return /\b(?:save|store|record|keep|add)\b.{0,100}\b(?:source|reference|link|url)\b/i.test(value) ||
    /\b(?:source|reference|link|url)\b.{0,100}\b(?:save|store|record|keep|add)\b/i.test(value) ||
    /(?:সোর্স|উৎস|রেফারেন্স|লিংক|ইউআরএল).{0,80}(?:সংরক্ষণ|সেভ|রেকর্ড|রাখ)/u.test(value) ||
    /(?:সংরক্ষণ|সেভ|রেকর্ড|রাখ).{0,80}(?:সোর্স|উৎস|রেফারেন্স|লিংক|ইউআরএল)/u.test(value);
}

function hasExplicitVaultSaveIntent(kind, value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) return false;
  const client = kind === 'client_vault_save';
  if (!client && kind !== 'financial_vault_save') return false;
  const terms = client
    ? /\b(?:client|customer)\b.{0,100}\b(?:vault|record|details)\b/i
    : /\b(?:financial|finance|transaction|invoice|payment)\b.{0,100}\b(?:vault|record|details)\b/i;
  const negative = /\b(?:do not|don't|never|should not|shouldn't|must not|avoid)\b.{0,100}\b(?:client|customer|financial|finance|transaction|invoice|payment)\b/i.test(value);
  const bengaliNegative = /(?:ক্লায়েন্ট|ক্লায়েন্ট|গ্রাহক|আর্থিক|লেনদেন|ইনভয়েস|ইনভয়েস|পেমেন্ট).{0,100}(?:সংরক্ষণ|সেভ|রেকর্ড|রাখ).{0,10}না/u.test(value);
  if (negative || bengaliNegative) return false;
  const english = /\b(?:save|store|record|keep)\b.{0,100}/i.test(value) && terms.test(value) ||
    terms.test(value) && /\b(?:save|store|record|keep)\b/i.test(value);
  const bengali = client
    ? /(?:ক্লায়েন্ট|ক্লায়েন্ট|গ্রাহক).{0,100}(?:ভল্ট|রেকর্ড|তথ্য).{0,80}(?:সংরক্ষণ|সেভ|রেকর্ড|রাখ)/u.test(value) ||
      /(?:সংরক্ষণ|সেভ|রেকর্ড|রাখ).{0,100}(?:ক্লায়েন্ট|ক্লায়েন্ট|গ্রাহক)/u.test(value)
    : /(?:আর্থিক|লেনদেন|ইনভয়েস|ইনভয়েস|পেমেন্ট).{0,100}(?:ভল্ট|রেকর্ড|তথ্য).{0,80}(?:সংরক্ষণ|সেভ|রেকর্ড|রাখ)/u.test(value) ||
      /(?:সংরক্ষণ|সেভ|রেকর্ড|রাখ).{0,100}(?:আর্থিক|লেনদেন|ইনভয়েস|ইনভয়েস|পেমেন্ট)/u.test(value);
  return english || bengali;
}

function hasExplicitSaveIntent(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) return false;
  const text = value.toLowerCase();
  const positiveNegationException = /\b(?:don't|do not)\s+forget\s+to\s+(?:remember|save|store|keep)\b/i.test(text);
  const negative = !positiveNegationException && (
    /\b(?:do not|don't|never|should not|shouldn't|must not|avoid)\b.{0,50}\b(?:remember|save|store|keep|record|log)\b/i.test(text) ||
    /(?:মনে\s*রাখ(?:ো|বে|বেন)?\s*না|মনে\s*রেখো\s*না|সংরক্ষণ\s*কর(?:ো|বেন)?\s*না|সেভ\s*কর(?:ো|বেন)?\s*না|রাখবে\s*না)/u.test(value)
  );
  if (negative) return false;
  const english = /\bremember\s+(?:this|that|it)\b/i.test(value) ||
    /\b(?:save|store|keep|add)\b.{0,100}\b(?:to|in)\s+(?:(?:your|my)\s+|mira(?:'s)?\s+)?(?:memory|knowledge\s+base)\b/i.test(value) ||
    /\b(?:save|store)\s+(?:this|that|it|the\s+learning)\s+(?:as|to|in)\s+(?:(?:your|my)\s+|mira(?:'s)?\s+)?(?:memory|knowledge\s+base)\b/i.test(value) ||
    /\b(?:save|store|record|log)\b.{0,100}\b(?:daily activity|daily work summary|activity log)\b/i.test(value);
  const bengali = /(?:মনে\s*রাখ(?:ো|বে|বেন|তে)?|মনে\s*রেখ(?:ো|ো))/u.test(value) ||
    /(?:সংরক্ষণ|সেভ|রাখ).{0,60}(?:মেমোরি|স্মৃতি|জ্ঞানভাণ্ডার|জ্ঞানভান্ডার|নলেজ\s*বেস)|(?:মেমোরি|স্মৃতি|জ্ঞানভাণ্ডার|জ্ঞানভান্ডার|নলেজ\s*বেস).{0,60}(?:রাখ|সংরক্ষণ|সেভ)/u.test(value) ||
    /(?:দৈনিক\s*কাজ|কাজের\s*সারাংশ|অ্যাক্টিভিটি\s*লগ).{0,80}(?:সংরক্ষণ|সেভ|রেকর্ড|রাখ)/u.test(value);
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

function normalizeIntentText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUserAuthoredMemoryContent(userIntent, content) {
  const normalizedIntent = normalizeIntentText(userIntent);
  const normalizedContent = normalizeIntentText(content);
  return Boolean(normalizedContent && normalizedIntent.includes(normalizedContent));
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
  if (!['memory_save', 'knowledge_save', 'learning_save', 'daily_activity_save', 'source_reference_save', 'client_vault_save', 'financial_vault_save'].includes(kind)) fail('HFM_MEMORY_SAVE_KIND_INVALID');
  const body = boundedText(kind === 'source_reference_save' ? options.url : options.content,
    MAX_CONTENT_CHARS, 'HFM_MEMORY_SAVE_CONTENT_REQUIRED');
  if (kind === 'daily_activity_save' &&
      !hasExplicitDailyActivitySaveIntent(options.userIntent)) {
    fail('HFM_DAILY_ACTIVITY_EXPLICIT_USER_INTENT_REQUIRED');
  }
  if ((kind === 'memory_save' || kind === 'daily_activity_save') &&
      !isUserAuthoredMemoryContent(options.userIntent, body)) {
    fail(kind === 'daily_activity_save'
      ? 'HFM_DAILY_ACTIVITY_CONTENT_NOT_PRESENT_IN_USER_INTENT'
      : 'HFM_MEMORY_SAVE_CONTENT_NOT_PRESENT_IN_USER_INTENT');
  }
  let content = body;
  let sourceType = 'manual';
  let sourceId = 'user-confirmed-memory';
  let sourceUrl;
  let recordType = 'knowledge_item';
  let trustStatus = 'HUMAN_VERIFIED';
  let lifecycle = 'ACTIVE';
  let schemaVersion = '1.1.0';
  let classification = 'PROJECT_PRIVATE';

  if (kind === 'daily_activity_save') {
    if (hasVaultOnlyDailyActivityContent(body)) {
      fail('HFM_DAILY_ACTIVITY_SENSITIVE_CONTENT_REQUIRES_VAULT');
    }
    content = redactDailyActivityContent(body);
    if (!content) fail('HFM_DAILY_ACTIVITY_CONTENT_EMPTY_AFTER_REDACTION');
    sourceId = 'user-confirmed-daily-activity';
    recordType = 'daily_activity';
  }

  if (kind === 'source_reference_save') {
    if (!hasExplicitSourceReferenceSaveIntent(options.userIntent)) {
      fail('HFM_SOURCE_REFERENCE_EXPLICIT_USER_INTENT_REQUIRED');
    }
    if (!isUserAuthoredMemoryContent(options.userIntent, options.url)) {
      fail('HFM_SOURCE_REFERENCE_URL_NOT_PRESENT_IN_USER_INTENT');
    }
    let actor;
    try {
      actor = normalizeTrustedActorIdentity({ verifiedPrincipal: options.req?.session?.hfmPrincipal });
    } catch (_error) {
      fail('HFM_SOURCE_REFERENCE_TRUSTED_ACTOR_REQUIRED');
    }
    const eventSeed = projectId + '\u0000' +
      boundedText(options.taskId, 256, 'HFM_MEMORY_SAVE_TASK_ID_REQUIRED') + '\u0000' +
      boundedText(options.toolCallId, 256, 'HFM_MEMORY_SAVE_TOOL_CALL_ID_REQUIRED') + '\u0000' +
      boundedText(options.toolName || kind, 64, 'HFM_MEMORY_SAVE_TOOL_NAME_REQUIRED');
    const provenanceEventId = 'evt-' + crypto.createHash('sha256').update(eventSeed, 'utf8').digest('hex');
    const payload = buildUserSuppliedSourceReferencePayload({
      url: options.url,
      sourceType: options.sourceType || 'web',
      provenanceActor: actor.actorId,
      provenanceEventId,
      retrievedAt: now
    });
    content = JSON.stringify(payload);
    sourceType = payload.sourceType;
    sourceId = payload.sourceId;
    sourceUrl = payload.canonicalUrl;
    recordType = 'source_reference';
    trustStatus = 'SOURCE_RECORDED';
    lifecycle = 'ACTIVE';
    schemaVersion = SCHEMA_V1_2;
  }

  if (kind === 'client_vault_save' || kind === 'financial_vault_save') {
    if (!hasExplicitVaultSaveIntent(kind, options.userIntent)) {
      fail('HFM_VAULT_EXPLICIT_USER_INTENT_REQUIRED');
    }
    let payload;
    try { payload = JSON.parse(body); } catch (_error) {
      fail('HFM_VAULT_PAYLOAD_JSON_REQUIRED');
    }
    const canonicalPayload = canonicalVaultPayload(kind, payload);
    if (!isVaultPayloadPresentInUserIntent(options.userIntent, canonicalPayload)) {
      fail('HFM_VAULT_PAYLOAD_NOT_PRESENT_IN_USER_INTENT');
    }
    content = JSON.stringify(canonicalPayload);
    recordType = kind === 'client_vault_save' ? 'client_vault_record' : 'financial_vault_record';
    sourceId = kind === 'client_vault_save'
      ? 'user-provided-client-vault-record'
      : 'user-provided-financial-vault-record';
    trustStatus = 'SOURCE_RECORDED';
    lifecycle = 'PENDING_REVIEW';
    classification = 'RESTRICTED';
  }

  if (kind === 'knowledge_save' || kind === 'learning_save') {
    const isLearning = kind === 'learning_save';
    const title = boundedText(options.title || (isLearning ? 'Learning note' : ''),
      MAX_TITLE_CHARS, isLearning ? 'HFM_LEARNING_TITLE_REQUIRED' : 'HFM_KNOWLEDGE_TITLE_REQUIRED');
    if (options.url !== undefined && options.url !== null && options.url !== '') {
      sourceUrl = normalizeSourceUrl(options.url);
      const parsed = new URL(sourceUrl);
      sourceType = 'web';
      sourceId = 'web-source:' + parsed.hostname + parsed.pathname.slice(0, 256);
    } else {
      sourceType = 'manual';
      sourceId = isLearning ? 'user-provided-learning-note' : 'user-provided-knowledge';
    }
    content = title + '\n\n' + body;
    if (content.length > MAX_CONTENT_CHARS) fail('HFM_MEMORY_SAVE_CONTENT_TOO_LARGE');
    recordType = isLearning ? 'learning_note' : 'knowledge_item';
    trustStatus = 'SOURCE_RECORDED';
    lifecycle = 'PENDING_REVIEW';
  }

  const record = {
    schemaVersion,
    memoryId,
    projectId,
    recordType,
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
    access: { classification, allowedProjectIds: [projectId] },
    lifecycle
  };
  const validation = validateCanonicalRecord(record);
  if (!validation.valid) fail('HFM_MEMORY_SAVE_RECORD_INVALID');
  return Object.freeze(record);
}

async function saveHfmMemoryRecord(options = {}) {
  const kind = options.kind;
  if (!hasExplicitSaveIntent(options.userIntent) &&
      !hasExplicitDailyActivitySaveIntent(options.userIntent) &&
      !hasExplicitSourceReferenceSaveIntent(options.userIntent) &&
      !hasExplicitVaultSaveIntent(kind, options.userIntent)) {
    fail('HFM_MEMORY_SAVE_EXPLICIT_USER_INTENT_REQUIRED');
  }
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
    title: options.title, url: options.url,
    userIntent: options.userIntent,
    req: options.req,
    taskId: options.taskId,
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    sourceType: options.sourceType,
    now: options.now
  });
  const resource = 'memory:' + memoryId;
  const isVaultWrite = kind === 'client_vault_save' || kind === 'financial_vault_save';
  const operation = isVaultWrite ? 'memory.vault.write' : 'memory.write';
  const purpose = isVaultWrite
    ? 'hfm-vault:' + record.recordType + ':explicit-user-request'
    : kind === 'knowledge_save'
      ? 'User explicitly requested to save a knowledge source privately as an unverified item for review.'
      : kind === 'learning_save'
        ? 'User explicitly requested to save a learning note privately as an unverified item for review.'
        : kind === 'daily_activity_save'
          ? 'User explicitly requested to save an exact user-authored daily activity summary privately.'
          : kind === 'source_reference_save'
            ? 'User explicitly requested to save this exact user-supplied public source URL as a private, not-yet-fetched source reference.'
            : 'User explicitly requested to save this private memory item.';
  const env = options.env || process.env;
  if (env.MIRA_HFM_MEMORY_WRITE_ENABLED !== 'true') fail('HFM_MEMORY_WRITE_DISABLED');
  if (env.MIRA_HFM_AUTHORITY_ISSUER_ENABLED !== 'true') fail('HFM_AUTHORITY_ISSUER_DISABLED');

  const issueAuthority = options.issueAuthority || approveAndIssueMemoryOperationAuthority;
  const executeAuthority = options.executeAuthority || executeWithConsumedAuthority;
  const createRecord = options.createRecord || createMemoryRecord;
  const authority = await issueAuthority({
    req, pool: issuerPool, env,
    operation,
    resource,
    purpose,
    approvalConfirmed: true
  });
  if (!authority || authority.status !== 'AUTHORITY_ISSUED' ||
      authority.projectId !== projectId || authority.operation !== operation ||
      authority.resource !== resource || !authority.grant) {
    fail('HFM_MEMORY_SAVE_AUTHORITY_NOT_VERIFIED');
  }

  const committed = await executeAuthority({
    pool: writerPool,
    verifiedPrincipal: req.session.hfmPrincipal,
    request: {
      authorityId: authority.grant.authorityId,
      projectId,
      operation,
      resource,
      purpose: authority.grant.purpose,
      requestId: authority.grant.requestId
    },
    perform: (client, context) => createRecord({
      client, context, record, idempotencyKey,
      allowPrivateWrite: record.access.classification !== 'RESTRICTED',
      allowRestrictedWrite: isVaultWrite, env
    })
  });
  if (!committed || committed.status !== 'AUTHORIZED_AND_COMMITTED' ||
      !committed.value || !['CREATED', 'ALREADY_COMMITTED'].includes(committed.value.status) ||
      committed.value.memoryId !== memoryId) {
    fail('HFM_MEMORY_SAVE_COMMIT_NOT_CONFIRMED');
  }

  return Object.freeze({
    success: true,
    saved: true,
    status: committed.value.status,
    memoryId,
    projectId,
    recordType: record.recordType,
    contentRedacted: kind === 'daily_activity_save' && record.content !== String(options.content).trim(),
    classification: record.access.classification,
    trust: record.trust.status,
    lifecycle: record.lifecycle,
    searchEligible: record.lifecycle === 'ACTIVE' && record.trust.status === 'HUMAN_VERIFIED',
    sourceUrl: record.source.sourceUrl || null,
    idempotencyKey,
    localFallback: false,
    driveFallback: false
  });
}

module.exports = Object.freeze({
  hasExplicitSaveIntent,
  hasExplicitDailyActivitySaveIntent,
  hasExplicitSourceReferenceSaveIntent,
  hasExplicitVaultSaveIntent,
  redactDailyActivityContent,
  hasVaultOnlyDailyActivityContent,
  normalizeIntentText,
  isUserAuthoredMemoryContent,
  deriveIdempotencyKey,
  normalizeSourceUrl,
  buildCanonicalMemoryRecord,
  saveHfmMemoryRecord
});
