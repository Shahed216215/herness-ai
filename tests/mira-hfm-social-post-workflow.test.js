'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const workflow = require('../services/mira-hfm-social-post-workflow');

const baseContext = {
  authorityContext: workflow.AUTHORITY_CONTEXT,
  actorId: 'mira:creator-001',
  projectOwnerActorId: 'mira:project-owner-001',
  projectId: 'project-001',
  operation: workflow.OPERATIONS.DELETE,
  resource: 'memory:post-0001',
  requestId: 'request-001'
};

const draft = {
  memory_id: 'post-0001',
  project_id: 'project-001',
  owner_actor_id: 'mira:creator-001',
  record_type: 'social_post_draft',
  classification: 'PROJECT_PRIVATE',
  lifecycle: 'ACTIVE',
  payload_erased_at: null
};

test('requires consumed one-time authority, exact project resource and actor', () => {
  assert.equal(workflow.validateWorkflowContext(baseContext, workflow.OPERATIONS.DELETE, 'post-0001'), baseContext);
  assert.throws(() => workflow.validateWorkflowContext({ ...baseContext, authorityContext: 'untrusted' }, workflow.OPERATIONS.DELETE, 'post-0001'), /HFM_SOCIAL_POST_AUTHORITY_INVALID/);
  assert.throws(() => workflow.validateWorkflowContext({ ...baseContext, projectId: '' }, workflow.OPERATIONS.DELETE, 'post-0001'), /HFM_SOCIAL_POST_AUTHORITY_INVALID/);
  assert.throws(() => workflow.validateWorkflowContext({ ...baseContext, resource: 'memory:other' }, workflow.OPERATIONS.DELETE, 'post-0001'), /HFM_SOCIAL_POST_AUTHORITY_INVALID/);
  assert.throws(() => workflow.validateWorkflowContext({ ...baseContext, operation: workflow.OPERATIONS.COPY }, workflow.OPERATIONS.DELETE, 'post-0001'), /HFM_SOCIAL_POST_AUTHORITY_INVALID/);
});

test('only the exact project-owned PROJECT_PRIVATE social draft is eligible', () => {
  assert.equal(workflow.assertSocialPostRecord(draft, baseContext), draft);
  assert.throws(() => workflow.assertSocialPostRecord(null, baseContext), /HFM_SOCIAL_POST_NOT_FOUND/);
  assert.throws(() => workflow.assertSocialPostRecord({ ...draft, project_id: 'other' }, baseContext), /HFM_SOCIAL_POST_PROJECT_SCOPE_MISMATCH/);
  assert.throws(() => workflow.assertSocialPostRecord({ ...draft, owner_actor_id: 'mira:other' }, baseContext), /HFM_SOCIAL_POST_OWNER_MISMATCH/);
  assert.throws(() => workflow.assertSocialPostRecord({ ...draft, record_type: 'knowledge_item' }, baseContext), /HFM_SOCIAL_POST_TYPE_INVALID/);
  assert.throws(() => workflow.assertSocialPostRecord({ ...draft, classification: 'RESTRICTED' }, baseContext), /HFM_SOCIAL_POST_CLASSIFICATION_INVALID/);
  assert.throws(() => workflow.assertSocialPostRecord({ ...draft, payload_erased_at: '2026-11-07T00:00:00Z' }, baseContext), /HFM_SOCIAL_POST_PAYLOAD_ALREADY_ERASED/);
});

test('manual Copy and Publish statuses cannot be conflated or auto-asserted', () => {
  assert.equal(workflow.nextSocialPostStatus('SAVED', 'COPY'), 'COPIED');
  assert.equal(workflow.nextSocialPostStatus('COPIED', 'COPY'), 'COPIED');
  assert.equal(workflow.nextSocialPostStatus('COPIED', 'PUBLISH'), 'USER_CONFIRMED_PUBLISHED');
  assert.equal(workflow.nextSocialPostStatus('USER_CONFIRMED_PUBLISHED', 'COPY'), 'USER_CONFIRMED_PUBLISHED');
  assert.throws(() => workflow.nextSocialPostStatus('SAVED', 'PUBLISH'), /HFM_SOCIAL_POST_STATUS_TRANSITION_INVALID/);
});

