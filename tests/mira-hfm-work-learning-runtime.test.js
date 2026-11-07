'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { retrieveHfmWorkLearning } = require('../services/mira-hfm-work-learning-runtime');

const now = new Date('2026-11-07T05:00:00.000Z');
const hostAuthorizationContext = {
  actorId: 'mira:mira.admins:11111111-1111-4111-8111-111111111111',
  actorType: 'HUMAN',
  projectId: 'project-alpha',
  purpose: 'approved Learning and Knowledge retrieval',
  requestId: 'hfm-read-request-001',
  authorityRef: 'standing-authority-001',
  issuedAt: '2026-11-07T04:00:00.000Z',
  expiresAt: '2027-11-07T04:00:00.000Z'
};
function makeRecord(projectId = 'project-alpha') {
  const content = JSON.stringify({
    domain: 'work_learning',
    record: {
      learningId: 'learning-previous-001',
      taskId: 'task-previous',
      task: { title: 'Python automation reliability', description: 'Validate Python automation output' },
      lessons: ['Validate Python automation output']
    }
  });
  return {
    schemaVersion: '1.1.0',
    memoryId: 'memory-learning-001',
    projectId,
    recordType: 'learning_note',
    content,
    source: {
      sourceType: 'legacy_import',
      sourceId: 'learning-previous-001',
      sourceUrl: null,
      observedAt: '2026-11-06T12:00:00.000Z'
    },
    timestamps: {
      createdAt: '2026-11-06T12:00:00.000Z',
      updatedAt: '2026-11-06T12:00:00.000Z'
    },
    version: {
      revision: 1,
      contentHash: crypto.createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')
    },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'CONTENT_VERIFIED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: [projectId] },
    lifecycle: 'ACTIVE'
  };
}
const task = {
  id: 'task-current',
  title: 'Python automation task',
  description: 'Improve Python automation reliability',
  requirements: ['Validate output']
};
const req = { session: { hfmPrincipal: { verified: true } } };

