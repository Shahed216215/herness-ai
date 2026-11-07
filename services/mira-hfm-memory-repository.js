'use strict';

const crypto = require('node:crypto');
const { validateCanonicalRecord } = require('./mira-hfm-record-schema');
const { createVaultEnvelope, decryptVaultEnvelope } = require('./mira-hfm-vault-crypto');

const MAX_PAGE_SIZE = 100;
const OPERATION_CONTEXT = 'HFM_CONSUMED_ONE_TIME_AUTHORITY';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + stableJson(value[key])
  ).join(',') + '}';
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function boundedText(value, max, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.trim() !== value) {
    throw fail(code);
  }
  return value;
}

function requireTransaction(options) {
  const client = options && options.client;
  const context = options && options.context;
  if (!client || typeof client.query !== 'function') throw fail('HFM_MEMORY_TRANSACTION_CLIENT_REQUIRED');
  if (!context || context.authorityContext !== OPERATION_CONTEXT ||
      typeof context.actorId !== 'string' || !context.actorId.startsWith('mira:') ||
      typeof context.projectId !== 'string' || !context.projectId ||
      typeof context.operation !== 'string' || !context.operation ||
      typeof context.requestId !== 'string' || !context.requestId) {
    throw fail('HFM_MEMORY_CONSUMED_AUTHORITY_CONTEXT_REQUIRED');
  }
  return { client, context };
}

function recordClassification(record) {
  return record.access.classification;
}

function assertProjectScope(record, projectId) {
  if (record.projectId !== projectId) throw fail('HFM_MEMORY_PROJECT_SCOPE_MISMATCH');
  const allowed = record.access && record.access.allowedProjectIds;
  if (Array.isArray(allowed) &&
      (allowed.length !== 1 || allowed[0] !== projectId)) {
    throw fail('HFM_MEMORY_CROSS_PROJECT_SHARING_NOT_SUPPORTED');
  }
}

function makeVaultContext(record, ownerId) {
  return {
    recordId: record.memoryId,
    ownerId,
    projectId: record.projectId,
    recordType: record.recordType,
    classification: record.access.classification,
    schemaVersion: record.schemaVersion
  };
}

function storedPayload(record, ownerId, env) {
  const classification = recordClassification(record);
  if (classification === 'PUBLIC') {
    return { publicPayload: record, encryptedEnvelope: null };
  }
  const envelope = createVaultEnvelope({
    record,
    context: makeVaultContext(record, ownerId),
    env
  });
  return { publicPayload: null, encryptedEnvelope: envelope };
}

function decodeStoredRow(row, options = {}) {
  const classification = row.classification;
  let record;
  if (classification === 'PUBLIC') {
    record = row.public_payload;
  } else {
    if (classification === 'RESTRICTED' && options.allowRestrictedRead !== true) {
      throw fail('HFM_MEMORY_RESTRICTED_READ_NOT_GRANTED');
    }
    if (classification === 'PROJECT_PRIVATE' && options.allowPrivateRead !== true) {
      throw fail('HFM_MEMORY_PRIVATE_READ_NOT_GRANTED');
    }
    record = decryptVaultEnvelope({
      envelope: row.encrypted_envelope,
      context: {
        recordId: row.memory_id,
        ownerId: row.owner_actor_id,
        projectId: row.project_id,
        recordType: row.record_type,
        classification: row.classification,
        schemaVersion: row.schema_version
      },
      env: options.env || process.env
    });
  }
  const validation = validateCanonicalRecord(record);
  if (!validation.valid) throw fail('HFM_MEMORY_STORED_RECORD_INVALID');
  if (record.memoryId !== row.memory_id ||
      record.projectId !== row.project_id ||
      record.recordType !== row.record_type ||
      record.schemaVersion !== row.schema_version ||
      record.access.classification !== row.classification ||
      record.version.revision !== Number(row.revision) ||
      record.lifecycle !== row.lifecycle) {
    throw fail('HFM_MEMORY_STORED_RECORD_METADATA_MISMATCH');
  }
  return record;
}

