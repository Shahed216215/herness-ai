'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const repository = require('../services/mira-hfm-memory-repository');
const { createContentHash } = require('../services/mira-hfm-record-schema');

const now = '2026-11-06T12:00:00.000Z';
const env = {
  MIRA_VAULT_ACTIVE_KEK_VERSION: 'v1',
  MIRA_VAULT_KEK_V1: crypto.randomBytes(32).toString('base64')
};
const context = Object.freeze({
  actorId: 'mira:mira.users:11111111-1111-4111-8111-111111111111',
  projectId: 'project-001',
  operation: 'memory.write',
  requestId: 'request-001',
  resource: 'memory:record-0001',
  purpose: 'approved memory write',
  authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY'
});

function record(overrides = {}) {
  const value = {
    schemaVersion: '1.1.0',
    memoryId: 'record-0001',
    projectId: 'project-001',
    recordType: 'daily_activity',
    content: 'Completed the approved project review.',
    source: {
      sourceType: 'internal_system',
      sourceId: 'mira-session-001',
      observedAt: now
    },
    timestamps: { createdAt: now, updatedAt: now },
    version: { revision: 1, contentHash: createContentHash('Completed the approved project review.') },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-001'] },
    lifecycle: 'ACTIVE'
  };
  return { ...value, ...overrides };
}

function fakeClient(handlers = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (handlers.query) return handlers.query(sql, params, calls);
      if (sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry')) {
        return { rowCount: 1, rows: [{ operation_id: params[0] }] };
      }
      if (sql.startsWith('SELECT event_hash')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('UPDATE mira_hfm.memory_operation_registry')) return { rowCount: 1, rows: [{}] };
      return { rowCount: 1, rows: [{}] };
    }
  };
}

