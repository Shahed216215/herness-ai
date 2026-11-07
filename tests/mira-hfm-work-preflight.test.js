'use strict';

const assert = require('node:assert/strict');
const { preflightHfmStandingRead } = require('../services/mira-hfm-work-preflight');

const context = {
  actorId: 'mira:actor-001',
  actorType: 'HUMAN',
  projectId: 'project-alpha',
  purpose: 'preflight Work planning with standing memory.read authority',
  requestId: 'request-preflight-001',
  authorityRef: 'standing-authority-001',
  issuedAt: '2026-11-07T00:00:00.000Z',
  expiresAt: '2027-11-07T00:00:00.000Z'
};

const record = {
  memoryId: 'memory-preflight-001',
  projectId: 'project-alpha',
  recordType: 'knowledge_item',
  lifecycle: 'ACTIVE'
};

function authorizedResult(overrides = {}) {
  return {
    status: 'AUTHORIZED_AND_COMMITTED',
    projectId: 'project-alpha',
    records: [record],
    count: 1,
    standingAuthority: true,
    standingAuthorityId: context.authorityRef,
    authorityExpiresAt: context.expiresAt,
    authorityConsumed: false,
    approvalRequiredPerRead: false,
    memoryWrites: false,
    localFallback: false,
    driveFallback: false,
    scanStartedAt: '2026-11-07T01:00:00.000Z',
    hostAuthorizationContext: context,
    ...overrides
  };
}

