'use strict';

const crypto = require('node:crypto');
function secureProviderRequest(...args) {
  return require('./security/secure-provider-request').secureProviderRequest(...args);
}
const { validateCanonicalMemoryRecord } = require('./mira-memory-conflict-assessment');

const TABLE = 'mira_facebook_group_import_batches';
const AUDIT_TABLE = 'mira_facebook_group_import_audit_events';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BATCHES = 1000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateConfig(env = process.env) {
  const rawUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  const key = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string'
    ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  let url;
  try { url = new URL(rawUrl); }
  catch { fail('FB_GROUP_STORE_CONFIG_INVALID', 'Supabase URL is missing or invalid.'); }
  if (url.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ||
      url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || url.pathname !== '/' || url.search)
    fail('FB_GROUP_STORE_CONFIG_INVALID', 'Supabase URL must be a standard HTTPS project URL.');
  if (key.length < 20 || key.length > 4096)
    fail('FB_GROUP_STORE_CONFIG_INVALID', 'Supabase service-role credential is missing or invalid.');
  return { baseUrl: url.origin, key };
}

function rows(response) {
  const data = response && response.data;
  if (!Array.isArray(data) ||
      Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_RESPONSE_BYTES)
    fail('FB_GROUP_STORE_INVALID_RESPONSE', 'Supabase returned an invalid or oversized response.');
  return data;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + canonicalJson(value[key])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}
function digest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
function validateBatchRow(row, projectId, groupId) {
  if (!row || row.project_id !== projectId || row.group_id !== groupId ||
      typeof row.batch_id !== 'string' || typeof row.batch_digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.batch_digest) ||
      !row.payload || typeof row.payload !== 'object' ||
      Array.isArray(row.payload) ||
      row.payload.batchId !== row.batch_id ||
      row.payload.projectId !== projectId ||
      row.payload.groupId !== groupId ||
      row.payload.batchDigest !== row.batch_digest)
    fail('FB_GROUP_STORE_INTEGRITY_FAILED', 'Supabase Group import row failed identity checks.');
  const withoutDigest = Object.fromEntries(
    Object.entries(row.payload).filter(([key]) => key !== 'batchDigest')
  );
  if (digest(withoutDigest) !== row.batch_digest ||
      !Array.isArray(row.payload.items) ||
      row.payload.sourceType !== 'facebook_group' ||
      row.payload.sourceAuthorization !== 'USER_ATTESTED_AUTHORIZED_GROUP_ACCESS' ||
      row.payload.trustPolicy !== 'UNTRUSTED_USER_SUPPLIED_GROUP_CONTENT' ||
      row.payload.canonicalMemoryWrite !== false ||
      typeof row.payload.createdBy !== 'string' || !row.payload.createdBy.trim())
    fail('FB_GROUP_STORE_INTEGRITY_FAILED', 'Supabase Group import batch digest, authorization, trust, or item collection is invalid.');
  for (const item of row.payload.items) {
    if (!item || !item.record || item.record.projectId !== projectId ||
        item.record.source?.sourceType !== 'facebook_group' ||
        item.record.lifecycle !== 'PENDING_REVIEW' ||
        item.record.integrity?.status !== 'UNVERIFIED' ||
        item.record.trust?.status !== 'SOURCE_RECORDED' ||
        item.record.access?.classification !== 'PROJECT_PRIVATE' ||
        !Array.isArray(item.record.access.allowedProjectIds) ||
        item.record.access.allowedProjectIds.length !== 1 ||
        item.record.access.allowedProjectIds[0] !== projectId ||
        digest(item.record) !== item.recordDigest ||
        validateCanonicalMemoryRecord(item.record, 'storedGroupRecord').length > 0 ||
        !['PENDING_REVIEW', 'DUPLICATE', 'QUARANTINED'].includes(item.disposition))
      fail('FB_GROUP_STORE_INTEGRITY_FAILED', 'Supabase Group import item failed digest, schema, trust, or scope validation.');
  }
  return row.payload;
}

