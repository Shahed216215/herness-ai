'use strict';

const crypto = require('node:crypto');
const { decodeStoredRow } = require('./mira-hfm-memory-repository');

const AUTHORITY_CONTEXT = 'HFM_CONSUMED_ONE_TIME_AUTHORITY';
const OPERATIONS = Object.freeze({
  COPY: 'memory.social_post.copy',
  PUBLISH: 'memory.social_post.confirm_published',
  DELETE: 'memory.social_post.delete_payload'
});
const STATES = Object.freeze([
  'SAVED', 'COPIED', 'USER_CONFIRMED_PUBLISHED', 'DELETE_PENDING',
  'DELETED', 'DELETE_FAILED', 'DELETE_STATUS_UNKNOWN'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateWorkflowContext(context, operation, memoryId) {
  if (!context || context.authorityContext !== AUTHORITY_CONTEXT ||
      typeof context.actorId !== 'string' || !context.actorId.startsWith('mira:') ||
      typeof context.projectId !== 'string' || !context.projectId ||
      typeof context.projectOwnerActorId !== 'string' || !context.projectOwnerActorId.startsWith('mira:') ||
      context.operation !== operation ||
      context.resource !== 'memory:' + memoryId ||
      typeof context.requestId !== 'string' || !context.requestId) {
    throw fail('HFM_SOCIAL_POST_AUTHORITY_INVALID');
  }
  return context;
}

function assertSocialPostRecord(row, context, options = {}) {
  if (!row) throw fail('HFM_SOCIAL_POST_NOT_FOUND');
  if (row.project_id !== context.projectId) throw fail('HFM_SOCIAL_POST_PROJECT_SCOPE_MISMATCH');
  if (row.owner_actor_id !== context.actorId) throw fail('HFM_SOCIAL_POST_OWNER_MISMATCH');
  if (row.record_type !== 'social_post_draft') throw fail('HFM_SOCIAL_POST_TYPE_INVALID');
  if (row.classification !== 'PROJECT_PRIVATE') throw fail('HFM_SOCIAL_POST_CLASSIFICATION_INVALID');
  if (row.payload_erased_at && options.allowErased !== true) throw fail('HFM_SOCIAL_POST_PAYLOAD_ALREADY_ERASED');
  return row;
}

function nextSocialPostStatus(current, action) {
  const state = current || 'SAVED';
  if (!STATES.includes(state)) throw fail('HFM_SOCIAL_POST_STATUS_INVALID');
  if (action === 'COPY') {
    if (state === 'SAVED' || state === 'COPIED') return 'COPIED';
    if (state === 'USER_CONFIRMED_PUBLISHED') return state;
  }
  if (action === 'PUBLISH' && (state === 'COPIED' || state === 'USER_CONFIRMED_PUBLISHED')) {
    return 'USER_CONFIRMED_PUBLISHED';
  }
  if (action === 'DELETE' && [
    'SAVED', 'COPIED', 'USER_CONFIRMED_PUBLISHED', 'DELETE_FAILED', 'DELETE_STATUS_UNKNOWN'
  ].includes(state)) return 'DELETE_PENDING';
  throw fail('HFM_SOCIAL_POST_STATUS_TRANSITION_INVALID');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function loadRecord(client, context, memoryId, options = {}) {
  const lockClause = options.forUpdate === false ? '' : ' FOR UPDATE';
  const result = await client.query(
    'SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, ' +
    'integrity_status, trust_status, public_payload, encrypted_envelope, created_at, updated_at, payload_erased_at ' +
    'FROM mira_hfm.memory_records WHERE project_id = $1 AND memory_id = $2' + lockClause,
    [context.projectId, memoryId]
  );
  return result.rows && result.rows[0];
}

async function getStateRow(client, projectId, memoryId) {
  const result = await client.query(
    'SELECT status, copied_at, published_confirmed_at, payload_erased_at, updated_at, source_metadata, provenance_metadata ' +
    'FROM mira_hfm.memory_social_post_state WHERE project_id = $1 AND memory_id = $2',
    [projectId, memoryId]
  );
  return result.rows && result.rows[0] || null;
}

async function beginOperation(client, context, memoryId, operation, idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 256) {
    throw fail('HFM_SOCIAL_POST_IDEMPOTENCY_KEY_INVALID');
  }
  const resource = 'memory:' + memoryId;
  const payloadDigest = sha256(stableJson({ operation, resource, projectId: context.projectId }));
  const operationId = crypto.randomUUID();
  const inserted = await client.query(
    'INSERT INTO mira_hfm.memory_operation_registry ' +
    '(operation_id, project_id, actor_id, idempotency_key, operation, resource, purpose, payload_digest, status, created_at, updated_at) ' +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'REQUESTED',clock_timestamp(),clock_timestamp()) " +
    'ON CONFLICT (project_id, idempotency_key) DO NOTHING RETURNING operation_id',
    [operationId, context.projectId, context.actorId, idempotencyKey.trim(), operation,
      resource, context.purpose || operation, payloadDigest]
  );
  if (inserted.rowCount === 1) return { operationId, duplicate: false };
  const existingResult = await client.query(
    'SELECT operation_id, actor_id, operation, resource, purpose, payload_digest, status, result_code ' +
    'FROM mira_hfm.memory_operation_registry WHERE project_id = $1 AND idempotency_key = $2 FOR UPDATE',
    [context.projectId, idempotencyKey.trim()]
  );
  const existing = existingResult.rows && existingResult.rows[0];
  if (!existing) throw fail('HFM_SOCIAL_POST_DELETE_STATUS_UNKNOWN');
  if (existing.actor_id !== context.actorId || existing.operation !== operation ||
      existing.resource !== resource || existing.purpose !== (context.purpose || operation) ||
      existing.payload_digest !== payloadDigest) throw fail('HFM_SOCIAL_POST_IDEMPOTENCY_CONFLICT');
  if (existing.status === 'COMPLETED') {
    return { operationId: existing.operation_id, duplicate: true, resultCode: existing.result_code };
  }
  throw fail('HFM_SOCIAL_POST_OPERATION_IN_PROGRESS_OR_UNKNOWN');
}

async function finishOperation(client, operationId, resultCode) {
  const result = await client.query(
    "UPDATE mira_hfm.memory_operation_registry SET status = 'COMPLETED', result_code = $2, updated_at = clock_timestamp() " +
    "WHERE operation_id = $1 AND status = 'REQUESTED' RETURNING operation_id",
    [operationId, resultCode]
  );
  if (result.rowCount !== 1) throw fail('HFM_SOCIAL_POST_OPERATION_COMPLETION_FAILED');
}

async function appendSanitizedAudit(client, context, operationId, memoryId, eventType, details) {
  const previous = await client.query(
    'SELECT event_hash FROM mira_hfm.memory_audit_events WHERE project_id = $1 ORDER BY event_sequence DESC LIMIT 1',
    [context.projectId]
  );
  const event = {
    eventId: crypto.randomUUID(),
    projectId: context.projectId,
    actorId: context.actorId,
    operationId,
    memoryId,
    eventType,
    resultStatus: 'COMPLETED',
    policyVersion: 'HFM-SOCIAL-POST-DELETE-1.0',
    occurredAt: new Date().toISOString(),
    previousEventHash: previous.rows && previous.rows[0] ? previous.rows[0].event_hash : null,
    details
  };
  const hash = sha256(stableJson(event));
  await client.query(
    'INSERT INTO mira_hfm.memory_audit_events ' +
    '(event_id, project_id, actor_id, operation_id, memory_id, event_type, result_status, policy_version, occurred_at, previous_event_hash, event_hash, details) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
    [event.eventId, event.projectId, event.actorId, event.operationId, event.memoryId,
      event.eventType, event.resultStatus, event.policyVersion, event.occurredAt,
      event.previousEventHash, hash, JSON.stringify(details)]
  );
}

async function updateStatus(client, context, memoryId, status, extra = {}) {
  await client.query(
    'INSERT INTO mira_hfm.memory_social_post_state ' +
    '(memory_id, project_id, owner_actor_id, status, copied_at, published_confirmed_at, payload_erased_at, source_metadata, provenance_metadata, updated_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,clock_timestamp()) ' +
    'ON CONFLICT (project_id, memory_id) DO UPDATE SET status = EXCLUDED.status, ' +
    'copied_at = COALESCE(EXCLUDED.copied_at, mira_hfm.memory_social_post_state.copied_at), ' +
    'published_confirmed_at = COALESCE(EXCLUDED.published_confirmed_at, mira_hfm.memory_social_post_state.published_confirmed_at), ' +
    'payload_erased_at = COALESCE(EXCLUDED.payload_erased_at, mira_hfm.memory_social_post_state.payload_erased_at), ' +
    'source_metadata = COALESCE(mira_hfm.memory_social_post_state.source_metadata, EXCLUDED.source_metadata), ' +
    'provenance_metadata = COALESCE(mira_hfm.memory_social_post_state.provenance_metadata, EXCLUDED.provenance_metadata), ' +
    'updated_at = clock_timestamp()',
    [memoryId, context.projectId, context.actorId, status,
      extra.copiedAt || null, extra.publishedAt || null, extra.erasedAt || null,
      extra.sourceMetadata ? JSON.stringify(extra.sourceMetadata) : null,
      extra.provenanceMetadata ? JSON.stringify(extra.provenanceMetadata) : null]
  );
}


async function listSocialPostDrafts(options = {}) {
  const { client, context } = options;
  if (!client || typeof client.query !== 'function' ||
      !context || context.authorityContext !== AUTHORITY_CONTEXT ||
      typeof context.actorId !== 'string' || !context.actorId.startsWith('mira:') ||
      typeof context.projectOwnerActorId !== 'string' || !context.projectOwnerActorId.startsWith('mira:') ||
      typeof context.projectId !== 'string' || !context.projectId ||
      context.operation !== 'memory.read' ||
      context.resource !== 'memory:project:' + context.projectId ||
      typeof context.requestId !== 'string' || !context.requestId) {
    throw fail('HFM_SOCIAL_POST_AUTHORITY_INVALID');
  }
  const limit = Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), 100) : 25;
  const result = await client.query(
    'SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, ' +
    'integrity_status, trust_status, public_payload, encrypted_envelope, created_at, updated_at, payload_erased_at ' +
    'FROM mira_hfm.memory_records WHERE project_id = $1 AND owner_actor_id = $2 ' +
    'AND record_type = \'social_post_draft\' AND classification = \'PROJECT_PRIVATE\' ' +
    'ORDER BY created_at DESC, memory_id ASC LIMIT $3',
    [context.projectId, context.actorId, limit]
  );
  const drafts = [];
  for (const row of result.rows || []) {
    const state = await getStateRow(client, context.projectId, row.memory_id);
    const erased = Boolean(row.payload_erased_at);
    let record = null;
    if (!erased) {
      record = decodeStoredRow(row, {
        allowPrivateRead: options.allowPrivateRead === true,
        env: options.env || process.env
      });
    }
    drafts.push(Object.freeze({
      memoryId: row.memory_id,
      projectId: row.project_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: Number(row.revision),
      lifecycle: row.lifecycle,
      status: state ? state.status : 'SAVED',
      payloadErased: erased,
      content: record ? record.content : null,
      source: state && state.source_metadata ? state.source_metadata : (record ? record.source : null),
      provenance: state && state.provenance_metadata ? state.provenance_metadata : (record ? record.provenance || null : null)
    }));
  }
  return Object.freeze({ status: 'FOUND', drafts: Object.freeze(drafts), count: drafts.length });
}

