'use strict';

const assert = require('node:assert/strict');
const {
  createSupabaseFacebookGroupImportStore
} = require('../services/mira-facebook-group-memory-supabase-store');
const {
  createFacebookGroupImportService
} = require('../services/mira-facebook-group-memory-import');

const batches = new Map();
const audits = new Map();
const auditOperations = new Map();
const calls = [];
const env = {
  SUPABASE_URL: 'https://fixture-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key-never-real'
};

async function mockRequest(rawUrl, config) {
  const url = new URL(rawUrl);
  calls.push({ url: rawUrl, method: config.method, headers: config.headers });
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'fixture-project.supabase.co');
  assert.equal(config.headers.Authorization, 'Bearer fixture-service-role-key-never-real');

  if (url.pathname.endsWith('/rpc/mira_stage_facebook_group_import_v1') && config.method === 'POST') {
    const { p_batch, p_event, p_operation_key } = config.data;
    const oldBatch = batches.get(p_batch.batchId);
    if (oldBatch && oldBatch.batch_digest !== p_batch.batchDigest) return { status: 409, data: { code: '23505' } };
    if (!oldBatch) batches.set(p_batch.batchId, {
      batch_id: p_batch.batchId, project_id: p_batch.projectId, group_id: p_batch.groupId,
      export_id: p_batch.exportId, batch_digest: p_batch.batchDigest, payload: JSON.parse(JSON.stringify(p_batch))
    });
    let audit = auditOperations.get(p_operation_key);
    if (audit && audit.event_digest !== p_event.eventDigest) throw new Error('audit conflict');
    let auditStatus = 'ALREADY_EXISTS';
    if (!audit) {
      auditStatus = 'CREATED';
      audit = {
        event_id: p_event.eventId, operation_key: p_operation_key,
        project_id: p_event.projectId, group_id: p_event.groupId,
        batch_id: p_event.batchId, event_digest: p_event.eventDigest,
        payload: { ...p_event, recordedAt: '2026-11-05T12:00:00.000Z' }
      };
      audits.set(audit.event_id, JSON.parse(JSON.stringify(audit)));
      auditOperations.set(p_operation_key, audit);
    }
    return { status: 200, data: [{
      batch_status: oldBatch ? 'ALREADY_EXISTS' : 'CREATED',
      audit_status: auditStatus, event_id: audit.event_id, event_digest: audit.event_digest,
      batch_id: p_batch.batchId, batch_digest: p_batch.batchDigest,
      project_id: p_batch.projectId, group_id: p_batch.groupId
    }] };
  }
  const table = url.pathname.split('/').pop();
  const query = url.searchParams;
  if (table === 'mira_facebook_group_import_batches') {
    if (config.method === 'POST') {
      const inserted = [];
      for (const row of config.data) {
        if (!batches.has(row.batch_id)) {
          batches.set(row.batch_id, JSON.parse(JSON.stringify(row)));
          inserted.push(row);
        }
      }
      return { status: 201, data: inserted };
    }
    if (config.method === 'GET') {
      const found = [...batches.values()].filter(row =>
        (!query.has('batch_id') || row.batch_id === query.get('batch_id').slice(3)) &&
        (!query.has('project_id') || row.project_id === query.get('project_id').slice(3)) &&
        (!query.has('group_id') || row.group_id === query.get('group_id').slice(3))
      );
      return { status: 200, data: JSON.parse(JSON.stringify(found)) };
    }
  }
  if (table === 'mira_facebook_group_import_audit_events') {
    if (config.method === 'POST') {
      const inserted = [];
      for (const row of config.data) {
        audits.set(row.event_id, JSON.parse(JSON.stringify(row)));
        inserted.push(row);
      }
      return { status: 201, data: inserted };
    }
    if (config.method === 'GET') {
      const id = query.has('operation_key') ? auditOperations.get(query.get('operation_key').slice(3))?.event_id : query.get('event_id').slice(3);
      const row = audits.get(id);
      return { status: 200, data: row ? [JSON.parse(JSON.stringify(row))] : [] };
    }
  }
  throw new Error('Unexpected mock Supabase request: ' + config.method + ' ' + url.pathname);
}

const store = createSupabaseFacebookGroupImportStore({ env, request: mockRequest });
const service = createFacebookGroupImportService({ store });
const record = {
  memoryId: 'memory-group-supabase-001',
  sourceId: 'group-post-202',
  sourceUrl: 'https://www.facebook.com/groups/123456789/posts/202/',
  recordType: 'knowledge',
  content: 'Synthetic Supabase-backed Group import record.',
  observedAt: '2026-11-04T10:00:00.000Z',
  revision: 1
};
const envelope = {
  schemaVersion: '1.0.0',
  kind: 'MIRA_FACEBOOK_GROUP_MEMORY_IMPORT',
  groupId: '123456789',
  projectId: 'project-hfm-v02',
  exportId: 'supabase-fixture-001',
  records: [record]
};
const input = {
  format: 'json',
  content: JSON.stringify(envelope),
  groupId: envelope.groupId,
  projectId: envelope.projectId,
  actorId: 'admin-fixture',
  authorizedAccess: true,
  existingRecords: []
};

(async () => {
  const result = await service.import(input);
  assert.equal(result.status, 'IMPORT_STAGED_READBACK_VERIFIED');
  assert.equal(batches.size, 1);
  assert.equal(audits.size, 1);
  assert.equal(result.canonicalMemoryWrite, false);

  const duplicate = await service.import(input);
  assert.equal(duplicate.batchId, result.batchId);
  assert.equal(duplicate.batchDigest, result.batchDigest);
  assert.equal(batches.size, 1);
  assert.equal(audits.size, 1);

  const conflictEnvelope = {
    ...envelope,
    records: [{ ...record, content: 'Changed content under same export identity.' }]
  };
  await assert.rejects(
    () => service.import({ ...input, content: JSON.stringify(conflictEnvelope) }),
    error => error.code === 'FB_GROUP_STORE_ATOMIC_IDENTITY_CONFLICT'
  );
  assert.equal(batches.size, 1);

  const retrieved = await service.retrieve({
    projectId: envelope.projectId,
    groupId: envelope.groupId,
    query: 'synthetic supabase'
  });
  assert.equal(retrieved.resultCount, 1);
  assert.equal(retrieved.results[0].retrievableAsTrustedMemory, false);

  const stored = batches.get(result.batchId);
  stored.payload.items[0].record.content = 'tampered persisted content';
  await assert.rejects(
    () => store.listBatches({ projectId: envelope.projectId, groupId: envelope.groupId }),
    error => error.code === 'FB_GROUP_STORE_INTEGRITY_FAILED'
  );

  assert.ok(calls.some(call => call.url.includes('/mira_facebook_group_import_batches')));
  assert.ok(calls.some(call => call.url.includes('/mira_facebook_group_import_audit_events')));
  assert.ok(calls.every(call => !call.url.includes('facebook.com')));
  console.log('GROUP_IMPORT_SUPABASE_ATOMIC_BATCH_AUDIT_TRANSACTION=PASS');
  console.log('GROUP_IMPORT_SUPABASE_IDEMPOTENT_AUDIT_READBACK=PASS');
  console.log('GROUP_IMPORT_SUPABASE_IDEMPOTENCY_AND_CONFLICT=PASS');
  console.log('GROUP_IMPORT_SUPABASE_RETRIEVAL_ISOLATION=PASS');
  console.log('LIVE_FACEBOOK_REQUESTS=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