test('Delete is available only from allowed draft states and never from restricted state', () => {
  for (const state of ['SAVED', 'COPIED', 'USER_CONFIRMED_PUBLISHED', 'DELETE_FAILED', 'DELETE_STATUS_UNKNOWN']) {
    assert.equal(workflow.nextSocialPostStatus(state, 'DELETE'), 'DELETE_PENDING');
  }
  assert.throws(() => workflow.nextSocialPostStatus('DELETED', 'DELETE'), /HFM_SOCIAL_POST_STATUS_TRANSITION_INVALID/);
});

test('missing provenance is represented with explicit non-verified metadata defaults', () => {
  assert.deepEqual(workflow.sanitizedProvenanceMetadata({}, {
    capturedAt: '2026-11-07T00:01:00Z'
  }), {
    collectionMethod: 'unknown',
    capturedAt: '2026-11-07T00:01:00.000Z',
    verificationStatus: 'UNKNOWN',
    originalPublishedAt: null,
    redactionApplied: false
  });
});

test('retained source and provenance metadata is allowlisted and excludes payload and credentials', () => {
  assert.deepEqual(workflow.sanitizedSourceMetadata({
    sourceType: 'facebook_page',
    sourceId: 'page-123',
    sourceUrl: 'https://facebook.com/private-group',
    observedAt: '2026-11-07T00:00:00Z',
    content: 'private post body',
    accessToken: 'secret'
  }), {
    sourceType: 'facebook_page',
    sourceId: 'page-123',
    observedAt: '2026-11-07T00:00:00.000Z'
  });
  assert.equal(workflow.sanitizedSourceMetadata({
    sourceType: 'facebook_page',
    sourceId: 'EAABabcdefghijklmnopqrstuvwxyz0123456789',
    observedAt: '2026-11-07T00:00:00Z'
  }).sourceId, 'REDACTED');
  assert.equal(workflow.sanitizedSourceMetadata({
    sourceType: 'facebook_page',
    sourceId: 'https://facebook.com/private',
    observedAt: '2026-11-07T00:00:00Z'
  }).sourceId, 'REDACTED');
  assert.deepEqual(workflow.sanitizedProvenanceMetadata({
    collectionMethod: 'web_search',
    capturedAt: '2026-11-07T00:01:00Z',
    verificationStatus: 'HUMAN_VERIFIED',
    originalPublishedAt: '2026-11-06T00:00:00Z',
    redactionApplied: true,
    content: 'private post body',
    accessToken: 'secret'
  }), {
    collectionMethod: 'web_search',
    capturedAt: '2026-11-07T00:01:00.000Z',
    verificationStatus: 'HUMAN_VERIFIED',
    originalPublishedAt: '2026-11-06T00:00:00.000Z',
    redactionApplied: true
  });
});

test('workflow exposes only the explicit user-controlled operations', () => {
  assert.deepEqual(Object.values(workflow.OPERATIONS).sort(), [
    'memory.social_post.confirm_published',
    'memory.social_post.copy',
    'memory.social_post.delete_payload'
  ].sort());
  assert.equal('publishToFacebook' in workflow, false);
});