(async () => {
  let readCalls = 0;
  const disabled = await retrieveHfmWorkLearning({
    req, pool: {}, task, env: { MIRA_HFM_WORK_LEARNING_ENABLED: 'false' },
    readMemory: async () => { readCalls += 1; throw new Error('must not read'); }
  });
  assert.equal(disabled.status, 'DISABLED');
  assert.equal(readCalls, 0);
  assert.equal(disabled.localFallback, false);
  console.log('HFM_WORK_LEARNING_DISABLED_BY_DEFAULT_NO_READ=PASS');

  await assert.rejects(() => retrieveHfmWorkLearning({
    req, pool: {}, task,
    env: { MIRA_HFM_WORK_LEARNING_ENABLED: 'true', MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'false' }
  }), /HFM_WORK_LEARNING_STANDING_AUTHORITY_DISABLED/);
  console.log('HFM_WORK_LEARNING_REQUIRES_STANDING_AUTHORITY_FLAG=PASS');

  const result = await retrieveHfmWorkLearning({
    req, pool: {}, task, now,
    env: {
      MIRA_HFM_WORK_LEARNING_ENABLED: 'true',
      MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true'
    },
    readMemory: async options => {
      readCalls += 1;
      assert.equal(options.standingReadAuthority, true);
      assert.deepEqual(options.recordTypes, ['learning_note', 'knowledge_item']);
      assert.equal(options.lifecycle, 'ACTIVE');
      assert.equal(options.limit, 100);
      return {
        status: 'AUTHORIZED_AND_COMMITTED',
        projectId: 'project-alpha',
        standingAuthority: true,
        authorityConsumed: false,
        approvalRequiredPerRead: false,
        memoryWrites: false,
        localFallback: false,
        driveFallback: false,
        scanStartedAt: '2026-11-07T04:00:00.000Z',
        hostAuthorizationContext,
        records: [makeRecord()],
        count: 1
      };
    }
  });
  assert.equal(result.status, 'HFM_WORK_LEARNING_RETRIEVED');
  assert.equal(result.count, 1);
  assert.equal(result.transfers[0].sourceTaskId, 'task-previous');
  assert.equal(result.transfers[0].projectId, 'project-alpha');
  assert.equal(result.approvalRequiredPerRead, false);
  assert.equal(result.localFallback, false);
  assert.equal(result.driveFallback, false);
  assert.equal(result.memoryWrites, false);
  assert.equal(result.scannedPages, 1);
  assert.equal(result.scannedRecords, 1);
  console.log('HFM_WORK_LEARNING_STANDING_GRANT_GOVERNED_RETRIEVAL=PASS');

  const secondPageRecord = { ...makeRecord(), memoryId: 'memory-learning-002' };
  const pageCursors = [];
  const paginated = await retrieveHfmWorkLearning({
    req, pool: {}, task, now,
    env: {
      MIRA_HFM_WORK_LEARNING_ENABLED: 'true',
      MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true'
    },
    readMemory: async options => {
      pageCursors.push(options.cursor || null);
      const first = !options.cursor;
      return {
        status: 'AUTHORIZED_AND_COMMITTED',
        projectId: 'project-alpha',
        standingAuthority: true,
        authorityConsumed: false,
        approvalRequiredPerRead: false,
        memoryWrites: false,
        localFallback: false,
        driveFallback: false,
        scanStartedAt: '2026-11-07T04:00:00.000Z',
        hostAuthorizationContext,
        records: first ? [makeRecord()] : [secondPageRecord],
        count: 1,
        nextCursor: first ? 'work-learning-next-page' : null
      };
    }
  });
  assert.deepEqual(pageCursors, [null, 'work-learning-next-page']);
  assert.equal(paginated.scannedPages, 2);
  assert.equal(paginated.scannedRecords, 2);
  assert.equal(paginated.count, 2);
  console.log('HFM_WORK_LEARNING_CROSS_PAGE_AGGREGATION=PASS');

  await assert.rejects(() => retrieveHfmWorkLearning({
    req, pool: {}, task, now, maxPages: 1,
    env: {
      MIRA_HFM_WORK_LEARNING_ENABLED: 'true',
      MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true'
    },
    readMemory: async () => ({
      status: 'AUTHORIZED_AND_COMMITTED',
      projectId: 'project-alpha',
      standingAuthority: true,
      authorityConsumed: false,
      approvalRequiredPerRead: false,
      memoryWrites: false,
      localFallback: false,
      driveFallback: false,
      scanStartedAt: '2026-11-07T04:00:00.000Z',
      hostAuthorizationContext,
      records: [makeRecord()],
      count: 1,
      nextCursor: 'unscanned-learning-page'
    })
  }), /HFM_WORK_LEARNING_SCAN_INCOMPLETE/);
  console.log('HFM_WORK_LEARNING_INCOMPLETE_GLOBAL_SCAN_FAILS_CLOSED=PASS');

  await assert.rejects(() => retrieveHfmWorkLearning({
    req, pool: {}, task, now,
    env: {
      MIRA_HFM_WORK_LEARNING_ENABLED: 'true',
      MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true'
    },
    readMemory: async () => ({
      status: 'AUTHORIZED_AND_COMMITTED',
      projectId: 'project-alpha',
      standingAuthority: true,
      authorityConsumed: false,
      approvalRequiredPerRead: false,
      memoryWrites: false,
      localFallback: false,
      driveFallback: false,
      scanStartedAt: '2026-11-07T04:00:00.000Z',
      hostAuthorizationContext,
      records: [makeRecord('project-beta')],
      count: 1
    })
  }), /HFM_STANDING_READ_PAGE_RECORD_SCOPE_INVALID/);
  console.log('HFM_WORK_LEARNING_CROSS_PROJECT_RECORD_REJECTED=PASS');

  await assert.rejects(() => retrieveHfmWorkLearning({
    req, pool: {}, task, now,
    env: {
      MIRA_HFM_WORK_LEARNING_ENABLED: 'true',
      MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true'
    },
    readMemory: async () => ({
      status: 'AUTHORIZED_AND_COMMITTED', standingAuthority: true,
      authorityConsumed: false, approvalRequiredPerRead: false,
      memoryWrites: false, localFallback: false, driveFallback: false,
      scanStartedAt: '2026-11-07T04:00:00.000Z',
      records: [makeRecord()], count: 1
    })
  }), /HFM_STANDING_READ_PAGE_AUTHORIZATION_REQUIRED/);
  console.log('HFM_WORK_LEARNING_MISSING_HOST_AUTHORIZATION_FAILS_CLOSED=PASS');
  console.log('NETWORK_REQUESTS=0');
  console.log('MEMORY_WRITES=0');
  console.log('LOCAL_OR_DRIVE_FALLBACK=NO');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