async function beginIdempotentOperation(client, context, idempotencyKey, operation, resource, payloadDigest) {
  const key = boundedText(idempotencyKey, 256, 'HFM_MEMORY_IDEMPOTENCY_KEY_INVALID');
  const operationId = crypto.randomUUID();
  const inserted = await client.query(
    'INSERT INTO mira_hfm.memory_operation_registry ' +
    '(operation_id, project_id, actor_id, idempotency_key, operation, resource, purpose, payload_digest, status, created_at, updated_at) ' +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'REQUESTED',clock_timestamp(),clock_timestamp()) " +
    'ON CONFLICT (project_id, idempotency_key) DO NOTHING RETURNING operation_id',
    [operationId, context.projectId, context.actorId, key, operation, resource, context.purpose || operation, payloadDigest]
  );
  if (inserted.rowCount === 1) return { operationId, duplicate: false };

  const existingResult = await client.query(
    'SELECT operation_id, actor_id, operation, resource, purpose, payload_digest, status, result_code ' +
    'FROM mira_hfm.memory_operation_registry WHERE project_id = $1 AND idempotency_key = $2 FOR UPDATE',
    [context.projectId, key]
  );
  const existing = existingResult.rows && existingResult.rows[0];
  if (!existing) throw fail('HFM_MEMORY_IDEMPOTENCY_OUTCOME_UNKNOWN');
  if (existing.actor_id !== context.actorId ||
      existing.operation !== operation ||
      existing.resource !== resource ||
      existing.purpose !== (context.purpose || operation) ||
      existing.payload_digest !== payloadDigest) {
    throw fail('HFM_MEMORY_IDEMPOTENCY_CONFLICT');
  }
  if (existing.status === 'COMPLETED') {
    return { operationId: existing.operation_id, duplicate: true, resultCode: existing.result_code };
  }
  throw fail('HFM_MEMORY_IDEMPOTENCY_IN_PROGRESS_OR_UNKNOWN');
}

async function completeOperation(client, operationId, resultCode) {
  const result = await client.query(
    "UPDATE mira_hfm.memory_operation_registry SET status = 'COMPLETED', result_code = $2, updated_at = clock_timestamp() " +
    "WHERE operation_id = $1 AND status = 'REQUESTED' RETURNING operation_id",
    [operationId, resultCode]
  );
  if (result.rowCount !== 1) throw fail('HFM_MEMORY_OPERATION_COMPLETION_FAILED');
}

async function appendAudit(client, context, operationId, memoryId, eventType, resultStatus, details = {}) {
  // Serialize the per-project hash-chain append within the caller-owned transaction.
  // Without this transaction-scoped lock, concurrent writers can read the same
  // previous hash and create two valid-looking but disconnected audit branches.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [context.projectId]);
  const previousResult = await client.query(
    'SELECT event_hash FROM mira_hfm.memory_audit_events WHERE project_id = $1 ORDER BY event_sequence DESC LIMIT 1',
    [context.projectId]
  );
  const previousHash = previousResult.rows && previousResult.rows[0]
    ? previousResult.rows[0].event_hash
    : null;
  const event = {
    eventId: crypto.randomUUID(),
    projectId: context.projectId,
    actorId: context.actorId,
    operationId,
    memoryId: memoryId || null,
    eventType,
    resultStatus,
    policyVersion: 'HFM-MEMORY-1.1.0',
    occurredAt: new Date().toISOString(),
    previousEventHash: previousHash,
    details
  };
  const eventHash = digest(event);
  await client.query(
    'INSERT INTO mira_hfm.memory_audit_events ' +
    '(event_id, project_id, actor_id, operation_id, memory_id, event_type, result_status, policy_version, occurred_at, previous_event_hash, event_hash, details) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
    [event.eventId, event.projectId, event.actorId, event.operationId, event.memoryId,
      event.eventType, event.resultStatus, event.policyVersion, event.occurredAt,
      event.previousEventHash, eventHash, JSON.stringify(details)]
  );
}

function insertValues(record, ownerId, payload) {
  return [
    record.memoryId, record.projectId, ownerId, record.recordType, record.schemaVersion,
    record.access.classification, record.lifecycle, record.version.revision,
    record.integrity.status, record.trust.status,
    payload.publicPayload === null ? null : JSON.stringify(payload.publicPayload),
    payload.encryptedEnvelope === null ? null : JSON.stringify(payload.encryptedEnvelope),
    record.timestamps.createdAt, record.timestamps.updatedAt
  ];
}

async function insertVersion(client, record, ownerId, payload, trashedAt = null, trashedByActorId = null) {
  await client.query(
    'INSERT INTO mira_hfm.memory_record_versions ' +
    '(memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, ' +
    'revision, integrity_status, trust_status, public_payload, encrypted_envelope, trashed_at, trashed_by_actor_id, recorded_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,clock_timestamp())',
    [...insertValues(record, ownerId, payload).slice(0, 12), trashedAt, trashedByActorId]
  );
}