test('archive returns sanitized metadata for erased drafts without decrypting payload', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM mira_hfm.memory_records')) return {
        rows: [{
          memory_id: 'post-0001', project_id: 'project-001',
          owner_actor_id: 'mira:creator-001', record_type: 'social_post_draft',
          schema_version: '1.1.0', classification: 'PROJECT_PRIVATE',
          lifecycle: 'ACTIVE', revision: '2', integrity_status: 'VERIFIED',
          trust_status: 'SOURCE_RECORDED', public_payload: null,
          encrypted_envelope: null, created_at: '2026-11-07T00:00:00Z',
          updated_at: '2026-11-07T00:01:00Z',
          payload_erased_at: '2026-11-07T00:02:00Z'
        }]
      };
      if (sql.includes('FROM mira_hfm.memory_social_post_state')) return {
        rows: [{ status: 'DELETED', copied_at: null, published_confirmed_at: null,
          payload_erased_at: '2026-11-07T00:02:00Z', updated_at: '2026-11-07T00:02:00Z',
          source_metadata: { sourceType: 'facebook_page', sourceId: 'Synthetic page', observedAt: '2026-11-07T00:00:00Z' },
          provenance_metadata: { collectionMethod: 'manual_copy', verificationStatus: 'SOURCE_RECORDED', originalPublishedAt: null, redactionApplied: false } }]
      };
      throw new Error('unexpected SQL');
    }
  };
  const context = {
    authorityContext: workflow.AUTHORITY_CONTEXT,
    actorId: 'mira:creator-001',
    projectOwnerActorId: 'mira:project-owner-001',
    projectId: 'project-001',
    operation: 'memory.read',
    resource: 'memory:project:project-001',
    requestId: 'request-list-001'
  };
  const result = await workflow.listSocialPostDrafts({ client, context });
  assert.equal(result.count, 1);
  assert.equal(result.drafts[0].status, 'DELETED');
  assert.equal(result.drafts[0].payloadErased, true);
  assert.equal(result.drafts[0].content, null);
  assert.deepEqual(result.drafts[0].source, {
    sourceType: 'facebook_page', sourceId: 'Synthetic page', observedAt: '2026-11-07T00:00:00Z'
  });
  assert.equal(result.drafts[0].provenance.collectionMethod, 'manual_copy');
  assert.equal(result.drafts[0].provenance.verificationStatus, 'SOURCE_RECORDED');
  assert.match(calls[0].sql, /project_id = \$1 AND owner_actor_id = \$2 AND record_type = 'social_post_draft'/);
  assert.match(calls[0].sql, /owner_actor_id = \$2/);
  assert.deepEqual(calls[0].params, ['project-001', 'mira:creator-001', 25]);
});

test('archive rejects wrong project scope and does not return restricted records', async () => {
  const context = {
    authorityContext: workflow.AUTHORITY_CONTEXT,
    actorId: 'mira:creator-001',
    projectOwnerActorId: 'mira:project-owner-001',
    projectId: 'project-001',
    operation: 'memory.read',
    resource: 'memory:project:other-project',
    requestId: 'request-list-002'
  };
  await assert.rejects(
    workflow.listSocialPostDrafts({ client: { query: async () => ({ rows: [] }) }, context }),
    /HFM_SOCIAL_POST_AUTHORITY_INVALID/
  );
});

test('delete transaction is exact-record scoped and writes sanitized audit only', async () => {
  const calls = [];
  const row = { ...draft, payload_erased_at: null };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT memory_id, project_id, owner_actor_id')) return { rows: [row] };
      if (sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry')) return { rowCount: 1, rows: [{ operation_id: 'op-001' }] };
      if (sql.startsWith('SELECT status, copied_at')) return { rows: [] };
      if (sql.startsWith("SELECT set_config('mira.memory_payload_erasure_operation_id'")) return { rows: [{ set_config: 'op-001' }] };
      if (sql.startsWith('INSERT INTO mira_hfm.memory_social_post_state')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE mira_hfm.memory_record_versions')) return { rowCount: 2, rows: [{ revision: 1 }, { revision: 2 }] };
      if (sql.startsWith('UPDATE mira_hfm.memory_records')) return { rowCount: 1, rows: [{ memory_id: 'post-0001' }] };
      if (sql.startsWith('SELECT event_hash FROM mira_hfm.memory_audit_events')) return { rows: [] };
      if (sql.startsWith('INSERT INTO mira_hfm.memory_audit_events')) return { rowCount: 1, rows: [] };
      if (sql.startsWith("UPDATE mira_hfm.memory_operation_registry SET status = 'COMPLETED'")) return { rowCount: 1, rows: [{ operation_id: 'op-001' }] };
      throw new Error('unexpected SQL: ' + sql);
    }
  };
  const context = { ...baseContext, operation: workflow.OPERATIONS.DELETE };
  const result = await workflow.deleteSocialPostPayload({
    client, context, memoryId: 'post-0001',
    idempotencyKey: 'delete-post-0001',
    userConfirmedDelete: true,
    decodeStoredRow: () => ({
      source: { sourceType: 'facebook_page', sourceId: 'synthetic-page-01', observedAt: '2026-11-07T00:00:00Z' },
      provenance: { collectionMethod: 'manual_copy', verificationStatus: 'SOURCE_RECORDED', originalPublishedAt: null, redactionApplied: true }
    })
  });
  assert.equal(result.status, 'DELETED');
  assert.equal(result.versionsErased, 2);
  const versionUpdate = calls.find(x => x.sql.startsWith('UPDATE mira_hfm.memory_record_versions'));
  assert.deepEqual(versionUpdate.params, ['project-001', 'post-0001', 'mira:creator-001']);
  const currentUpdate = calls.find(x => x.sql.startsWith('UPDATE mira_hfm.memory_records'));
  assert.deepEqual(currentUpdate.params, ['project-001', 'post-0001', 'mira:creator-001']);
  assert.equal(calls.some(x => /DELETE FROM|TRUNCATE/i.test(x.sql)), false);
  const auditInsert = calls.find(x => x.sql.startsWith('INSERT INTO mira_hfm.memory_audit_events'));
  const auditDetails = JSON.parse(auditInsert.params[11]);
  assert.equal(auditDetails.versionsErased, 2);
  assert.equal(auditDetails.payloadErased, true);
  assert.equal(JSON.stringify(auditDetails).includes('private post body'), false);
  const stateWrite = calls.find(x => x.sql.startsWith('INSERT INTO mira_hfm.memory_social_post_state'));
  assert.equal(JSON.parse(stateWrite.params[7]).sourceId, 'synthetic-page-01');
  assert.equal(JSON.parse(stateWrite.params[8]).collectionMethod, 'manual_copy');
  assert.equal(JSON.stringify(stateWrite.params).includes('private post body'), false);
});

