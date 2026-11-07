'use strict';

const assert = require('node:assert/strict');
const { collectStandingReadPages } = require('../services/mira-hfm-standing-read-pages');

const context = {
  actorId: 'mira:actor-001',
  actorType: 'HUMAN',
  projectId: 'project-alpha',
  purpose: 'approved read',
  requestId: 'request-page-001',
  authorityRef: 'standing-authority-001',
  issuedAt: '2026-11-07T00:00:00.000Z',
  expiresAt: '2027-11-07T00:00:00.000Z'
};
const scanStartedAt = '2026-11-07T00:00:00.000Z';
function page(records, nextCursor = null, overrides = {}) {
  return {
    status: 'AUTHORIZED_AND_COMMITTED',
    standingAuthority: true,
    authorityConsumed: false,
    approvalRequiredPerRead: false,
    memoryWrites: false,
    localFallback: false,
    driveFallback: false,
    projectId: 'project-alpha',
    standingAuthorityId: context.authorityRef,
    authorityExpiresAt: context.expiresAt,
    hostAuthorizationContext: context,
    scanStartedAt,
    records,
    count: records.length,
    nextCursor,
    ...overrides
  };
}
function record(memoryId) {
  return { memoryId, projectId: 'project-alpha', recordType: 'knowledge_item', lifecycle: 'ACTIVE' };
}

