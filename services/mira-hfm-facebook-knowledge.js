'use strict';

const crypto = require('node:crypto');
const { validateCanonicalRecord, createContentHash } = require('./mira-hfm-record-schema');

const MAX_CONTENT_BYTES = 38000;
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
  const allowedQueryKeys = new Set(['story_fbid', 'id', 'fbid', 'comment_id']);
  const retained = [...url.searchParams.entries()]
    .filter(([key, value]) => allowedQueryKeys.has(key) && /^[A-Za-z0-9_-]{1,128}$/.test(value))
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  url.search = '';
  for (const [key, value] of retained) url.searchParams.append(key, value);
  return url.toString().replace(/\/$/, '');
}

function redactSensitiveText(input) {
  if (typeof input !== 'string' || !input.trim() || Buffer.byteLength(input, 'utf8') > MAX_CONTENT_BYTES) {
    throw fail('HFM_KNOWLEDGE_CONTENT_INVALID');
  }
  let content = input.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  const restrictedPatterns = [
    /["']?(?:private[_ -]?key|client[_ -]?record|customer[_ -]?record|invoice[_ -]?(?:id|no|number)|bank[_ -]?account|account[_ -]?number|transaction[_ -]?id|financial[_ -]?statement|salary[_ -]?record|internal[_ -]?only|restricted[_ -]?data)["']?\s*[:=]/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
  ];
  if (restrictedPatterns.some(pattern => pattern.test(content))) {
    throw fail('HFM_KNOWLEDGE_RESTRICTED_CONTENT_BLOCKED');
  }
  content = content
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)["']?\s*[:=]\s*["']?[^\s,"']+/gi, '[REDACTED_CREDENTIAL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[REDACTED_PHONE_OR_NUMBER]')
    .replace(/(?:\b\d{1,3}[,.]\d{2,}\b|৳\s?\d[\d,.]*|BDT\s?\d[\d,.]*)/gi, '[REDACTED_AMOUNT]');
  if (!content.trim() || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw fail('HFM_KNOWLEDGE_CONTENT_INVALID');
  return Object.freeze({ content, redacted: content !== input.normalize('NFC').replace(/\r\n?/g, '\n').trim() });
}

function extractImportedContent(input, options = {}) {
  if (typeof input !== 'string' || !input.trim() || Buffer.byteLength(input, 'utf8') > 30000) {
    throw fail('HFM_IMPORT_FILE_CONTENT_INVALID');
  }
  const name = String(options.fileName || '').toLowerCase();
  const mime = String(options.mimeType || '').toLowerCase();
  let content = input;
  if (name.endsWith('.json') || mime.includes('json')) {
    let parsed;
    try { parsed = JSON.parse(input); } catch (_error) { throw fail('HFM_IMPORT_JSON_INVALID'); }
    const preferred = new Set(['text','message','content','title','description','post','caption','body']);
    const pieces = [];
    const visit = (value, key = '') => {
      if (typeof value === 'string') {
        if (preferred.has(key.toLowerCase()) && value.trim()) pieces.push(value.trim());
        return;
      }
      if (Array.isArray(value)) { for (const item of value) visit(item, key); return; }
      if (value && typeof value === 'object') {
        for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
      }
    };
    visit(parsed);
    content = pieces.length ? [...new Set(pieces)].join('\n\n') : '';
    if (!content) throw fail('HFM_IMPORT_JSON_NO_TEXT');
  } else if (name.endsWith('.html') || mime.includes('html') || /<html[\s>]/i.test(input)) {
    content = input
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|article|section|li|h[1-6]|br|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }
  if (!content.trim()) throw fail('HFM_IMPORT_FILE_NO_TEXT');
  return content.slice(0, 25000);
}

function tokenize(value) {
  return String(value || '').toLocaleLowerCase('und')
    .normalize('NFKC')
    .match(/[\p{L}\p{M}\p{N}]{2,}/gu) || [];
}