test('delete fails closed before any payload write for restricted or unconfirmed records', async () => {
  let writes = 0;
  const client = {
    async query(sql) {
      if (sql.startsWith('SELECT memory_id, project_id, owner_actor_id')) {
        return { rows: [{ ...draft, classification: 'RESTRICTED' }] };
      }
      if (/^UPDATE |^INSERT |^DELETE |^TRUNCATE /i.test(sql)) writes += 1;
      throw new Error('unexpected SQL');
    }
  };
  await assert.rejects(
    workflow.deleteSocialPostPayload({
      client, context: { ...baseContext, operation: workflow.OPERATIONS.DELETE },
      memoryId: 'post-0001', idempotencyKey: 'delete-restricted',
      userConfirmedDelete: true
    }),
    /HFM_SOCIAL_POST_CLASSIFICATION_INVALID/
  );
  assert.equal(writes, 0);
  await assert.rejects(
    workflow.deleteSocialPostPayload({
      client, context: { ...baseContext, operation: workflow.OPERATIONS.DELETE },
      memoryId: 'post-0001', idempotencyKey: 'delete-no-confirm',
      userConfirmedDelete: false
    }),
    /HFM_SOCIAL_POST_DELETE_CONFIRMATION_REQUIRED/
  );
  assert.equal(writes, 0);
});

test('delete retry confirms erased payload and DELETED state before returning DELETED', async () => {
  const context = { ...baseContext, operation: workflow.OPERATIONS.DELETE };
  const payloadDigest = crypto.createHash('sha256')
    .update(JSON.stringify({
      operation: workflow.OPERATIONS.DELETE,
      projectId: 'project-001',
      resource: 'memory:post-0001'
    }), 'utf8').digest('hex');
  const client = {
    async query(sql) {
      if (sql.startsWith('SELECT memory_id, project_id, owner_actor_id')) {
        return { rows: [{ ...draft, payload_erased_at: '2026-11-07T00:02:00Z' }] };
      }
      if (sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry')) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM mira_hfm.memory_operation_registry')) return {
        rows: [{
          operation_id: 'op-001', actor_id: context.actorId,
          operation: workflow.OPERATIONS.DELETE, resource: 'memory:post-0001',
          purpose: workflow.OPERATIONS.DELETE, payload_digest: payloadDigest,
          status: 'COMPLETED', result_code: 'post-0001'
        }]
      };
      if (sql.startsWith('SELECT status, copied_at')) return {
        rows: [{ status: 'DELETED', payload_erased_at: '2026-11-07T00:02:00Z' }]
      };
      throw new Error('unexpected SQL: ' + sql);
    }
  };
  const result = await workflow.deleteSocialPostPayload({
    client, context, memoryId: 'post-0001',
    idempotencyKey: 'delete-post-0001', userConfirmedDelete: true
  });
  assert.equal(result.status, 'DELETED');
  assert.equal(result.duplicate, true);
});