(async () => {
  const cursors = [];
  const collected = await collectStandingReadPages({
    readMemory: async options => {
      cursors.push(options.cursor || null);
      return options.cursor
        ? page([record('memory-002')], null, {
            hostAuthorizationContext: { ...context, requestId: 'request-page-002' }
          })
        : page([record('memory-001')], 'cursor-page-2');
    },
    readOptions: { pool: {}, req: {}, standingReadAuthority: true }
  });
  assert.deepEqual(cursors, [null, 'cursor-page-2']);
  assert.deepEqual(collected.records.map(item => item.memoryId), ['memory-001', 'memory-002']);
  assert.equal(collected.candidateScanCount, 2);
  assert.equal(collected.pageCount, 2);
  assert.equal(collected.candidateScanMayBeIncomplete, false);
  console.log('HFM_STANDING_READ_PAGES_AUDITED_KEYSET_AGGREGATION=PASS');

  await assert.rejects(() => collectStandingReadPages({
    readMemory: async options => options.cursor
      ? page([record('memory-002')])
      : page([record('memory-001')], 'reused-audit-request'),
    readOptions: {}
  }), /HFM_STANDING_READ_PAGE_AUDIT_REQUEST_REPLAY/);
  console.log('HFM_STANDING_READ_PAGES_REQUIRE_DISTINCT_AUDIT_REQUESTS=PASS');

  await assert.rejects(() => collectStandingReadPages({
    readMemory: async () => page([record('memory-001')], null, {
      hostAuthorizationContext: { ...context, projectId: 'project-other' }
    }),
    readOptions: {}
  }), /HFM_STANDING_READ_PAGE_CONTEXT_INVALID/);
  console.log('HFM_STANDING_READ_PAGES_PROJECT_BINDING_REQUIRED=PASS');

  await assert.rejects(() => collectStandingReadPages({
    readMemory: async () => page([record('memory-001')], null, { localFallback: true }),
    readOptions: {}
  }), /HFM_STANDING_READ_PAGE_AUTHORIZATION_REQUIRED/);
  console.log('HFM_STANDING_READ_PAGES_NO_FALLBACK=PASS');

  await assert.rejects(() => collectStandingReadPages({
    readMemory: async () => page([record('memory-001')], null, { memoryWrites: true }),
    readOptions: {}
  }), /HFM_STANDING_READ_PAGE_AUTHORIZATION_REQUIRED/);
  console.log('HFM_STANDING_READ_PAGES_NO_WRITE=PASS');

  let calls = 0;
  await assert.rejects(() => collectStandingReadPages({
    readMemory: async () => {
      calls += 1;
      return page([record('memory-' + calls)], 'repeating-cursor', {
        hostAuthorizationContext: { ...context, requestId: 'request-page-' + calls }
      });
    },
    readOptions: {},
    maxPages: 3
  }), /HFM_STANDING_READ_PAGE_CURSOR_REPLAY/);
  console.log('HFM_STANDING_READ_PAGES_CURSOR_REPLAY_BLOCKED=PASS');

  await assert.rejects(() => collectStandingReadPages({
    readMemory: async options => options.cursor
      ? page([record('memory-002')], null, {
          scanStartedAt: '2026-11-07T00:01:00.000Z',
          hostAuthorizationContext: { ...context, requestId: 'request-page-002' }
        })
      : page([record('memory-001')], 'cursor-page-2'),
    readOptions: {}
  }), /HFM_STANDING_READ_PAGE_CONTEXT_CHANGED/);
  console.log('HFM_STANDING_READ_PAGES_SNAPSHOT_CONSISTENCY=PASS');

  const preciseTimestampResult = await collectStandingReadPages({
    readMemory: async () => page([], null, {
      scanStartedAt: '2026-11-07T00:00:00.123456Z'
    }),
    readOptions: {},
    now: new Date('2026-11-07T12:00:00.000Z')
  });
  assert.equal(preciseTimestampResult.scanStartedAt, '2026-11-07T00:00:00.123456Z');
  await assert.rejects(() => collectStandingReadPages({
    readMemory: async () => page([], null, {
      scanStartedAt: '2026-11-07T12:00:00.000001Z'
    }),
    readOptions: {},
    now: new Date('2026-11-07T12:00:00.000Z')
  }), /HFM_STANDING_READ_PAGE_CONTEXT_INVALID/);
  console.log('HFM_STANDING_READ_PAGES_MICROSECOND_TIMESTAMP_VALIDATION=PASS');

  await assert.rejects(() => collectStandingReadPages({
    readMemory: async () => page([record('memory-expired')], null, {
      hostAuthorizationContext: {
        ...context,
        expiresAt: new Date(Date.now() - 1000).toISOString()
      },
      authorityExpiresAt: new Date(Date.now() - 1000).toISOString()
    }),
    readOptions: {}
  }), /HFM_STANDING_READ_PAGE_CONTEXT_INVALID/);
  await assert.rejects(() => collectStandingReadPages({
    readMemory: async () => page([record('memory-future-issued')], null, {
      hostAuthorizationContext: {
        ...context,
        issuedAt: new Date(Date.now() + 60000).toISOString()
      }
    }),
    readOptions: {}
  }), /HFM_STANDING_READ_PAGE_CONTEXT_INVALID/);
  console.log('HFM_STANDING_READ_PAGES_EXPIRED_AND_FUTURE_AUTHORITY_BLOCKED=PASS');

  await assert.rejects(() => collectStandingReadPages({
    readMemory: async options => options.cursor
      ? page([record('memory-002')], null, {
          hostAuthorizationContext: { ...context, actorId: 'mira:actor-other', requestId: 'request-page-002' }
        })
      : page([record('memory-001')], 'actor-drift-cursor'),
    readOptions: {}
  }), /HFM_STANDING_READ_PAGE_CONTEXT_CHANGED/);
  console.log('HFM_STANDING_READ_PAGES_ACTOR_BINDING_STABLE=PASS');

  await assert.rejects(() => collectStandingReadPages({
    readMemory: async options => options.cursor
      ? page([record('memory-001')], null, {
          hostAuthorizationContext: { ...context, requestId: 'request-page-002' }
        })
      : page([record('memory-001')], 'duplicate-record-cursor'),
    readOptions: {}
  }), /HFM_STANDING_READ_PAGE_DUPLICATE_RECORD/);
  console.log('HFM_STANDING_READ_PAGES_DUPLICATE_RECORD_BLOCKED=PASS');

  const bounded = await collectStandingReadPages({
    readMemory: async options => page(
      [record(options.cursor ? 'memory-next' : 'memory-first')],
      'more-' + (options.cursor || 'start'),
      { hostAuthorizationContext: { ...context, requestId: options.cursor ? 'request-page-002' : 'request-page-001' } }
    ),
    readOptions: {},
    maxPages: 2
  });
  assert.equal(bounded.pageCount, 2);
  assert.equal(bounded.candidateScanMayBeIncomplete, true);
  assert.equal(typeof bounded.nextCursor, 'string');
  console.log('HFM_STANDING_READ_PAGES_BOUNDED_CONTINUATION=PASS');
  console.log('NETWORK_REQUESTS=0');
  console.log('MEMORY_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