async function markSocialPostCopied(options = {}) {
  const { client, context, memoryId } = options;
  validateWorkflowContext(context, OPERATIONS.COPY, memoryId);
  assertSocialPostRecord(await loadRecord(client, context, memoryId), context);
  const operation = await beginOperation(client, context, memoryId, OPERATIONS.COPY, options.idempotencyKey);
  if (operation.duplicate) {
    const existing = await getStateRow(client, context.projectId, memoryId);
    return { status: existing ? existing.status : 'DELETE_STATUS_UNKNOWN', duplicate: true };
  }
  const current = await getStateRow(client, context.projectId, memoryId);
  const status = nextSocialPostStatus(current && current.status, 'COPY');
  await updateStatus(client, context, memoryId, status, { copiedAt: new Date().toISOString() });
  await appendSanitizedAudit(client, context, operation.operationId, memoryId, 'SOCIAL_POST_COPIED', {
    recordType: 'social_post_draft', classification: 'PROJECT_PRIVATE'
  });
  await finishOperation(client, operation.operationId, memoryId);
  return { status, duplicate: false };
}

async function confirmSocialPostPublished(options = {}) {
  const { client, context, memoryId } = options;
  validateWorkflowContext(context, OPERATIONS.PUBLISH, memoryId);
  assertSocialPostRecord(await loadRecord(client, context, memoryId), context);
  if (options.userConfirmedPublished !== true) throw fail('HFM_SOCIAL_POST_USER_CONFIRMATION_REQUIRED');
  const operation = await beginOperation(client, context, memoryId, OPERATIONS.PUBLISH, options.idempotencyKey);
  if (operation.duplicate) {
    const existing = await getStateRow(client, context.projectId, memoryId);
    return { status: existing ? existing.status : 'DELETE_STATUS_UNKNOWN', duplicate: true };
  }
  const current = await getStateRow(client, context.projectId, memoryId);
  const status = nextSocialPostStatus(current && current.status, 'PUBLISH');
  const confirmedAt = new Date().toISOString();
  await updateStatus(client, context, memoryId, status, { publishedAt: confirmedAt });
  await appendSanitizedAudit(client, context, operation.operationId, memoryId, 'SOCIAL_POST_USER_CONFIRMED_PUBLISHED', {
    recordType: 'social_post_draft', classification: 'PROJECT_PRIVATE',
    confirmationSource: 'USER_ACTION_NOT_FACEBOOK_VERIFIED'
  });
  await finishOperation(client, operation.operationId, memoryId);
  return { status, duplicate: false, confirmationSource: 'USER_ACTION_NOT_FACEBOOK_VERIFIED' };
}

