'use strict';

const assert = require('node:assert/strict');
const { executeHfmKnowledgeReviewQueue } = require('../tools');

(async () => {
  const req = { session: { authenticated: true, role: 'admin' } };
  const pool = { connect: async () => ({}) };
  const issuerRuntime = { status: 'AUTHORITY_ISSUER_READY', pool: { connect: async () => ({}) } };
  let captured = null;
  const context = {
    hfmReadOnly: {
      req, pool,
      env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
      userIntent: 'Show pending knowledge sources for review.',
      getAuthorityIssuerRuntime: async () => issuerRuntime
    }
  };
  const result = JSON.parse(await executeHfmKnowledgeReviewQueue(
    { limit: 7 }, context,
    async input => {
      captured = input;
      return {
        success: true, status: 'REVIEW_REQUIRED', projectId: 'project-1',
        count: 0, items: [], standingAuthority: false, authorityConsumed: true,
        approvalRequiredPerRead: true, writeAllowed: false,
        localFallback: false, driveFallback: false
      };
    }
  ));
  assert.equal(captured.req, req);
  assert.equal(captured.pool, pool);
  assert.equal(captured.issuerPool, issuerRuntime.pool);
  assert.equal(captured.userIntent, context.hfmReadOnly.userIntent);
  assert.equal(captured.limit, 7);
  assert.equal(result.source, 'HFM_V02_PENDING_REVIEW');
  assert.equal(result.writeAllowed, false);
  assert.match(result.message, /unverified/i);

  await assert.rejects(
    () => executeHfmKnowledgeReviewQueue({}, null, async () => ({})),
    /Server-held HFM reader/
  );
  await assert.rejects(
    () => executeHfmKnowledgeReviewQueue({}, {
      hfmReadOnly: {
        req, pool, userIntent: 'Show pending knowledge sources for review.',
        getAuthorityIssuerRuntime: async () => ({ status: 'FAILED', pool: null })
      }
    }, async () => ({})),
    /authority issuer is not ready/
  );
  await assert.rejects(
    () => executeHfmKnowledgeReviewQueue({}, context, async () => ({
      status: 'AUTHORIZED_AND_COMMITTED', standingAuthority: true,
      authorityConsumed: false, writeAllowed: false,
      localFallback: false, driveFallback: false, items: []
    })),
    /one-time read/
  );
  console.log('HFM_KNOWLEDGE_REVIEW_TOOL_TESTS=PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
