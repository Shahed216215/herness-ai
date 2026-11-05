'use strict';

const { secureProviderRequest } = require('./security/secure-provider-request');

const TABLE = 'mira_facebook_group_import_batches';
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
  return row.payload;
}

function createSupabaseFacebookGroupImportStore({
  env = process.env,
  request = secureProviderRequest
} = {}) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const config = validateConfig(env);

  async function call(path, method, data, extraHeaders = {}) {
    let response;
    try {
      response = await request(config.baseUrl + '/rest/v1/' + TABLE + path, {
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

  async function readBatch(batchId, projectId, groupId) {
    const query = '?select=batch_id,project_id,group_id,batch_digest,payload' +
      '&batch_id=eq.' + encodeURIComponent(batchId) +
      '&project_id=eq.' + encodeURIComponent(projectId) +
      '&group_id=eq.' + encodeURIComponent(groupId) + '&limit=2';
    const found = rows(await call(query, 'GET'));
    if (!found.length) return null;
    if (found.length !== 1) fail('FB_GROUP_STORE_IDENTITY_CONFLICT', 'Multiple rows matched one immutable Group import batch.');
    return validateBatchRow(found[0], projectId, groupId);
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
      durableQuarantine: true
    }),
    stageBatch,
    readBatch: (batchId, projectId) => readBatch(batchId, projectId, null)
      .then(value => value),
    listBatches
  });
}

module.exports = { createSupabaseFacebookGroupImportStore, validateConfig };
