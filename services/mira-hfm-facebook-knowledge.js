'use strict';

const crypto = require('node:crypto');
const { validateCanonicalRecord, createContentHash } = require('./mira-hfm-record-schema');

const MAX_CONTENT = 50000;
const MAX_SOURCE_URL = 2048;
const SOURCE_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeFacebookUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_SOURCE_URL || value.trim() !== value) {
    throw fail('HFM_FACEBOOK_SOURCE_URL_INVALID');
  }
  let url;
  try { url = new URL(value); } catch (_error) { throw fail('HFM_FACEBOOK_SOURCE_URL_INVALID'); }
  if (url.protocol !== 'https:' || !SOURCE_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username || url.password || url.port || url.hash ||
      !/^\/(?:[^\s?#]*)$/.test(url.pathname)) {
    throw fail('HFM_FACEBOOK_SOURCE_URL_NOT_ALLOWED');
  }
  url.hostname = 'www.facebook.com';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function redactSensitiveText(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > MAX_CONTENT) {
    throw fail('HFM_KNOWLEDGE_CONTENT_INVALID');
  }
  let content = input.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  content = content
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[REDACTED_PHONE_OR_NUMBER]')
    .replace(/(?:\b\d{1,3}[,.]\d{2,}\b|৳\s?\d[\d,.]*|BDT\s?\d[\d,.]*)/gi, '[REDACTED_AMOUNT]');
  if (!content.trim() || content.length > MAX_CONTENT) throw fail('HFM_KNOWLEDGE_CONTENT_INVALID');
  return Object.freeze({ content, redacted: content !== input.normalize('NFC').replace(/\r\n?/g, '\n').trim() });
}

function tokenize(value) {
  return String(value || '').toLocaleLowerCase('und')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function buildKnowledgeRecord(options = {}) {
  const projectId = options.projectId;
  const sourceType = options.sourceType;
  const sourceUrl = options.sourceUrl ? normalizeFacebookUrl(options.sourceUrl) : null;
  const sourceId = typeof options.sourceId === 'string' && options.sourceId.trim()
    ? options.sourceId.trim().slice(0, 256) : 'user-supplied-facebook-content';
  const allowedTypes = new Set(['facebook_page', 'facebook_group', 'manual']);
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 128 ||
      !allowedTypes.has(sourceType)) throw fail('HFM_KNOWLEDGE_SCOPE_OR_SOURCE_INVALID');
  const clean = redactSensitiveText(options.content);
  const now = new Date(options.now || Date.now()).toISOString();
  const collectionMethod = options.collectionMethod || 'manual_copy';
  if (!['manual_copy', 'user_file_import', 'public_url_preview', 'web_search'].includes(collectionMethod)) {
    throw fail('HFM_KNOWLEDGE_COLLECTION_METHOD_INVALID');
  }
  const provenance = {
    collectionMethod,
    capturedAt: now,
    originalPublishedAt: options.originalPublishedAt || null,
    verificationStatus: 'SOURCE_RECORDED',
    redactionApplied: clean.redacted
  };
  const record = {
    schemaVersion: '1.1.0',
    memoryId: options.memoryId || 'fbk_' + crypto.randomUUID().replace(/-/g, ''),
    projectId,
    recordType: 'knowledge_item',
    content: clean.content,
    source: {
      sourceType,
      sourceId,
      sourceUrl,
      observedAt: now
    },
    provenance,
    timestamps: { createdAt: now, updatedAt: now },
    version: { revision: 1, contentHash: createContentHash(clean.content) },
    integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PUBLIC', allowedProjectIds: [projectId] },
    lifecycle: 'ACTIVE'
  };
  const validation = validateCanonicalRecord(record);
  if (!validation.valid) throw fail('HFM_KNOWLEDGE_RECORD_INVALID');
  return Object.freeze(record);
}

async function findDuplicate(client, projectId, contentHash) {
  const result = await client.query(
    "SELECT memory_id FROM mira_hfm.memory_records WHERE project_id = $1 AND record_type = 'knowledge_item' AND classification = 'PUBLIC' AND lifecycle = 'ACTIVE' AND public_payload -> 'version' ->> 'contentHash' = $2 ORDER BY created_at ASC LIMIT 1",
    [projectId, contentHash]
  );
  return result.rows && result.rows[0] ? result.rows[0].memory_id : null;
}

async function ingestFacebookKnowledge(options = {}) {
  const { client, context } = options;
  if (!client || typeof client.query !== 'function' || !context ||
      context.authorityContext !== 'HFM_CONSUMED_ONE_TIME_AUTHORITY' ||
      context.operation !== 'memory.write' || typeof options.memoryId !== 'string' || context.resource !== 'memory:' + options.memoryId) {
    throw fail('HFM_KNOWLEDGE_CONSUMED_AUTHORITY_REQUIRED');
  }
  const record = buildKnowledgeRecord({ ...options, projectId: context.projectId });
  const duplicateId = await findDuplicate(client, context.projectId, record.version.contentHash);
  if (duplicateId) return Object.freeze({ status: 'DUPLICATE', memoryId: duplicateId });
  const repository = require('./mira-hfm-memory-repository');
  const result = await repository.createMemoryRecord({
    client, context,
    record, idempotencyKey: options.idempotencyKey,
    env: options.env
  });
  return Object.freeze({ ...result, provenance: record.provenance, source: record.source });
}

async function searchFacebookKnowledge(options = {}) {
  const { client, context } = options;
  if (!client || typeof client.query !== 'function' || !context ||
      context.authorityContext !== 'HFM_CONSUMED_ONE_TIME_AUTHORITY' ||
      context.operation !== 'memory.read' || context.resource !== 'memory:project:' + context.projectId) {
    throw fail('HFM_KNOWLEDGE_CONSUMED_AUTHORITY_REQUIRED');
  }
  const query = typeof options.query === 'string' ? options.query.trim() : '';
  if (!query || query.length > 1000) throw fail('HFM_KNOWLEDGE_QUERY_INVALID');
  const terms = [...new Set(tokenize(query))].slice(0, 24);
  if (!terms.length) return Object.freeze({ status: 'NO_MATCHES', results: [], count: 0 });
  const limit = Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), 25) : 10;
  const result = await client.query(
    "SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, integrity_status, trust_status, public_payload, encrypted_envelope, created_at, updated_at FROM mira_hfm.memory_records WHERE project_id = $1 AND classification = 'PUBLIC' AND record_type = 'knowledge_item' AND lifecycle = 'ACTIVE' AND integrity_status <> 'FAILED' AND trust_status <> 'QUARANTINED' ORDER BY updated_at DESC, memory_id ASC LIMIT 500",
    [context.projectId]
  );
  const scored = [];
  for (const row of result.rows || []) {
    const record = require('./mira-hfm-memory-repository').decodeStoredRow(row);
    const contentTokens = tokenize(record.content);
    const counts = new Map();
    for (const token of contentTokens) counts.set(token, (counts.get(token) || 0) + 1);
    let score = 0;
    for (const term of terms) score += counts.has(term) ? 1 + Math.log1p(counts.get(term)) : 0;
    if (score > 0) scored.push({
      memoryId: record.memoryId,
      content: record.content,
      source: record.source,
      provenance: record.provenance || null,
      trust: record.trust,
      integrity: record.integrity,
      revision: record.version.revision,
      score
    });
  }
  scored.sort((a, b) => b.score - a.score || a.memoryId.localeCompare(b.memoryId));
  const results = scored.slice(0, limit).map(({ score, ...item }) => Object.freeze(item));
  return Object.freeze({ status: results.length ? 'FOUND' : 'NO_MATCHES', results, count: results.length });
}

module.exports = Object.freeze({
  normalizeFacebookUrl,
  redactSensitiveText,
  buildKnowledgeRecord,
  ingestFacebookKnowledge,
  searchFacebookKnowledge,
  tokenize
});