test('create requires a consumed authority context and the same transaction client', async () => {
  const client = fakeClient();
  await assert.rejects(
    repository.createMemoryRecord({ client, context: { ...context, authorityContext: undefined }, record: record(), idempotencyKey: 'idem-1', allowPrivateWrite: true, env }),
    error => error.code === 'HFM_MEMORY_CONSUMED_AUTHORITY_CONTEXT_REQUIRED'
  );
  await assert.rejects(
    repository.createMemoryRecord({ client, context, record: record({ projectId: 'other-project' }), idempotencyKey: 'idem-2', allowPrivateWrite: true, env }),
    error => error.code === 'HFM_MEMORY_PROJECT_SCOPE_MISMATCH'
  );
  await assert.rejects(
    repository.createMemoryRecord({ client, context, record: record({ access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-001', 'other-project'] } }), idempotencyKey: 'idem-3', allowPrivateWrite: true, env }),
    error => error.code === 'HFM_MEMORY_CROSS_PROJECT_SHARING_NOT_SUPPORTED'
  );
  const standingReadContext = {
    ...context,
    operation: 'memory.read',
    authorityContext: 'HFM_ACTIVE_STANDING_READ_AUTHORITY'
  };
  await assert.rejects(
    repository.createMemoryRecord({
      client, context: standingReadContext, record: record(),
      idempotencyKey: 'idem-standing-write', allowPrivateWrite: true, env
    }),
    error => error.code === 'HFM_MEMORY_OPERATION_SCOPE_INVALID'
  );
  assert.equal(client.calls.length, 0);
});

test('private memory is encrypted before any database insert', async () => {
  const client = fakeClient();
  const result = await repository.createMemoryRecord({
    client, context, record: record(), idempotencyKey: 'idem-private-1',
    allowPrivateWrite: true, env
  });
  assert.equal(result.status, 'CREATED');
  const insert = client.calls.find(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_records'));
  assert.ok(insert);
  assert.equal(insert.params[10], null);
  assert.equal(typeof insert.params[11], 'string');
  assert.equal(insert.params[11].includes('Completed the approved project review.'), false);
  assert.ok(client.calls.some(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_record_versions')));
  assert.ok(client.calls.some(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_audit_events')));
  assert.ok(client.calls.some(call => call.sql.startsWith('UPDATE mira_hfm.memory_operation_registry')));
  const operationInsert = client.calls.find(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry'));
  assert.notEqual(operationInsert.params[7], repository.digest(record()), 'private idempotency digest must be keyed');
  const auditInsert = client.calls.find(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_audit_events'));
  assert.equal(auditInsert.params[11].includes('contentHash'), false, 'private content hash must not enter audit metadata');
  assert.equal(auditInsert.params[11].includes(record().content), false, 'private content must not enter audit metadata');
});

test('private and restricted writes fail closed without explicit classification grants', async () => {
  const client = fakeClient();
  await assert.rejects(
    repository.createMemoryRecord({ client, context, record: record(), idempotencyKey: 'idem-no-private', env }),
    error => error.code === 'HFM_MEMORY_PRIVATE_WRITE_NOT_GRANTED'
  );
  const restricted = record({
    recordType: 'client_vault_record',
    content: JSON.stringify({ clientName: 'Example Client', notes: 'confidential' }),
    version: { revision: 1, contentHash: createContentHash(JSON.stringify({ clientName: 'Example Client', notes: 'confidential' })) },
    access: { classification: 'RESTRICTED', allowedProjectIds: ['project-001'] }
  });
  await assert.rejects(
    repository.createMemoryRecord({ client, context, record: restricted, idempotencyKey: 'idem-no-restricted', env }),
    error => error.code === 'HFM_MEMORY_RESTRICTED_WRITE_NOT_GRANTED'
  );
  assert.equal(client.calls.length, 0);
});

test('restricted client and financial vault records are encrypted before insert with explicit restricted-write capability', async () => {
  for (const recordType of ['client_vault_record', 'financial_vault_record']) {
    const client = fakeClient();
    const memoryId = 'vault-' + recordType;
    const content = JSON.stringify({
      fixture: 'restricted-vault-contract',
      recordType,
      confidentialValue: 'must-not-be-stored-as-plaintext'
    });
    const vaultRecord = record({
      memoryId,
      recordType,
      content,
      version: { revision: 1, contentHash: createContentHash(content) },
      access: { classification: 'RESTRICTED', allowedProjectIds: ['project-001'] }
    });
    const vaultContext = { ...context, resource: 'memory:' + memoryId };
    const result = await repository.createMemoryRecord({
      client,
      context: vaultContext,
      record: vaultRecord,
      idempotencyKey: 'idem-' + recordType,
      allowRestrictedWrite: true,
      env
    });
    assert.equal(result.status, 'CREATED', recordType);
    const insert = client.calls.find(call =>
      call.sql.startsWith('INSERT INTO mira_hfm.memory_records')
    );
    assert.ok(insert, recordType + ' insert missing');
    assert.equal(insert.params[10], null, recordType + ' public payload must be null');
    assert.equal(typeof insert.params[11], 'string', recordType + ' encrypted envelope missing');
    assert.equal(insert.params[11].includes('must-not-be-stored-as-plaintext'), false);
    assert.ok(client.calls.some(call =>
      call.sql.startsWith('INSERT INTO mira_hfm.memory_record_versions')
    ), recordType + ' immutable version missing');
    assert.ok(client.calls.some(call =>
      call.sql.startsWith('INSERT INTO mira_hfm.memory_audit_events')
    ), recordType + ' audit event missing');
  }
});

test('public memory remains plaintext and searchable without writing an encrypted envelope', async () => {
  const client = fakeClient();
  const publicRecord = record({
    recordType: 'knowledge_item',
    content: 'Public research note.',
    version: { revision: 1, contentHash: createContentHash('Public research note.') },
    access: { classification: 'PUBLIC', allowedProjectIds: ['project-001'] }
  });
  const result = await repository.createMemoryRecord({
    client, context, record: publicRecord, idempotencyKey: 'idem-public-1', env
  });
  const insert = client.calls.find(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_records'));
  assert.equal(result.status, 'CREATED');
  assert.equal(insert.params[10].includes('Public research note.'), true);
  assert.equal(insert.params[11], null);
});

test('completed idempotency key returns the original result without a second write', async () => {
  const client = fakeClient({
    query(sql) {
      if (sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT operation_id')) return { rowCount: 1, rows: [{
        operation_id: 'operation-existing', actor_id: context.actorId, operation: 'memory.write',
        resource: 'memory:record-0001', purpose: context.purpose,
        payload_digest: require('../services/mira-hfm-vault-crypto').createVaultDigestCandidates(repository.stableJson(record()), env).activeDigest, status: 'COMPLETED', result_code: 'record-0001'
      }] };
      throw new Error('unexpected SQL');
    }
  });
  const result = await repository.createMemoryRecord({
    client, context, record: record(), idempotencyKey: 'idem-existing',
    allowPrivateWrite: true, env
  });
  assert.deepEqual(result, { status: 'ALREADY_COMMITTED', memoryId: 'record-0001', duplicate: true });
  assert.equal(client.calls.length, 2);
});

test('project audit hash-chain append is serialized before reading the previous hash', async () => {
  const client = fakeClient();
  const result = await repository.createMemoryRecord({
    client, context, record: record(), idempotencyKey: 'idem-audit-chain-lock',
    allowPrivateWrite: true, env
  });
  assert.equal(result.status, 'CREATED');
  const lockIndex = client.calls.findIndex(call =>
    call.sql === 'SELECT pg_advisory_xact_lock(hashtext($1))' &&
    call.params[0] === context.projectId
  );
  const previousHashIndex = client.calls.findIndex(call =>
    call.sql.startsWith('SELECT event_hash FROM mira_hfm.memory_audit_events')
  );
  const auditInsertIndex = client.calls.findIndex(call =>
    call.sql.startsWith('INSERT INTO mira_hfm.memory_audit_events')
  );
  assert.ok(lockIndex >= 0);
  assert.ok(previousHashIndex > lockIndex);
  assert.ok(auditInsertIndex > previousHashIndex);
});

test('revision writes append-only history and advances the current revision', async () => {
  const original = record({
    recordType: 'knowledge_item',
    content: 'First public note.',
    version: { revision: 1, contentHash: createContentHash('First public note.') },
    access: { classification: 'PUBLIC', allowedProjectIds: ['project-001'] }
  });
  const revised = {
    ...original,
    content: 'Revised public note.',
    timestamps: { ...original.timestamps, updatedAt: '2026-11-06T12:01:00.000Z' },
    version: { revision: 2, contentHash: createContentHash('Revised public note.') }
  };
  const row = {
    memory_id: original.memoryId, project_id: original.projectId,
    owner_actor_id: context.actorId, record_type: original.recordType,
    schema_version: original.schemaVersion, classification: 'PUBLIC',
    lifecycle: 'ACTIVE', revision: 1, integrity_status: 'VERIFIED',
    trust_status: 'SOURCE_RECORDED', public_payload: original, encrypted_envelope: null,
    created_at: new Date(original.timestamps.createdAt),
    updated_at: new Date(original.timestamps.updatedAt)
  };
  const client = fakeClient({
    query: async sql => {
      if (sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('SELECT memory_id') && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [row] };
      if (sql.startsWith('SELECT event_hash')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{}] };
    }
  });
  const result = await repository.reviseMemoryRecord({
    client,
    context: { ...context, operation: 'memory.update' },
    memoryId: original.memoryId,
    record: revised,
    idempotencyKey: 'revise-public-1',
    env
  });
  assert.equal(result.status, 'REVISED');
  assert.equal(result.revision, 2);
  const versionInsert = client.calls.find(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_record_versions'));
  assert.ok(versionInsert);
  assert.equal(versionInsert.params[7], 2);
  const update = client.calls.find(call => call.sql.startsWith('UPDATE mira_hfm.memory_records SET revision'));
  assert.ok(update);
  assert.equal(update.params[2], 2);
  assert.ok(client.calls.some(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_audit_events')));
});

test('private read requires explicit authorization and verifies encrypted record context', async () => {
  const privateRecord = record();
  const { createVaultEnvelope } = require('../services/mira-hfm-vault-crypto');
  const envelope = createVaultEnvelope({
    record: privateRecord,
    context: {
      recordId: privateRecord.memoryId,
      ownerId: context.actorId,
      projectId: privateRecord.projectId,
      recordType: privateRecord.recordType,
      classification: 'PROJECT_PRIVATE',
      schemaVersion: privateRecord.schemaVersion
    },
    env
  });
  const row = {
    memory_id: privateRecord.memoryId, project_id: privateRecord.projectId,
    owner_actor_id: context.actorId, record_type: privateRecord.recordType,
    schema_version: privateRecord.schemaVersion, classification: 'PROJECT_PRIVATE',
    lifecycle: 'ACTIVE', revision: 1, integrity_status: 'VERIFIED',
    trust_status: 'SOURCE_RECORDED', public_payload: null, encrypted_envelope: envelope
  };
  const client = fakeClient({ query: async sql => sql.startsWith('SELECT memory_id')
    ? { rowCount: 1, rows: [row] } : { rowCount: 1, rows: [] } });
  await assert.rejects(
    repository.getMemoryRecord({ client, context: { ...context, operation: 'memory.read' }, memoryId: row.memory_id, env }),
    error => error.code === 'HFM_MEMORY_PRIVATE_READ_NOT_GRANTED'
  );
  const result = await repository.getMemoryRecord({
    client, context: { ...context, operation: 'memory.read' },
    memoryId: row.memory_id, allowPrivateRead: true, env
  });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.record.content, privateRecord.content);
  const trustMismatchClient = fakeClient({
    query: async sql => sql.startsWith('SELECT memory_id')
      ? { rowCount: 1, rows: [{ ...row, trust_status: 'HUMAN_VERIFIED' }] }
      : { rowCount: 0, rows: [] }
  });
  await assert.rejects(
    repository.getMemoryRecord({
      client: trustMismatchClient,
      context: { ...context, operation: 'memory.read' },
      memoryId: row.memory_id,
      allowPrivateRead: true,
      env
    }),
    error => error.code === 'HFM_MEMORY_STORED_RECORD_METADATA_MISMATCH'
  );
  console.log('HFM_REPOSITORY_STORED_TRUST_METADATA_MUST_MATCH_PAYLOAD=PASS');
});

test('standing-read exact record lookup is project, type, lifecycle, trust and integrity scoped', async () => {
  const content = 'Verified exact Knowledge record for project lookup.';
  const expected = record({
    memoryId: 'knowledge-exact-001',
    recordType: 'knowledge_item',
    content,
    version: { revision: 1, contentHash: createContentHash(content) },
    trust: { status: 'HUMAN_VERIFIED' },
    access: { classification: 'PUBLIC', allowedProjectIds: ['project-001'] }
  });
  let sqlSeen = '';
  let paramsSeen = null;
  const client = fakeClient({
    query: async (sql, params) => {
      sqlSeen = sql;
      paramsSeen = params;
      return {
        rowCount: 1,
        rows: [{
          memory_id: expected.memoryId,
          project_id: expected.projectId,
          owner_actor_id: context.actorId,
          record_type: expected.recordType,
          schema_version: expected.schemaVersion,
          classification: 'PUBLIC',
          lifecycle: 'ACTIVE',
          revision: 1,
          integrity_status: 'VERIFIED',
          trust_status: 'HUMAN_VERIFIED',
          public_payload: expected,
          encrypted_envelope: null
        }]
      };
    }
  });
  const standingContext = {
    ...context,
    operation: 'memory.read',
    resource: 'memory:project:' + context.projectId,
    authorityContext: 'HFM_ACTIVE_STANDING_READ_AUTHORITY'
  };
  assert.equal(standingContext.operation, 'memory.read');
  assert.equal(standingContext.authorityContext, 'HFM_ACTIVE_STANDING_READ_AUTHORITY');
  assert.equal(standingContext.resource, 'memory:project:' + standingContext.projectId);
  const result = await repository.getStandingReadMemoryRecord({
    client,
    context: standingContext,
    memoryId: expected.memoryId,
    recordTypes: ['knowledge_item', 'learning_note'],
    env
  });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.record.memoryId, expected.memoryId);
  assert.equal(result.record.content, content);
  assert.deepEqual(paramsSeen, ['project-001', expected.memoryId, ['knowledge_item', 'learning_note']]);
  assert.match(sqlSeen, /lifecycle = 'ACTIVE'/);
  assert.match(sqlSeen, /classification <> 'RESTRICTED'/);
  assert.match(sqlSeen, /integrity_status = 'VERIFIED'/);
  assert.match(sqlSeen, /trust_status IN \('CONTENT_VERIFIED', 'HUMAN_VERIFIED'\)/);

  const storedRow = {
    memory_id: expected.memoryId,
    project_id: expected.projectId,
    owner_actor_id: context.actorId,
    record_type: expected.recordType,
    schema_version: expected.schemaVersion,
    classification: 'PUBLIC',
    lifecycle: 'ACTIVE',
    revision: 1,
    integrity_status: 'VERIFIED',
    trust_status: 'HUMAN_VERIFIED',
    public_payload: expected,
    encrypted_envelope: null
  };
  const invalidRows = [
    { memory_id: 'different-memory-id' },
    { project_id: 'project-beta' },
    { record_type: 'social_post_draft' },
    { lifecycle: 'TRASHED' },
    { classification: 'RESTRICTED' },
    { integrity_status: 'FAILED' },
    { trust_status: 'SOURCE_RECORDED' }
  ];
  for (const invalidFields of invalidRows) {
    const invalidClient = fakeClient({
      query: async () => ({ rowCount: 1, rows: [{ ...storedRow, ...invalidFields }] })
    });
    await assert.rejects(
      repository.getStandingReadMemoryRecord({
        client: invalidClient,
        context: {
          ...context,
          operation: 'memory.read',
          resource: 'memory:project:project-001',
          authorityContext: 'HFM_ACTIVE_STANDING_READ_AUTHORITY'
        },
        memoryId: expected.memoryId,
        recordTypes: ['knowledge_item', 'learning_note'],
        env
      }),
      error => error.code === 'HFM_STANDING_READ_RECORD_SCOPE_INVALID'
    );
  }
  console.log('HFM_REPOSITORY_STANDING_READ_REVALIDATES_RETURNED_ROW=PASS');
  assert.throws(
    () => repository.getStandingReadMemoryRecord({
      client,
      context: { ...context, operation: 'memory.read', resource: 'memory:other', authorityContext: 'HFM_ACTIVE_STANDING_READ_AUTHORITY' },
      memoryId: expected.memoryId,
      recordTypes: ['knowledge_item'],
      env
    }),
    error => error.code === 'HFM_STANDING_READ_RESOURCE_SCOPE_INVALID'
  );
  assert.throws(
    () => repository.getStandingReadMemoryRecord({
      client,
      context: { ...standingContext, operation: 'memory.write' },
      memoryId: expected.memoryId,
      recordTypes: ['knowledge_item'],
      env
    }),
    error => error.code === 'HFM_MEMORY_CONSUMED_AUTHORITY_CONTEXT_REQUIRED'
  );
  assert.throws(
    () => repository.getStandingReadMemoryRecord({
      client,
      context: { ...standingContext, authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY' },
      memoryId: expected.memoryId,
      recordTypes: ['knowledge_item'],
      env
    }),
    error => error.code === 'HFM_STANDING_READ_RECORD_SCOPE_INVALID'
  );
  const unexpectedRowClient = fakeClient({
    query: async () => ({
      rowCount: 1,
      rows: [{
        memory_id: expected.memoryId,
        project_id: expected.projectId,
        owner_actor_id: context.actorId,
        record_type: expected.recordType,
        schema_version: expected.schemaVersion,
        classification: 'RESTRICTED',
        lifecycle: 'ACTIVE',
        revision: 1,
        integrity_status: 'VERIFIED',
        trust_status: 'HUMAN_VERIFIED',
        public_payload: expected,
        encrypted_envelope: null
      }]
    })
  });
  await assert.rejects(() => repository.getStandingReadMemoryRecord({
    client: unexpectedRowClient,
    context: {
      ...context,
      operation: 'memory.read',
      resource: 'memory:project:project-001',
      authorityContext: 'HFM_ACTIVE_STANDING_READ_AUTHORITY'
    },
    memoryId: expected.memoryId,
    recordTypes: ['knowledge_item'],
    env
  }), error => error.code === 'HFM_STANDING_READ_RECORD_SCOPE_INVALID');
  console.log('HFM_REPOSITORY_STANDING_READ_REJECTS_UNEXPECTED_RESTRICTED_ROW=PASS');
  console.log('HFM_REPOSITORY_STANDING_READ_EXACT_RECORD_SCOPE=PASS');
});

test('project-scoped list supports an allowlisted social-draft filter', async () => {
  const draft = record({
    recordType: 'social_post_draft',
    content: 'A user-approved Facebook-ready draft.',
    version: { revision: 1, contentHash: createContentHash('A user-approved Facebook-ready draft.') },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-001'] }
  });
  const { createVaultEnvelope } = require('../services/mira-hfm-vault-crypto');
  const envelope = createVaultEnvelope({
    record: draft,
    context: {
      recordId: draft.memoryId, ownerId: context.actorId,
      projectId: draft.projectId, recordType: draft.recordType,
      classification: 'PROJECT_PRIVATE', schemaVersion: draft.schemaVersion
    },
    env
  });
  const row = {
    memory_id: draft.memoryId, project_id: draft.projectId,
    owner_actor_id: context.actorId, record_type: draft.recordType,
    schema_version: draft.schemaVersion, classification: 'PROJECT_PRIVATE',
    lifecycle: 'ACTIVE', revision: 1, integrity_status: 'VERIFIED',
    trust_status: 'SOURCE_RECORDED', public_payload: null, encrypted_envelope: envelope
  };
  const client = fakeClient({
    query: async (sql, params) => {
      if (sql.startsWith('SELECT memory_id') && sql.includes('ORDER BY updated_at')) {
        assert.deepEqual(params, ['project-001', 'ACTIVE', ['social_post_draft'], 25, false, false]);
        return { rowCount: 1, rows: [row] };
      }
      return { rowCount: 0, rows: [] };
    }
  });
  const result = await repository.listMemoryRecords({
    client,
    context: { ...context, operation: 'memory.read', resource: 'memory:project:project-001' },
    recordType: 'social_post_draft',
    allowPrivateRead: true,
    env
  });
  assert.equal(result.count, 1);
  assert.equal(result.records[0].recordType, 'social_post_draft');
  assert.equal(result.records[0].content, draft.content);
  await assert.rejects(
    repository.listMemoryRecords({
      client,
      context: { ...context, operation: 'memory.read', resource: 'memory:project:project-001' },
      recordType: 'unknown_record_type',
      allowPrivateRead: true,
      env
    }),
    error => error.code === 'HFM_MEMORY_RECORD_TYPE_FILTER_INVALID'
  );
});

test('standing-read repository context is limited to active Learning/Knowledge and excludes restricted records', async () => {
  const standingContext = {
    ...context,
    operation: 'memory.read',
    resource: 'memory:project:project-001',
    authorityContext: 'HFM_ACTIVE_STANDING_READ_AUTHORITY'
  };
  let queryCount = 0;
  const scanStartedAt = new Date().toISOString();
  const client = {
    async query(sql, params) {
      queryCount += 1;
      if (sql.includes('SELECT transaction_timestamp() AS scan_started_at')) {
        assert.equal(params, undefined);
        return { rowCount: 1, rows: [{ scan_started_at: scanStartedAt }] };
      }
      assert.match(sql, /classification <> 'RESTRICTED'/);
      assert.match(sql, /integrity_status = 'VERIFIED'/);
      assert.match(sql, /trust_status IN \('CONTENT_VERIFIED', 'HUMAN_VERIFIED'\)/);
      assert.match(sql, /updated_at <= \$5::timestamptz/);
      assert.match(sql, /ORDER BY updated_at DESC, memory_id ASC LIMIT \$4/);
      assert.deepEqual(params, [
        'project-001', 'ACTIVE', ['learning_note', 'knowledge_item'], 26,
        scanStartedAt, null, null
      ]);
      return { rowCount: 0, rows: [] };
    }
  };

  await assert.rejects(
    repository.listMemoryRecords({
      client, context: standingContext, allowPrivateRead: true, env
    }),
    error => error.code === 'HFM_STANDING_READ_RECORD_TYPE_SCOPE_INVALID'
  );
  await assert.rejects(
    repository.listMemoryRecords({
      client, context: standingContext, recordType: 'social_post_draft',
      allowPrivateRead: true, env
    }),
    error => error.code === 'HFM_STANDING_READ_RECORD_TYPE_SCOPE_INVALID'
  );
  await assert.rejects(
    repository.listMemoryRecords({
      client, context: standingContext, recordTypes: ['learning_note'],
      lifecycle: 'TRASHED', allowPrivateRead: true, env
    }),
    error => error.code === 'HFM_STANDING_READ_LIFECYCLE_SCOPE_INVALID'
  );
  await assert.rejects(
    repository.listMemoryRecords({
      client, context: standingContext,
      recordTypes: ['learning_note', 'knowledge_item'],
      allowPrivateRead: true, allowRestrictedRead: true, env
    }),
    error => error.code === 'HFM_STANDING_READ_RESTRICTED_READ_NOT_ALLOWED'
  );
  assert.equal(queryCount, 0);

  const result = await repository.listMemoryRecords({
    client, context: standingContext,
    recordTypes: ['learning_note', 'knowledge_item'],
    lifecycle: 'ACTIVE', allowPrivateRead: true, env
  });
  assert.equal(result.count, 0);
  assert.equal(queryCount, 2);
});

test('standing-read keyset pagination is project-bound, stable and audited per page', async () => {
  const standingContext = {
    ...context,
    operation: 'memory.read',
    resource: 'memory:project:project-001',
    authorityContext: 'HFM_ACTIVE_STANDING_READ_AUTHORITY'
  };
  const scanStartedAt = '2026-11-07T10:00:00.000Z';
  const firstUpdatedAt = '2026-11-07T09:00:00.000Z';
  const secondUpdatedAt = '2026-11-07T08:00:00.000Z';
  function publicKnowledge(memoryId, updatedAt) {
    const value = record({
      memoryId,
      recordType: 'knowledge_item',
      timestamps: { createdAt: now, updatedAt },
      trust: { status: 'HUMAN_VERIFIED' },
      access: { classification: 'PUBLIC', allowedProjectIds: ['project-001'] }
    });
    return {
      memory_id: memoryId,
      project_id: 'project-001',
      owner_actor_id: context.actorId,
      record_type: 'knowledge_item',
      schema_version: '1.1.0',
      classification: 'PUBLIC',
      lifecycle: 'ACTIVE',
      revision: 1,
      integrity_status: 'VERIFIED',
      trust_status: 'HUMAN_VERIFIED',
      public_payload: value,
      encrypted_envelope: null,
      updated_at: updatedAt,
      scan_started_at: scanStartedAt
    };
  }
  const firstRow = publicKnowledge('memory-page-001', firstUpdatedAt);
  const secondRow = publicKnowledge('memory-page-002', secondUpdatedAt);
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT transaction_timestamp() AS scan_started_at')) {
        return { rowCount: 1, rows: [{ scan_started_at: scanStartedAt }] };
      }
      assert.match(sql, /updated_at <= \$5::timestamptz/);
      assert.match(sql, /updated_at < \$6::timestamptz/);
      if (params[5] === null) {
        assert.deepEqual(params, [
          'project-001', 'ACTIVE', ['learning_note', 'knowledge_item'],
          2, scanStartedAt, null, null
        ]);
        return { rowCount: 2, rows: [firstRow, secondRow] };
      }
      assert.deepEqual(params, [
        'project-001', 'ACTIVE', ['learning_note', 'knowledge_item'],
        2, scanStartedAt, firstUpdatedAt, 'memory-page-001'
      ]);
      return { rowCount: 1, rows: [secondRow] };
    }
  };
  const firstPage = await repository.listMemoryRecords({
    client, context: standingContext, recordTypes: ['learning_note', 'knowledge_item'],
    lifecycle: 'ACTIVE', limit: 1, allowPrivateRead: true, env
  });
  assert.equal(firstPage.count, 1);
  assert.equal(firstPage.records[0].memoryId, 'memory-page-001');
  assert.ok(firstPage.nextCursor);
  const cursorPayload = JSON.parse(Buffer.from(firstPage.nextCursor, 'base64url').toString('utf8'));
  assert.equal(cursorPayload.projectId, 'project-001');
  assert.equal(cursorPayload.scanStartedAt, scanStartedAt);
  assert.equal(cursorPayload.updatedAt, firstUpdatedAt);
  assert.equal(cursorPayload.memoryId, 'memory-page-001');

  const secondPage = await repository.listMemoryRecords({
    client, context: standingContext, recordTypes: ['learning_note', 'knowledge_item'],
    lifecycle: 'ACTIVE', limit: 1, cursor: firstPage.nextCursor,
    allowPrivateRead: true, env
  });
  assert.equal(secondPage.count, 1);
  assert.equal(secondPage.records[0].memoryId, 'memory-page-002');
  assert.equal(secondPage.nextCursor, null);
  assert.equal(calls.length, 3, 'each page executes in its own authorized read transaction');
  await assert.rejects(
    repository.listMemoryRecords({
      client,
      context: { ...standingContext, projectId: 'other-project', resource: 'memory:project:other-project' },
      recordTypes: ['learning_note', 'knowledge_item'],
      lifecycle: 'ACTIVE', limit: 1, cursor: firstPage.nextCursor,
      allowPrivateRead: true, env
    }),
    error => error.code === 'HFM_MEMORY_PAGE_CURSOR_INVALID'
  );
});

test('trash requires explicit private lifecycle grant and writes a recoverable revision', async () => {
  const privateRecord = record();
  const { createVaultEnvelope } = require('../services/mira-hfm-vault-crypto');
  const envelope = createVaultEnvelope({
    record: privateRecord,
    context: {
      recordId: privateRecord.memoryId, ownerId: context.actorId,
      projectId: privateRecord.projectId, recordType: privateRecord.recordType,
      classification: 'PROJECT_PRIVATE', schemaVersion: privateRecord.schemaVersion
    }, env
  });
  const row = {
    memory_id: privateRecord.memoryId, project_id: privateRecord.projectId,
    owner_actor_id: context.actorId, record_type: privateRecord.recordType,
    schema_version: privateRecord.schemaVersion, classification: 'PROJECT_PRIVATE',
    lifecycle: 'ACTIVE', revision: 1, integrity_status: 'VERIFIED',
    trust_status: 'SOURCE_RECORDED', public_payload: null, encrypted_envelope: envelope,
    created_at: now, updated_at: now
  };
  const client = fakeClient({
    query: async (sql, params) => {
      if (sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('SELECT memory_id') && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [row] };
      if (sql.startsWith('SELECT event_hash')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{}] };
    }
  });
  const trashContext = { ...context, operation: 'memory.trash' };
  await assert.rejects(
    repository.trashMemoryRecord({
      client, context: trashContext, memoryId: row.memory_id,
      idempotencyKey: 'trash-wrong-type', expectedRecordType: 'social_post_draft',
      allowPrivateLifecycle: true, env
    }),
    error => error.code === 'HFM_MEMORY_RECORD_TYPE_NOT_ALLOWED'
  );
  await assert.rejects(
    repository.trashMemoryRecord({ client, context: trashContext, memoryId: row.memory_id, idempotencyKey: 'trash-1', env }),
    error => error.code === 'HFM_MEMORY_PRIVATE_LIFECYCLE_NOT_GRANTED'
  );
  const result = await repository.trashMemoryRecord({
    client, context: trashContext, memoryId: row.memory_id, idempotencyKey: 'trash-2',
    allowPrivateLifecycle: true, env
  });
  assert.equal(result.status, 'TRASHED');
  const update = client.calls.find(call => call.sql.startsWith('UPDATE mira_hfm.memory_records'));
  assert.ok(update);
  assert.equal(update.params[2], 'TRASHED');
  assert.equal(update.params[3] !== null, true);
  assert.equal(update.params[4], context.actorId);
  const versionInsert = client.calls.find(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_record_versions'));
  assert.ok(versionInsert);
  assert.equal(versionInsert.params[12] !== null, true);
  assert.equal(versionInsert.params[13], context.actorId);
});

test('restore clears trash metadata and preserves a new immutable revision', async () => {
  const trashed = record({
    recordType: 'knowledge_item',
    content: 'A public post draft retained in Trash.',
    version: { revision: 2, contentHash: createContentHash('A public post draft retained in Trash.') },
    access: { classification: 'PUBLIC', allowedProjectIds: ['project-001'] },
    lifecycle: 'TRASHED'
  });
  const row = {
    memory_id: trashed.memoryId, project_id: trashed.projectId,
    owner_actor_id: context.actorId, record_type: trashed.recordType,
    schema_version: trashed.schemaVersion, classification: 'PUBLIC',
    lifecycle: 'TRASHED', revision: 2, integrity_status: 'VERIFIED',
    trust_status: 'SOURCE_RECORDED', public_payload: trashed, encrypted_envelope: null,
    created_at: new Date(trashed.timestamps.createdAt),
    updated_at: new Date(trashed.timestamps.updatedAt)
  };
  const client = fakeClient({
    query: async sql => {
      if (sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('SELECT memory_id') && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [row] };
      if (sql.startsWith('SELECT event_hash')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{}] };
    }
  });
  const result = await repository.restoreMemoryRecord({
    client,
    context: { ...context, operation: 'memory.restore' },
    memoryId: trashed.memoryId,
    idempotencyKey: 'restore-public-1',
    env
  });
  assert.equal(result.status, 'RESTORED');
  assert.equal(result.revision, 3);
  const update = client.calls.find(call => call.sql.startsWith('UPDATE mira_hfm.memory_records'));
  assert.ok(update);
  assert.equal(update.params[2], 'ACTIVE');
  assert.equal(update.params[3], null);
  assert.equal(update.params[4], null);
  const version = client.calls.find(call => call.sql.startsWith('INSERT INTO mira_hfm.memory_record_versions'));
  assert.equal(version.params[12], null);
  assert.equal(version.params[13], null);
});

console.log('HFM_MEMORY_REPOSITORY_UNIT_TESTS=PASS');