function cleanMetadataText(value, max = 128) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

function sanitizedSourceMetadata(source = {}) {
  return Object.freeze({
    sourceType: cleanMetadataText(source.sourceType, 48),
    sourceId: cleanMetadataText(source.sourceId, 128),
    observedAt: typeof source.observedAt === 'string' && Number.isFinite(Date.parse(source.observedAt))
      ? new Date(source.observedAt).toISOString() : null
  });
}

function sanitizedProvenanceMetadata(provenance = {}) {
  const methods = new Set(['manual_copy','user_file_import','public_url_preview','web_search']);
  const verification = new Set(['SOURCE_RECORDED','SOURCE_REACHABLE','CONTENT_VERIFIED','HUMAN_VERIFIED']);
  return Object.freeze({
    collectionMethod: methods.has(provenance.collectionMethod) ? provenance.collectionMethod : null,
    capturedAt: typeof provenance.capturedAt === 'string' && Number.isFinite(Date.parse(provenance.capturedAt))
      ? new Date(provenance.capturedAt).toISOString() : null,
    verificationStatus: verification.has(provenance.verificationStatus) ? provenance.verificationStatus : null,
    originalPublishedAt: typeof provenance.originalPublishedAt === 'string' && Number.isFinite(Date.parse(provenance.originalPublishedAt))
      ? new Date(provenance.originalPublishedAt).toISOString() : null,
    redactionApplied: provenance.redactionApplied === true
  });
}