async function createMemoryRecord(options = {}) {
  const { client, context } = requireTransaction(options);
  if (context.operation !== 'memory.write') throw fail('HFM_MEMORY_OPERATION_SCOPE_INVALID');
  const record = options.record;
  const validation = validateCanonicalRecord(record);
  if (!validation.valid) throw fail('HFM_MEMORY_RECORD_INVALID');
  assertProjectScope(record, context.projectId);
  if (record.lifecycle === 'TRASHED') throw fail('HFM_MEMORY_INITIAL_TRASH_STATE_INVALID');

  const classification = recordClassification(record);
  if (classification === 'RESTRICTED' && options.allowRestrictedWrite !== true) {
    throw fail('HFM_MEMORY_RESTRICTED_WRITE_NOT_GRANTED');
  }
  if (classification === 'PROJECT_PRIVATE' && options.allowPrivateWrite !== true) {
    throw fail('HFM_MEMORY_PRIVATE_WRITE_NOT_GRANTED');
  }

  const ownerId = context.actorId;
  const resource = 'memory:' + record.memoryId;
  if (context.resource !== resource) throw fail('HFM_MEMORY_AUTHORITY_RESOURCE_MISMATCH');
  const payloadDigest = digest(record);
  const operation = await beginIdempotentOperation(
    client, context, options.idempotencyKey, 'memory.write', resource, payloadDigest
  );
  if (operation.duplicate) {
    return { status: 'ALREADY_COMMITTED', memoryId: operation.resultCode, duplicate: true };
  }

  const payload = storedPayload(record, ownerId, options.env || process.env);
  const values = insertValues(record, ownerId, payload);
  await client.query(
    'INSERT INTO mira_hfm.memory_records ' +
    '(memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, ' +
    'integrity_status, trust_status, public_payload, encrypted_envelope, created_at, updated_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)',
    values
  );
  await insertVersion(client, record, ownerId, payload);
  await appendAudit(client, context, operation.operationId, record.memoryId, 'MEMORY_CREATED', 'COMPLETED', {
    recordType: record.recordType,
    classification,
    revision: record.version.revision,
    contentHash: record.version.contentHash
  });
  await completeOperation(client, operation.operationId, record.memoryId);
  return { status: 'CREATED', memoryId: record.memoryId, revision: record.version.revision, duplicate: false };
}

async function reviseMemoryRecord(options = {}) {
  const { client, context } = requireTransaction(options);
  if (context.operation !== 'memory.update') throw fail('HFM_MEMORY_OPERATION_SCOPE_INVALID');
  const memoryId = boundedText(options.memoryId, 128, 'HFM_MEMORY_ID_INVALID');
  const resource = 'memory:' + memoryId;
  if (context.resource !== resource) throw fail('HFM_MEMORY_AUTHORITY_RESOURCE_MISMATCH');

  const nextRecord = options.record;
  const validation = validateCanonicalRecord(nextRecord);
  if (!validation.valid) throw fail('HFM_MEMORY_RECORD_INVALID');
  if (nextRecord.memoryId !== memoryId) throw fail('HFM_MEMORY_RECORD_IDENTITY_MISMATCH');
  assertProjectScope(nextRecord, context.projectId);

  const operation = await beginIdempotentOperation(
    client, context, options.idempotencyKey, 'memory.update', resource, digest(nextRecord)
  );
  if (operation.duplicate) {
    return { status: 'ALREADY_COMMITTED', memoryId: operation.resultCode, duplicate: true };
  }

  const currentResult = await client.query(
    'SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, ' +
    'integrity_status, trust_status, public_payload, encrypted_envelope, created_at, updated_at ' +
    'FROM mira_hfm.memory_records WHERE project_id = $1 AND memory_id = $2 FOR UPDATE',
    [context.projectId, memoryId]
  );
  const row = currentResult.rows && currentResult.rows[0];
  if (!row) throw fail('HFM_MEMORY_RECORD_NOT_FOUND');
  if (row.lifecycle === 'TRASHED') throw fail('HFM_MEMORY_TRASHED_RECORD_IMMUTABLE');
  if (row.classification === 'PROJECT_PRIVATE' && options.allowPrivateWrite !== true) {
    throw fail('HFM_MEMORY_PRIVATE_WRITE_NOT_GRANTED');
  }
  if (row.classification === 'RESTRICTED' && options.allowRestrictedWrite !== true) {
    throw fail('HFM_MEMORY_RESTRICTED_WRITE_NOT_GRANTED');
  }
  if (nextRecord.recordType !== row.record_type ||
      nextRecord.schemaVersion !== row.schema_version ||
      nextRecord.access.classification !== row.classification ||
      nextRecord.lifecycle !== row.lifecycle ||
      nextRecord.timestamps.createdAt !== new Date(row.created_at).toISOString() ||
      nextRecord.version.revision !== Number(row.revision) + 1 ||
      Date.parse(nextRecord.timestamps.updatedAt) <= Date.parse(row.updated_at)) {
    throw fail('HFM_MEMORY_REVISION_IDENTITY_OR_ORDER_INVALID');
  }

  const payload = storedPayload(nextRecord, row.owner_actor_id, options.env || process.env);
  await insertVersion(client, nextRecord, row.owner_actor_id, payload);
  const update = await client.query(
    'UPDATE mira_hfm.memory_records SET revision = $3, integrity_status = $4, trust_status = $5, ' +
    'public_payload = $6::jsonb, encrypted_envelope = $7::jsonb, updated_at = $8 ' +
    'WHERE project_id = $1 AND memory_id = $2 AND revision = $9 RETURNING memory_id',
    [context.projectId, memoryId, nextRecord.version.revision,
      nextRecord.integrity.status, nextRecord.trust.status,
      payload.publicPayload === null ? null : JSON.stringify(payload.publicPayload),
      payload.encryptedEnvelope === null ? null : JSON.stringify(payload.encryptedEnvelope),
      nextRecord.timestamps.updatedAt, row.revision]
  );
  if (update.rowCount !== 1) throw fail('HFM_MEMORY_REVISION_CONFLICT');
  await appendAudit(client, context, operation.operationId, memoryId, 'MEMORY_REVISED', 'COMPLETED', {
    recordType: nextRecord.recordType,
    classification: row.classification,
    revision: nextRecord.version.revision,
    contentHash: nextRecord.version.contentHash
  });
  await completeOperation(client, operation.operationId, memoryId);
  return { status: 'REVISED', memoryId, revision: nextRecord.version.revision };
}