function createSupabaseFacebookGroupImportStore({
  env = process.env,
  request = secureProviderRequest
} = {}) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const config = validateConfig(env);

  async function callTable(table, path, method, data, extraHeaders = {}) {
    let response;
    try {
      response = await request(config.baseUrl + '/rest/v1/' + table + path, {
        method,
        headers: {
          apikey: config.key,
          Authorization: 'Bearer ' + config.key,
          'Content-Type': 'application/json',
          ...extraHeaders
        },
        ...(data === undefined ? {} : { data })
      });
    } catch (_error) {
      fail('FB_GROUP_STORE_REQUEST_FAILED', 'Supabase Group import storage request failed.');
    }
    if (!response || !Number.isInteger(response.status) ||
        response.status < 200 || response.status >= 300)
      fail('FB_GROUP_STORE_HTTP_ERROR', 'Supabase Group import storage returned a non-success status.');
    return response;
  }
  const call = (path, method, data, extraHeaders) =>
    callTable(TABLE, path, method, data, extraHeaders);

  async function readBatch(batchId, projectId, groupId = null) {
    const query = '?select=batch_id,project_id,group_id,batch_digest,payload' +
      '&batch_id=eq.' + encodeURIComponent(batchId) +
      '&project_id=eq.' + encodeURIComponent(projectId) +
      (groupId === null ? '' : '&group_id=eq.' + encodeURIComponent(groupId)) + '&limit=2';
    const found = rows(await call(query, 'GET'));
    if (!found.length) return null;
    if (found.length !== 1) fail('FB_GROUP_STORE_IDENTITY_CONFLICT', 'Multiple rows matched one immutable Group import batch.');
    return validateBatchRow(found[0], projectId, found[0].group_id);
  }

  async function stageBatch(batch) {
    const row = {
      batch_id: batch.batchId,
      project_id: batch.projectId,
      group_id: batch.groupId,
      export_id: batch.exportId,
      batch_digest: batch.batchDigest,
      payload: batch
    };
    const inserted = rows(await call(
      '?on_conflict=batch_id',
      'POST',
      [row],
      { Prefer: 'resolution=ignore-duplicates,return=representation' }
    ));
    if (inserted.length > 1)
      fail('FB_GROUP_STORE_STAGE_AMBIGUOUS', 'Supabase returned multiple rows for one immutable batch insert.');
    const stored = await readBatch(batch.batchId, batch.projectId, batch.groupId);
    if (!stored)
      fail('FB_GROUP_STORE_READBACK_FAILED', 'Supabase did not return the staged Group import batch.');
    if (stored.batchDigest !== batch.batchDigest)
      fail('FB_GROUP_IMPORT_BATCH_ID_CONFLICT', 'The same Group import batch ID already exists with different content.');
    return {
      status: inserted.length === 1 ? 'CREATED' : 'ALREADY_EXISTS',
      batchId: batch.batchId
    };
  }

  async function writeAuditEvent(event) {
    if (!event || event.eventType !== 'FACEBOOK_GROUP_MEMORY_IMPORT_STAGED' ||
        typeof event.projectId !== 'string' || typeof event.groupId !== 'string' ||
        typeof event.batchId !== 'string' || typeof event.batchDigest !== 'string' ||
        typeof event.actorId !== 'string' || !event.actorId.trim()) {
      fail('FB_GROUP_STORE_AUDIT_INVALID', 'Group import audit event is incomplete.');
    }
    const payload = {
      schemaVersion: '1.0.0',
      eventType: event.eventType,
      projectId: event.projectId,
      groupId: event.groupId,
      batchId: event.batchId,
      batchDigest: event.batchDigest,
      actorId: event.actorId,
      outcome: event.outcome,
      canonicalMemoryWrite: false,
      recordedAt: new Date().toISOString()
    };
    const canonical = JSON.stringify(Object.fromEntries(Object.keys(payload).sort().map(k => [k, payload[k]])));
    const eventDigest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    const eventId = crypto.randomUUID();
    const row = {
      event_id: eventId,
      project_id: event.projectId,
      group_id: event.groupId,
      batch_id: event.batchId,
      event_digest: eventDigest,
      payload
    };
    const inserted = rows(await callTable(
      AUDIT_TABLE, '', 'POST', [row], { Prefer: 'return=representation' }
    ));
    if (inserted.length !== 1 || inserted[0].event_id !== eventId ||
        inserted[0].event_digest !== eventDigest ||
        !inserted[0].payload || inserted[0].payload.batchId !== event.batchId) {
      fail('FB_GROUP_STORE_AUDIT_WRITE_FAILED', 'Supabase did not confirm the durable Group import audit insert.');
    }
    const verified = rows(await callTable(
      AUDIT_TABLE,
      '?select=event_id,project_id,group_id,batch_id,event_digest,payload&event_id=eq.' +
        encodeURIComponent(eventId) + '&limit=2',
      'GET'
    ));
    if (verified.length !== 1 || verified[0].event_id !== eventId ||
        verified[0].project_id !== event.projectId ||
        verified[0].group_id !== event.groupId ||
        verified[0].batch_id !== event.batchId ||
        verified[0].event_digest !== eventDigest ||
        !verified[0].payload || verified[0].payload.batchDigest !== event.batchDigest ||
        digest(verified[0].payload) !== eventDigest) {
      fail('FB_GROUP_STORE_AUDIT_READBACK_FAILED', 'Durable Group import audit readback failed.');
    }
    return { status: 'AUDIT_WRITE_READBACK_VERIFIED', eventId, eventDigest };
  }

  async function listBatches({ projectId, groupId } = {}) {
    const query = '?select=batch_id,project_id,group_id,batch_digest,payload' +
      '&project_id=eq.' + encodeURIComponent(projectId) +
      '&group_id=eq.' + encodeURIComponent(groupId) +
      '&order=created_at.asc&limit=' + (MAX_BATCHES + 1);
    const found = rows(await call(query, 'GET'));
    if (found.length > MAX_BATCHES)
      fail('FB_GROUP_STORE_CAPACITY_REVIEW_REQUIRED', 'Group import history exceeds the bounded retrieval limit.');
    return found.map(row => validateBatchRow(row, projectId, groupId));
  }

  return Object.freeze({
    capabilities: Object.freeze({
      atomicCreateOnly: true,
      immutableVersions: true,
      projectIsolation: true,
      readAfterWrite: true,
      durableQuarantine: true,
      durableAudit: true
    }),
    stageBatch,
    readBatch: (batchId, projectId) => readBatch(batchId, projectId, null)
      .then(value => value),
    listBatches,
    writeAuditEvent
  });
}

module.exports = { createSupabaseFacebookGroupImportStore, validateConfig };