async function deleteSocialPostPayload(options = {}) {
  const { client, context, memoryId } = options;
  validateWorkflowContext(context, OPERATIONS.DELETE, memoryId);
  if (options.userConfirmedDelete !== true) throw fail('HFM_SOCIAL_POST_DELETE_CONFIRMATION_REQUIRED');
  const row = await loadRecord(client, context, memoryId);
  assertSocialPostRecord(row, context, { allowErased: true });
  const operation = await beginOperation(client, context, memoryId, OPERATIONS.DELETE, options.idempotencyKey);
  if (operation.duplicate) {
    const state = await getStateRow(client, context.projectId, memoryId);
    if (row.payload_erased_at && state && state.status === 'DELETED' && state.payload_erased_at) {
      return { status: 'DELETED', duplicate: true, memoryId };
    }
    return { status: 'DELETE_STATUS_UNKNOWN', duplicate: true, memoryId };
  }
  if (row.payload_erased_at) throw fail('HFM_SOCIAL_POST_PAYLOAD_ALREADY_ERASED');
  const decoded = (options.decodeStoredRow || decodeStoredRow)(row, {
    allowPrivateRead: true,
    env: options.env || process.env
  });
  const sourceMetadata = sanitizedSourceMetadata(decoded.source || {});
  const provenanceMetadata = sanitizedProvenanceMetadata(decoded.provenance || {});
  const current = await getStateRow(client, context.projectId, memoryId);
  const pendingStatus = nextSocialPostStatus(current && current.status, 'DELETE');
  await updateStatus(client, context, memoryId, pendingStatus, {
    sourceMetadata, provenanceMetadata
  });

  await client.query("SELECT set_config('mira.memory_payload_erasure_operation_id', $1, true)", [operation.operationId]);
  const versions = await client.query(
    'UPDATE mira_hfm.memory_record_versions SET public_payload = NULL, encrypted_envelope = NULL, ' +
    'payload_erased_at = clock_timestamp(), payload_erased_by_actor_id = $3 ' +
    "WHERE project_id = $1 AND memory_id = $2 AND record_type = 'social_post_draft' " +
    "AND classification = 'PROJECT_PRIVATE' AND payload_erased_at IS NULL RETURNING revision",
    [context.projectId, memoryId, context.actorId]
  );
  if (!versions.rowCount || versions.rowCount < 1) throw fail('HFM_SOCIAL_POST_VERSION_PAYLOAD_NOT_FOUND');
  const currentDelete = await client.query(
    'UPDATE mira_hfm.memory_records SET public_payload = NULL, encrypted_envelope = NULL, ' +
    'payload_erased_at = clock_timestamp(), payload_erased_by_actor_id = $3 ' +
    "WHERE project_id = $1 AND memory_id = $2 AND record_type = 'social_post_draft' " +
    "AND classification = 'PROJECT_PRIVATE' AND payload_erased_at IS NULL RETURNING memory_id",
    [context.projectId, memoryId, context.actorId]
  );
  if (currentDelete.rowCount !== 1) throw fail('HFM_SOCIAL_POST_CURRENT_PAYLOAD_ERASURE_FAILED');

  const erasedAt = new Date().toISOString();
  await updateStatus(client, context, memoryId, 'DELETED', { erasedAt });
  await appendSanitizedAudit(client, context, operation.operationId, memoryId, 'SOCIAL_POST_PAYLOAD_ERASED', {
    recordType: 'social_post_draft',
    classification: 'PROJECT_PRIVATE',
    versionsErased: versions.rowCount,
    payloadErased: true,
    metadataRetained: true,
    restrictedRecordsExcluded: true
  });
  await finishOperation(client, operation.operationId, memoryId);
  return { status: 'DELETED', duplicate: false, memoryId, versionsErased: versions.rowCount };
}