function createStatusFlowClient(initialStatus = null) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT memory_id, project_id, owner_actor_id')) return { rows: [{ ...draft, payload_erased_at: null }] };
      if (sql.startsWith('INSERT INTO mira_hfm.memory_operation_registry')) return { rowCount: 1, rows: [{ operation_id: 'op-status-001' }] };
      if (sql.startsWith('SELECT status, copied_at')) return { rows: initialStatus ? [{ status: initialStatus }] : [] };
      if (sql.startsWith('INSERT INTO mira_hfm.memory_social_post_state')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('SELECT event_hash FROM mira_hfm.memory_audit_events')) return { rows: [] };
      if (sql.startsWith('INSERT INTO mira_hfm.memory_audit_events')) return { rowCount: 1, rows: [] };
      if (sql.startsWith("UPDATE mira_hfm.memory_operation_registry SET status = 'COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error('unexpected SQL: ' + sql);
    }
  };
}

test('Copy status records only metadata after successful client-side clipboard copy', async () => {
  const client = createStatusFlowClient();
  const result = await workflow.markSocialPostCopied({
    client,
    context: { ...baseContext, operation: workflow.OPERATIONS.COPY },
    memoryId: 'post-0001',
    idempotencyKey: 'copy-post-0001'
  });
  assert.equal(result.status, 'COPIED');
  const stateWrite = client.calls.find(x => x.sql.startsWith('INSERT INTO mira_hfm.memory_social_post_state'));
  assert.equal(stateWrite.params[3], 'COPIED');
  assert.equal(client.calls.some(x => /facebook|graph\.facebook/i.test(x.sql)), false);
  assert.equal(client.calls.some(x => x.params.some(p => typeof p === 'string' && p.includes('private post body'))), false);
});

test('Published status requires explicit user confirmation and is not Facebook-verified', async () => {
  const client = createStatusFlowClient('COPIED');
  await assert.rejects(
    workflow.confirmSocialPostPublished({
      client, context: { ...baseContext, operation: workflow.OPERATIONS.PUBLISH },
      memoryId: 'post-0001', idempotencyKey: 'publish-post-no-confirm',
      userConfirmedPublished: false
    }),
    /HFM_SOCIAL_POST_USER_CONFIRMATION_REQUIRED/
  );
  assert.equal(client.calls.some(x => /^INSERT |^UPDATE /i.test(x.sql)), false);
  const result = await workflow.confirmSocialPostPublished({
    client, context: { ...baseContext, operation: workflow.OPERATIONS.PUBLISH },
    memoryId: 'post-0001', idempotencyKey: 'publish-post-0001',
    userConfirmedPublished: true
  });
  assert.equal(result.status, 'USER_CONFIRMED_PUBLISHED');
  assert.equal(result.confirmationSource, 'USER_ACTION_NOT_FACEBOOK_VERIFIED');
  const stateWrite = client.calls.find(x => x.sql.startsWith('INSERT INTO mira_hfm.memory_social_post_state'));
  assert.equal(stateWrite.params[3], 'USER_CONFIRMED_PUBLISHED');
  const auditWrite = client.calls.find(x => x.sql.startsWith('INSERT INTO mira_hfm.memory_audit_events'));
  assert.match(auditWrite.params[11], /USER_ACTION_NOT_FACEBOOK_VERIFIED/);
});


test('status reads do not acquire a write lock', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT memory_id, project_id, owner_actor_id')) return { rows: [{ ...draft }] };
      if (sql.startsWith('SELECT status, copied_at')) return { rows: [{ status: 'COPIED', copied_at: null, published_confirmed_at: null }] };
      throw new Error('unexpected SQL: ' + sql);
    }
  };
  const result = await workflow.getSocialPostStatus({
    client, context: { ...baseContext, operation: 'memory.read', resource: 'memory:post-0001' },
    memoryId: 'post-0001'
  });
  assert.equal(result.status, 'COPIED');
  const recordRead = calls.find(sql => sql.startsWith('SELECT memory_id, project_id, owner_actor_id'));
  assert.doesNotMatch(recordRead, /FOR UPDATE/i);
});