async function getMemoryRecord(options = {}) {
  const { client, context } = requireTransaction(options);
  if (context.operation !== 'memory.read') throw fail('HFM_MEMORY_OPERATION_SCOPE_INVALID');
  const memoryId = boundedText(options.memoryId, 128, 'HFM_MEMORY_ID_INVALID');
  if (context.resource !== 'memory:' + memoryId) throw fail('HFM_MEMORY_AUTHORITY_RESOURCE_MISMATCH');
  const result = await client.query(
    'SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, ' +
    'integrity_status, trust_status, public_payload, encrypted_envelope FROM mira_hfm.memory_records ' +
    'WHERE project_id = $1 AND memory_id = $2',
    [context.projectId, memoryId]
  );
  const row = result.rows && result.rows[0];
  if (!row) return { status: 'NOT_FOUND', record: null };
  return { status: 'FOUND', record: decodeStoredRow(row, options) };
}

async function listMemoryRecords(options = {}) {
  const { client, context } = requireTransaction(options);
  if (context.operation !== 'memory.read') throw fail('HFM_MEMORY_OPERATION_SCOPE_INVALID');
  if (context.resource !== 'memory:project:' + context.projectId) throw fail('HFM_MEMORY_AUTHORITY_RESOURCE_MISMATCH');
  const limit = Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), MAX_PAGE_SIZE) : 25;
  const lifecycle = options.lifecycle || 'ACTIVE';
  if (!['ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'TRASHED', 'QUARANTINED', 'PENDING_REVIEW'].includes(lifecycle)) {
    throw fail('HFM_MEMORY_LIFECYCLE_FILTER_INVALID');
  }
  const result = await client.query(
    'SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, ' +
    'integrity_status, trust_status, public_payload, encrypted_envelope FROM mira_hfm.memory_records ' +
    'WHERE project_id = $1 AND lifecycle = $2 ORDER BY updated_at DESC, memory_id ASC LIMIT $3',
    [context.projectId, lifecycle, limit]
  );
  return {
    status: 'FOUND',
    records: (result.rows || []).map(row => decodeStoredRow(row, options)),
    count: (result.rows || []).length
  };
}