async function getSocialPostStatus(options = {}) {
  const { client, context, memoryId } = options;
  validateWorkflowContext(context, 'memory.read', memoryId);
  const row = await loadRecord(client, context, memoryId, { forUpdate: false });
  if (!row) return { status: 'NOT_FOUND', memoryId };
  if (row.project_id !== context.projectId || row.owner_actor_id !== context.actorId ||
      row.record_type !== 'social_post_draft' || row.classification !== 'PROJECT_PRIVATE') {
    throw fail('HFM_SOCIAL_POST_SCOPE_OR_CLASSIFICATION_INVALID');
  }
  const state = await getStateRow(client, context.projectId, memoryId);
  return {
    status: state ? state.status : 'SAVED',
    memoryId,
    createdRecord: true,
    payloadErased: Boolean(row.payload_erased_at),
    copiedAt: state && state.copied_at || null,
    publishedConfirmedAt: state && state.published_confirmed_at || null
  };
}

module.exports = Object.freeze({
  AUTHORITY_CONTEXT, OPERATIONS, STATES,
  listSocialPostDrafts,
  validateWorkflowContext, assertSocialPostRecord, nextSocialPostStatus,
  markSocialPostCopied, confirmSocialPostPublished, deleteSocialPostPayload,
  sanitizedSourceMetadata, sanitizedProvenanceMetadata, getSocialPostStatus
});
