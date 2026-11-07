'use strict';

const assert = require('node:assert/strict');
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
          payload_erased_at: '2026-11-07T00:02:00Z', updated_at: '2026-11-07T00:02:00Z' }]
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
  assert.equal(result.drafts[0].source, null);
  assert.match(calls[0].sql, /project_id = \$1 AND record_type = 'social_post_draft'/);
  assert.deepEqual(calls[0].params, ['project-001', 25]);
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