async function changeLifecycle(options, targetLifecycle) {
  const { client, context } = requireTransaction(options);
  const expectedOperation = targetLifecycle === 'TRASHED' ? 'memory.trash' : 'memory.restore';
  if (context.operation !== expectedOperation) throw fail('HFM_MEMORY_OPERATION_SCOPE_INVALID');
  const memoryId = boundedText(options.memoryId, 128, 'HFM_MEMORY_ID_INVALID');
  const resource = 'memory:' + memoryId;
  if (context.resource !== resource) throw fail('HFM_MEMORY_AUTHORITY_RESOURCE_MISMATCH');
  const operation = await beginIdempotentOperation(
    client, context, options.idempotencyKey, expectedOperation, resource,
    digest({ memoryId, targetLifecycle })
  );
  if (operation.duplicate) {
    return { status: 'ALREADY_COMMITTED', memoryId: operation.resultCode, duplicate: true };
  }

  const currentResult = await client.query(
    'SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, ' +
    'integrity_status, trust_status, public_payload, encrypted_envelope, created_at, updated_at ' +
    'FROM mira_hfm.memory_records WHERE project_id = $1 AND memory_id = $2 FOR UPDATE',
    [context.projectId, memoryId]
  );
  const row = currentResult.rows && currentResult.rows[0];
  if (!row) throw fail('HFM_MEMORY_RECORD_NOT_FOUND');
  if (targetLifecycle === 'TRASHED' && row.lifecycle === 'TRASHED') {
    throw fail('HFM_MEMORY_ALREADY_TRASHED');
  }
  if (targetLifecycle === 'ACTIVE' && row.lifecycle !== 'TRASHED') {
    throw fail('HFM_MEMORY_RECORD_NOT_TRASHED');
  }

  if (row.classification === 'PROJECT_PRIVATE' && options.allowPrivateLifecycle !== true) {
    throw fail('HFM_MEMORY_PRIVATE_LIFECYCLE_NOT_GRANTED');
  }
  if (row.classification === 'RESTRICTED' && options.allowRestrictedLifecycle !== true) {
    throw fail('HFM_MEMORY_RESTRICTED_LIFECYCLE_NOT_GRANTED');
  }
  const record = decodeStoredRow(row, {
    ...options,
    allowPrivateRead: options.allowPrivateLifecycle === true,
    allowRestrictedRead: options.allowRestrictedLifecycle === true
  });
  const now = new Date().toISOString();
  const nextRecord = {
    ...record,
    timestamps: { ...record.timestamps, updatedAt: now },
    version: { ...record.version, revision: Number(row.revision) + 1 },
    lifecycle: targetLifecycle
  };
  const payload = storedPayload(nextRecord, row.owner_actor_id, options.env || process.env);
  const trashAt = targetLifecycle === 'TRASHED' ? now : null;
  const trashedBy = targetLifecycle === 'TRASHED' ? context.actorId : null;

  await insertVersion(client, nextRecord, row.owner_actor_id, payload, trashAt, trashedBy);
  const update = await client.query(
    'UPDATE mira_hfm.memory_records SET lifecycle = $3, trashed_at = $4, trashed_by_actor_id = $5, ' +
    'revision = $6, integrity_status = $7, trust_status = $8, public_payload = $9::jsonb, ' +
    'encrypted_envelope = $10::jsonb, updated_at = $11 ' +
    'WHERE project_id = $1 AND memory_id = $2 AND revision = $12 RETURNING memory_id',
    [context.projectId, memoryId, targetLifecycle, trashAt, trashedBy,
      nextRecord.version.revision, nextRecord.integrity.status, nextRecord.trust.status,
      payload.publicPayload === null ? null : JSON.stringify(payload.publicPayload),
      payload.encryptedEnvelope === null ? null : JSON.stringify(payload.encryptedEnvelope),
      now, row.revision]
  );
  if (update.rowCount !== 1) throw fail('HFM_MEMORY_REVISION_CONFLICT');
  await appendAudit(client, context, operation.operationId, memoryId,
    targetLifecycle === 'TRASHED' ? 'MEMORY_TRASHED' : 'MEMORY_RESTORED',
    'COMPLETED', { recordType: row.record_type, classification: row.classification, revision: nextRecord.version.revision });
  await completeOperation(client, operation.operationId, memoryId);
  return { status: targetLifecycle === 'TRASHED' ? 'TRASHED' : 'RESTORED', memoryId, revision: nextRecord.version.revision };
}

function trashMemoryRecord(options = {}) {
  return changeLifecycle(options, 'TRASHED');
}

function restoreMemoryRecord(options = {}) {
  return changeLifecycle(options, 'ACTIVE');
}

module.exports = Object.freeze({
  createMemoryRecord,
  reviseMemoryRecord,
  decodeStoredRow,
  getMemoryRecord,
  listMemoryRecords,
  trashMemoryRecord,
  restoreMemoryRecord,
  digest,
  stableJson
});