function buildKnowledgeRecord(options = {}) {
  if (options.publicContentConfirmed !== true) throw fail('HFM_KNOWLEDGE_PUBLIC_CONTENT_CONFIRMATION_REQUIRED');
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

async function researchFacebookSource(options = {}) {
  const sourceUrl = normalizeFacebookUrl(options.sourceUrl);
  const apiKey = options.apiKey || process.env.TAVILY_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return Object.freeze({
      status: 'SEARCH_PROVIDER_NOT_CONFIGURED',
      sourceUrl,
      fallback: 'MANUAL_IMPORT_REQUIRED',
      results: []
    });
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw fail('HFM_WEB_SEARCH_TRANSPORT_UNAVAILABLE');

  // Ask the public web extraction provider first. No Facebook credentials, cookies,
  // login state, private-group access or redirect/access-control bypass is attempted.
  try {
    const extractResponse = await fetchImpl('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        urls: [sourceUrl],
        extract_depth: 'basic',
        format: 'text'
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (extractResponse && extractResponse.ok) {
      const extracted = await extractResponse.json();
      const rows = Array.isArray(extracted && extracted.results) ? extracted.results : [];
      const exact = rows.find(item => {
        try { return normalizeFacebookUrl(String(item.url || '')) === sourceUrl; }
        catch (_error) { return false; }
      });
      const rawContent = exact && (exact.raw_content || exact.content);
      if (typeof rawContent === 'string' && rawContent.trim()) {
        return Object.freeze({
          status: 'PUBLIC_CONTENT_RETRIEVED',
          sourceUrl,
          fallback: null,
          results: Object.freeze([Object.freeze({
            title: String(exact.title || '').slice(0, 300),
            url: sourceUrl,
            content: rawContent.trim().slice(0, 5000),
            verificationStatus: 'SOURCE_REACHABLE'
          })])
        });
      }
    }
  } catch (_extractError) {
    // Extraction failures intentionally fall through to public-index search.
  }

  const pagePath = new URL(sourceUrl).pathname.replace(/\/$/, '');
  const response = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: 'site:facebook.com' + pagePath + ' ' + [...new URL(sourceUrl).searchParams.entries()].map(([key, value]) => key + ':' + value).join(' ') + ' public posts',
      search_depth: 'basic',
      include_domains: ['facebook.com'],
      max_results: 5,
      include_answer: false
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response || !response.ok) throw fail('HFM_WEB_SEARCH_PROVIDER_UNAVAILABLE');
  const payload = await response.json();
  const rows = Array.isArray(payload && payload.results) ? payload.results : [];
  const results = rows.slice(0, 5).map(item => {
    let url = null;
    try { url = normalizeFacebookUrl(String(item.url || '')); }
    catch (_error) {}
    if (!url) return null;
    return Object.freeze({
      title: String(item.title || '').slice(0, 300),
      url,
      snippet: String(item.content || '').slice(0, 2000),
      publishedAt: typeof item.published_date === 'string' ? item.published_date : null,
      verificationStatus: 'SOURCE_RECORDED'
    });
  }).filter(Boolean);
  return Object.freeze({
    status: results.length ? 'SEARCH_RESULTS_FOUND' : 'NO_PUBLIC_INDEXED_RESULTS',
    sourceUrl,
    fallback: 'SEARCH_ENGINE_INDEX',
    results: Object.freeze(results)
  });
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

async function appendKnowledgeSearchAudit(client, context, resultCount, queryLength) {
  const previous = await client.query(
    'SELECT event_hash FROM mira_hfm.memory_audit_events WHERE project_id = $1 ORDER BY event_sequence DESC LIMIT 1',
    [context.projectId]
  );
  const event = {
    eventId: crypto.randomUUID(),
    projectId: context.projectId,
    actorId: context.actorId,
    operationId: context.requestId,
    memoryId: null,
    eventType: 'KNOWLEDGE_SEARCHED',
    resultStatus: 'COMPLETED',
    policyVersion: 'HFM-KNOWLEDGE-1.0.0',
    occurredAt: new Date().toISOString(),
    previousEventHash: previous.rows && previous.rows[0] ? previous.rows[0].event_hash : null,
    details: { recordType: 'knowledge_item', resultCount, queryLength }
  };
  const eventHash = require('./mira-hfm-memory-repository').digest(event);
  await client.query(
    'INSERT INTO mira_hfm.memory_audit_events (event_id, project_id, actor_id, operation_id, memory_id, event_type, result_status, policy_version, occurred_at, previous_event_hash, event_hash, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
    [event.eventId, event.projectId, event.actorId, event.operationId, null,
      event.eventType, event.resultStatus, event.policyVersion, event.occurredAt,
      event.previousEventHash, eventHash, JSON.stringify(event.details)]
  );
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
  await appendKnowledgeSearchAudit(client, context, results.length, query.length);
  return Object.freeze({ status: results.length ? 'FOUND' : 'NO_MATCHES', results, count: results.length });
}

module.exports = Object.freeze({
  normalizeFacebookUrl,
  extractImportedContent,
  redactSensitiveText,
  buildKnowledgeRecord,
  ingestFacebookKnowledge,
  searchFacebookKnowledge,
  researchFacebookSource,
  tokenize
});
