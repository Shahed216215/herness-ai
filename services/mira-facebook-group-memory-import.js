'use strict';
const crypto = require('node:crypto');
const { validateCanonicalMemoryRecord, assessMemoryConflict } = require('./mira-memory-conflict-assessment');
const MAX_IMPORT_BYTES = 1024 * 1024, MAX_RECORDS = 500, MAX_CONTENT = 100000;
const FORMATS = new Set(['json', 'jsonl', 'manual']);
const RECORD_TYPES = new Set(['fact','decision','preference','procedure','lesson','experience','strategy','project','conversation_reference','knowledge','research_reference']);
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function text(v, label, max = 512) { if (typeof v !== 'string' || !v.trim() || v.length > max) fail('FB_GROUP_IMPORT_INVALID_INPUT', label + ' must be bounded non-empty text.'); return v.trim(); }
function sha256(v) { return crypto.createHash('sha256').update(v, 'utf8').digest('hex'); }
function canonicalJson(v) { if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'; if (object(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}'; return JSON.stringify(v); }
function digest(v) { return sha256(canonicalJson(v)); }
function safeGroupId(v) { const id = text(v, 'groupId', 128); if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'groupId has an unsupported format.'); return id; }
function safeProjectId(v) { const id = text(v, 'projectId', 128); if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'projectId has an unsupported format.'); return id; }
function validateGroupUrl(value, groupId) {
  if (value == null || value === '') return null;
  const raw = text(value, 'sourceUrl', 2048); let url;
  try { url = new URL(raw); } catch { fail('FB_GROUP_IMPORT_INVALID_INPUT', 'sourceUrl must be a valid URL.'); }
  if (url.protocol !== 'https:' || !['facebook.com','www.facebook.com','m.facebook.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.hash || (url.port && url.port !== '443')) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'Only standard HTTPS Facebook Group URLs are accepted.');
  if ([...url.searchParams.keys()].some(key => /token|secret|password|authorization|credential|session/i.test(key))) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'sourceUrl contains a forbidden credential parameter.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'groups' || parts[1] !== groupId) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'sourceUrl must identify the supplied Facebook Group.');
  return 'https://www.facebook.com/groups/' + groupId + (parts.length > 2 ? '/' + parts.slice(2).join('/') : '/');
}
function validTimestamp(v, label) { const raw = text(v, label, 64), n = Date.parse(raw); if (!Number.isFinite(n) || n > Date.now() + 60000) fail('FB_GROUP_IMPORT_INVALID_INPUT', label + ' must be a valid non-future timestamp.'); return new Date(n).toISOString(); }
function exactKeys(v, allowed, label) { if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) fail('FB_GROUP_IMPORT_INVALID_INPUT', label + ' must contain only supported fields.'); }
function parseJsonLines(content) {
  const lines = content.split(/\r?\n/).filter(x => x.trim());
  if (lines.length < 2) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'JSONL requires a header and at least one record.');
  let header; try { header = JSON.parse(lines[0]); } catch { fail('FB_GROUP_IMPORT_INVALID_INPUT', 'JSONL header is invalid JSON.'); }
  const records = lines.slice(1).map((line, i) => { try { return JSON.parse(line); } catch { fail('FB_GROUP_IMPORT_INVALID_INPUT', 'JSONL record at line ' + (i + 2) + ' is invalid JSON.'); } });
  return { ...header, records };
}
function parsePayload(input) {
  const { content, format } = input;
  if (!FORMATS.has(format)) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'format must be json, jsonl or manual.');
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'Import content must be non-empty and at most 1 MiB.');
  if (format === 'manual') return {
    schemaVersion: '1.0.0', kind: 'MIRA_FACEBOOK_GROUP_MEMORY_IMPORT',
    groupId: input.groupId, projectId: input.projectId,
    exportId: 'manual-' + sha256([
      input.groupId || '', input.projectId || '', input.sourceId || '',
      input.sourceUrl || '', input.recordType || 'knowledge',
      input.memoryId || '', input.observedAt || '', content
    ].join('|')).slice(0, 24),
    records: [{ memoryId: input.memoryId, sourceId: input.sourceId, sourceUrl: input.sourceUrl, recordType: input.recordType || 'knowledge', content, observedAt: input.observedAt, revision: 1 }]
  };
  try { return format === 'json' ? JSON.parse(content) : parseJsonLines(content); }
  catch (e) { if (e && e.code === 'FB_GROUP_IMPORT_INVALID_INPUT') throw e; fail('FB_GROUP_IMPORT_INVALID_INPUT', 'Import payload is invalid JSON.'); }
}
function normalizeInputRecord(raw, context) {
  exactKeys(raw, ['memoryId','sourceId','sourceUrl','recordType','content','observedAt','revision'], 'record');
  const content = text(raw.content, 'record.content', MAX_CONTENT);
  const sourceId = text(raw.sourceId, 'record.sourceId', 256);
  const recordType = raw.recordType || 'knowledge';
  if (!RECORD_TYPES.has(recordType)) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'record.recordType is unsupported.');
  const observedAt = validTimestamp(raw.observedAt, 'record.observedAt');
  const sourceUrl = validateGroupUrl(raw.sourceUrl || context.sourceUrl, context.groupId);
  const revision = raw.revision === undefined ? 1 : raw.revision;
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 1000000) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'record.revision must be a positive bounded integer.');
  const contentHash = sha256(JSON.stringify(content));
  // Stable source identity must not change when the source content changes;
  // otherwise a new revision could evade duplicate/version conflict detection.
  const generatedId = 'memory-fb-group-' + sha256(context.groupId + '|' + sourceId).slice(0, 32);
  const memoryId = raw.memoryId == null ? generatedId : text(raw.memoryId, 'record.memoryId', 128);
  if (memoryId.length < 8) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'record.memoryId is too short.');
  const record = {
    schemaVersion: '1.0.0', memoryId, projectId: context.projectId, recordType, content,
    source: { sourceType: 'facebook_group', sourceId, sourceUrl, observedAt },
    timestamps: { createdAt: observedAt, updatedAt: observedAt },
    version: { revision, contentHash },
    integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: [context.projectId] },
    lifecycle: 'PENDING_REVIEW'
  };
  const errors = validateCanonicalMemoryRecord(record, 'importedRecord');
  if (errors.length) fail('FB_GROUP_IMPORT_SCHEMA_INVALID', errors.join('; '));
  return record;
}
function identityKey(r) { return r.projectId + '|' + r.memoryId; }
function sameImportedVersion(a, b) {
  return a.projectId === b.projectId && a.memoryId === b.memoryId &&
    a.version.revision === b.version.revision && a.version.contentHash === b.version.contentHash &&
    a.recordType === b.recordType &&
    JSON.stringify(a.access) === JSON.stringify(b.access) &&
    a.source.sourceType === b.source.sourceType && a.source.sourceId === b.source.sourceId &&
    (a.source.sourceUrl || null) === (b.source.sourceUrl || null);
}
function classifyRecord(record, existingRecords, batchSeen) {
  const sameBatch = batchSeen.get(identityKey(record)) || [];
  const exactBatch = sameBatch.find(r => sameImportedVersion(r, record));
  if (exactBatch) return { disposition: 'DUPLICATE', reasonCode: 'DUPLICATE_IN_IMPORT_BATCH', duplicateOf: exactBatch.memoryId };
  if (sameBatch.length) return { disposition: 'QUARANTINED', reasonCode: 'INTRA_BATCH_VERSION_OR_CONTENT_CONFLICT' };
  const matches = existingRecords.filter(r => r && r.projectId === record.projectId && r.memoryId === record.memoryId);
  if (matches.some(r => object(r) && sameImportedVersion(r, record))) return { disposition: 'DUPLICATE', reasonCode: 'EXACT_EXISTING_VERSION', duplicateOf: record.memoryId };
  if (matches.length) {
    const results = matches.map(r => assessMemoryConflict(r, record));
    if (results.some(r => r.status === 'CONFLICT')) return { disposition: 'QUARANTINED', reasonCode: 'EXISTING_MEMORY_VERSION_CONFLICT', conflictTypes: [...new Set(results.flatMap(r => r.conflictTypes || []))] };
    return { disposition: 'QUARANTINED', reasonCode: 'EXISTING_MEMORY_REQUIRES_REVIEW' };
  }
  return { disposition: 'PENDING_REVIEW', reasonCode: 'NEW_UNTRUSTED_GROUP_MEMORY' };
}
function prepareFacebookGroupImport(input = {}) {
  const projectId = safeProjectId(input.projectId), groupId = safeGroupId(input.groupId);
  const actorId = text(input.actorId, 'actorId', 128);
  if (input.authorizedAccess !== true)
    fail('FB_GROUP_IMPORT_AUTHORIZATION_REQUIRED', 'The importing administrator must confirm authorized access to the supplied Group content.');
  if (!Array.isArray(input.existingRecords) || input.existingRecords.length > 10000) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'existingRecords must be a bounded array.');
  const payload = parsePayload({ ...input, groupId, projectId });
  exactKeys(payload, ['schemaVersion','kind','groupId','projectId','exportId','records'], 'import payload');
  if (payload.schemaVersion !== '1.0.0' || payload.kind !== 'MIRA_FACEBOOK_GROUP_MEMORY_IMPORT') fail('FB_GROUP_IMPORT_SCHEMA_INVALID', 'Unsupported Facebook Group import envelope.');
  if (safeGroupId(payload.groupId) !== groupId || safeProjectId(payload.projectId) !== projectId) fail('FB_GROUP_IMPORT_SCOPE_MISMATCH', 'Import envelope Group/Project scope does not match the request.');
  const exportId = text(payload.exportId, 'exportId', 256);
  if (!Array.isArray(payload.records) || !payload.records.length || payload.records.length > MAX_RECORDS) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'Import must contain between 1 and ' + MAX_RECORDS + ' records.');
  const context = { groupId, projectId, sourceUrl: input.sourceUrl || null }, seen = new Map();
  const items = payload.records.map(raw => {
    const record = normalizeInputRecord(raw, context), c = classifyRecord(record, input.existingRecords, seen), key = identityKey(record);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(record);
    return { memoryId: record.memoryId, revision: record.version.revision, record, recordDigest: digest(record), disposition: c.disposition, reasonCode: c.reasonCode, ...(c.duplicateOf ? { duplicateOf: c.duplicateOf } : {}), ...(c.conflictTypes ? { conflictTypes: c.conflictTypes } : {}) };
  });
  const body = {
    schemaVersion: '1.0.0', kind: 'MIRA_FACEBOOK_GROUP_MEMORY_IMPORT_BATCH',
    batchId: 'mira-fb-group-import-' + sha256(projectId + '|' + groupId + '|' + exportId).slice(0, 48),
    projectId, groupId, exportId, sourceType: 'facebook_group',
    sourceAuthorization: 'USER_ATTESTED_AUTHORIZED_GROUP_ACCESS',
    createdAt: items[0].record.source.observedAt, createdBy: actorId, status: 'PREPARED',
    items,
    summary: { total: items.length, pendingReview: items.filter(x => x.disposition === 'PENDING_REVIEW').length, duplicates: items.filter(x => x.disposition === 'DUPLICATE').length, quarantined: items.filter(x => x.disposition === 'QUARANTINED').length },
    trustPolicy: 'UNTRUSTED_USER_SUPPLIED_GROUP_CONTENT', canonicalMemoryWrite: false
  };
  body.batchDigest = digest(body);
  return Object.freeze(JSON.parse(JSON.stringify(body)));
}
function validateStore(store) {
  if (!object(store) || !object(store.capabilities) ||
      store.capabilities.atomicCreateOnly !== true || store.capabilities.immutableVersions !== true ||
      store.capabilities.projectIsolation !== true || store.capabilities.readAfterWrite !== true ||
      store.capabilities.durableQuarantine !== true || store.capabilities.durableAudit !== true ||
      typeof store.stageBatch !== 'function' || typeof store.readBatch !== 'function' ||
      typeof store.listBatches !== 'function' || typeof store.writeAuditEvent !== 'function')
    fail('FB_GROUP_IMPORT_STORE_UNSUPPORTED', 'A durable project-isolated immutable atomic-create store with quarantine, audit, and read-after-write support is required.');
}
function validateStoredBatch(stored, prepared) {
  if (!object(stored) || stored.batchId !== prepared.batchId || stored.projectId !== prepared.projectId ||
      stored.groupId !== prepared.groupId || stored.batchDigest !== prepared.batchDigest ||
      digest(Object.fromEntries(Object.entries(stored).filter(([k]) => k !== 'batchDigest'))) !== stored.batchDigest) fail('FB_GROUP_IMPORT_READBACK_FAILED', 'Stored Group import readback identity or digest mismatch.');
}
function createFacebookGroupImportService({ store } = {}) {
  validateStore(store);
  return Object.freeze({
    async import(input) {
      const prepared = prepareFacebookGroupImport(input), staged = await store.stageBatch(prepared);
      if (!object(staged) || !['CREATED','ALREADY_EXISTS'].includes(staged.status) || staged.batchId !== prepared.batchId) fail('FB_GROUP_IMPORT_STAGE_FAILED', 'Store did not confirm immutable batch staging.');
      validateStoredBatch(await store.readBatch(prepared.batchId, prepared.projectId), prepared);
      try {
        await auditWriter({ eventType: 'FACEBOOK_GROUP_MEMORY_IMPORT_STAGED', projectId: prepared.projectId, groupId: prepared.groupId, batchId: prepared.batchId, batchDigest: prepared.batchDigest, actorId: prepared.createdBy, outcome: staged.status, canonicalMemoryWrite: false });
      } catch (e) { e.stateCommitted = true; e.code = e.code || 'FB_GROUP_IMPORT_AUDIT_FAILED_AFTER_STAGE'; throw e; }
      return Object.freeze({
        status: 'IMPORT_STAGED_READBACK_VERIFIED', batchId: prepared.batchId, batchDigest: prepared.batchDigest,
        summary: prepared.summary, items: prepared.items.map(x => ({ memoryId: x.memoryId, revision: x.revision, disposition: x.disposition, reasonCode: x.reasonCode })),
        trustStatus: 'SOURCE_RECORDED', integrityStatus: 'UNVERIFIED', lifecycle: 'PENDING_REVIEW',
        canonicalMemoryWrite: false, externalFacebookAccess: false
      });
    },
    async retrieve({ projectId, groupId, query = '', limit = 50 } = {}) {
      const project = safeProjectId(projectId), group = safeGroupId(groupId);
      if (typeof query !== 'string' || query.length > 300) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'query must be at most 300 characters.');
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('FB_GROUP_IMPORT_INVALID_INPUT', 'limit must be between 1 and 100.');
      const batches = await store.listBatches({ projectId: project, groupId: group });
      if (!Array.isArray(batches) || batches.length > 10000) fail('FB_GROUP_IMPORT_STORE_INVALID_RESPONSE', 'Store returned an invalid Group import collection.');
      const needle = query.toLowerCase().trim(), results = [];
      for (const batch of batches) {
        if (!object(batch) || batch.projectId !== project || batch.groupId !== group) fail('FB_GROUP_IMPORT_SCOPE_MISMATCH', 'Store returned a cross-project or cross-group batch.');
        if (digest(Object.fromEntries(Object.entries(batch).filter(([k]) => k !== 'batchDigest'))) !== batch.batchDigest) fail('FB_GROUP_IMPORT_INTEGRITY_FAILED', 'Stored Group import batch integrity verification failed.');
        for (const item of batch.items || []) {
          if (!object(item) || !object(item.record) || item.record.projectId !== project ||
              item.record.source.sourceType !== 'facebook_group' || item.record.lifecycle !== 'PENDING_REVIEW' ||
              validateCanonicalMemoryRecord(item.record, 'storedGroupRecord').length > 0 ||
              item.record.integrity.status !== 'UNVERIFIED' || item.record.trust.status !== 'SOURCE_RECORDED' ||
              digest(item.record) !== item.recordDigest) fail('FB_GROUP_IMPORT_INTEGRITY_FAILED', 'Stored Group memory item failed schema/trust/digest checks.');
          if (item.disposition === 'DUPLICATE') continue;
          if (needle && !item.record.content.toLowerCase().includes(needle)) continue;
          results.push({ memoryId: item.memoryId, revision: item.revision, content: item.record.content, source: item.record.source, recordType: item.record.recordType, recordDigest: item.recordDigest, disposition: item.disposition, reasonCode: item.reasonCode, trustStatus: item.record.trust.status, integrityStatus: item.record.integrity.status, lifecycle: item.record.lifecycle, retrievableAsTrustedMemory: false });
          if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
      }
      return Object.freeze({ status: results.length ? 'GROUP_IMPORT_RETRIEVAL_FOUND' : 'GROUP_IMPORT_RETRIEVAL_EMPTY', projectId: project, groupId: group, resultCount: results.length, results: Object.freeze(results) });
    }
  });
}
module.exports = { prepareFacebookGroupImport, createFacebookGroupImportService, validateGroupUrl, parsePayload, digest };