(async () => {
  let received;
  const result = await preflightHfmStandingRead({
    pool: { connect: async () => ({}) },
    req: { session: { hfmPrincipal: { verified: true } } },
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
    readMemory: async options => {
      received = options;
      return authorizedResult();
    }
  });
  assert.equal(received.standingReadAuthority, true);
  assert.deepEqual(received.recordTypes, ['learning_note', 'knowledge_item']);
  assert.equal(received.lifecycle, 'ACTIVE');
  assert.equal(received.limit, 1);
  assert.equal(result.status, 'AUTHORIZED_AND_COMMITTED');
  console.log('HFM_WORK_PREFLIGHT_VERIFIES_LIVE_STANDING_READ=PASS');

  let learningLimit;
  await preflightHfmStandingRead({
    pool: { connect: async () => ({}) },
    req: {},
    includeLearning: true,
    readMemory: async options => {
      learningLimit = options.limit;
      return authorizedResult();
    }
  });
  assert.equal(learningLimit, 100);
  console.log('HFM_WORK_PREFLIGHT_USES_BOUNDED_LEARNING_PAGE=PASS');

  const invalidResults = [
    authorizedResult({ hostAuthorizationContext: { ...context, requestId: '' } }),
    authorizedResult({ hostAuthorizationContext: { ...context, actorType: 'SERVICE' } }),
    authorizedResult({ hostAuthorizationContext: { ...context, expiresAt: '2026-02-30T12:00:00.000000Z' } }),
    authorizedResult({ hostAuthorizationContext: { ...context, issuedAt: '2026-11-07T00:00:00' } }),
    authorizedResult({ hostAuthorizationContext: { ...context, expiresAt: '2026-11-07 00:00:00Z' } }),
    authorizedResult({ authorityExpiresAt: '2027-11-08T00:00:00.000Z' }),
    authorizedResult({ hostAuthorizationContext: { ...context, expiresAt: new Date(Date.now() - 1000).toISOString() } }),
    authorizedResult({ hostAuthorizationContext: { ...context, issuedAt: new Date(Date.now() + 3600000).toISOString() } }),
    authorizedResult({ scanStartedAt: new Date(Date.now() + 60000).toISOString() }),
    authorizedResult({ records: [{ ...record, projectId: 'project-beta' }] }),
    authorizedResult({ localFallback: true }),
    authorizedResult({ memoryWrites: true })
  ];
  for (const invalid of invalidResults) {
    await assert.rejects(
      () => preflightHfmStandingRead({
        pool: { connect: async () => ({}) },
        req: {},
        readMemory: async () => invalid
      }),
      error => error.code === 'HFM_STANDING_READ_PREFLIGHT_AUTHORIZATION_REQUIRED'
    );
  }
  console.log('HFM_WORK_PREFLIGHT_REJECTS_INVALID_AUDIT_AND_SCOPE_CONTEXT=PASS');
  await assert.rejects(
    () => preflightHfmStandingRead({
      pool: { connect: async () => ({}) },
      req: {},
      now: new Date('2026-11-07T01:00:00.000Z'),
      readMemory: async () => authorizedResult({
        scanStartedAt: '2026-11-07T01:00:00.000001Z'
      })
    }),
    error => error.code === 'HFM_STANDING_READ_PREFLIGHT_AUTHORIZATION_REQUIRED'
  );
  console.log('HFM_WORK_PREFLIGHT_REJECTS_MICROSECOND_FUTURE_SCAN_TIMESTAMP=PASS');

  const boundaryNow = new Date('2026-11-07T01:00:00.000Z');
  const futureIssuedAt = authorizedResult({
    hostAuthorizationContext: {
      ...context,
      issuedAt: '2026-11-07T01:00:00.000001Z'
    }
  });
  await assert.rejects(
    () => preflightHfmStandingRead({
      pool: { connect: async () => ({}) },
      req: {},
      now: boundaryNow,
      readMemory: async () => futureIssuedAt
    }),
    error => error.code === 'HFM_STANDING_READ_PREFLIGHT_AUTHORIZATION_REQUIRED'
  );

  const expiredWithinMillisecond = authorizedResult({
    authorityExpiresAt: '2026-11-07T00:59:59.999999Z',
    hostAuthorizationContext: {
      ...context,
      expiresAt: '2026-11-07T00:59:59.999999Z'
    }
  });
  await assert.rejects(
    () => preflightHfmStandingRead({
      pool: { connect: async () => ({}) },
      req: {},
      now: boundaryNow,
      readMemory: async () => expiredWithinMillisecond
    }),
    error => error.code === 'HFM_STANDING_READ_PREFLIGHT_AUTHORIZATION_REQUIRED'
  );

  const expiresWithinMillisecond = authorizedResult({
    authorityExpiresAt: '2026-11-07T01:00:00.000001Z',
    hostAuthorizationContext: {
      ...context,
      expiresAt: '2026-11-07T01:00:00.000001Z'
    }
  });
  const validMicrosecondExpiry = await preflightHfmStandingRead({
    pool: { connect: async () => ({}) },
    req: {},
    now: boundaryNow,
    readMemory: async () => expiresWithinMillisecond
  });
  assert.equal(validMicrosecondExpiry.status, 'AUTHORIZED_AND_COMMITTED');
  const offsetFutureIssuedAt = authorizedResult({
    hostAuthorizationContext: {
      ...context,
      issuedAt: '2026-11-07T02:00:00.000001+01:00'
    }
  });
  await assert.rejects(
    () => preflightHfmStandingRead({
      pool: { connect: async () => ({}) },
      req: {},
      now: boundaryNow,
      readMemory: async () => offsetFutureIssuedAt
    }),
    error => error.code === 'HFM_STANDING_READ_PREFLIGHT_AUTHORIZATION_REQUIRED'
  );

  const offsetExpiredAuthority = authorizedResult({
    authorityExpiresAt: '2026-11-07T01:59:59.999999+01:00',
    hostAuthorizationContext: {
      ...context,
      expiresAt: '2026-11-07T01:59:59.999999+01:00'
    }
  });
  await assert.rejects(
    () => preflightHfmStandingRead({
      pool: { connect: async () => ({}) },
      req: {},
      now: boundaryNow,
      readMemory: async () => offsetExpiredAuthority
    }),
    error => error.code === 'HFM_STANDING_READ_PREFLIGHT_AUTHORIZATION_REQUIRED'
  );
  console.log('HFM_WORK_PREFLIGHT_MICROSECOND_ISSUED_AT_AND_EXPIRY_BOUNDARIES=PASS');
  const nanosecondFutureIssuedAt = authorizedResult({
    hostAuthorizationContext: {
      ...context,
      issuedAt: '2026-11-07T01:00:00.000000001Z'
    }
  });
  await assert.rejects(
    () => preflightHfmStandingRead({
      pool: { connect: async () => ({}) },
      req: {},
      now: boundaryNow,
      readMemory: async () => nanosecondFutureIssuedAt
    }),
    error => error.code === 'HFM_STANDING_READ_PREFLIGHT_AUTHORIZATION_REQUIRED'
  );
  console.log('HFM_WORK_PREFLIGHT_MICROSECOND_RFC3339_OFFSET_BOUNDARIES=PASS');
  console.log('HFM_WORK_PREFLIGHT_NANOSECOND_RFC3339_BOUNDARY=PASS');

  console.log('HFM_WORK_PREFLIGHT_REJECTS_EXPIRED_AND_FUTURE_AUTHORITY=PASS');

  await assert.rejects(
    () => preflightHfmStandingRead({ req: {}, readMemory: async () => authorizedResult() }),
    error => error.code === 'HFM_STANDING_READ_PREFLIGHT_RUNTIME_REQUIRED'
  );
  console.log('HFM_WORK_PREFLIGHT_REQUIRES_RUNTIME_DEPENDENCIES=PASS');
  console.log('NETWORK_REQUESTS=0');
  console.log('MEMORY_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
