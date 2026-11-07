'use strict';

// Internal server-side adapter for HFM v0.2 project Memory retrieval.
// The caller must supply a server-held, previously issued one-time authority grant.
// HTTP/model arguments are never accepted as actor or project identity.

const { buildTrustedProjectContext } = require('./mira-hfm-project-binding-context');
const { executeWithConsumedAuthority, executeWithStandingReadAuthority } = require('./mira-hfm-authority-transaction');
const { listMemoryRecords } = require('./mira-hfm-memory-repository');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateAuthorityGrant(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
    fail('HFM_MEMORY_READ_SERVER_AUTHORITY_GRANT_REQUIRED');
  }
  const keys = Object.keys(grant).sort();
  const expected = ['authorityId', 'purpose', 'requestId'].sort();
  if (keys.length !== expected.length ||
      keys.some((key, index) => key !== expected[index]) ||
      typeof grant.authorityId !== 'string' || !grant.authorityId.trim() ||
      typeof grant.purpose !== 'string' || !grant.purpose.trim() ||
      typeof grant.requestId !== 'string' || !grant.requestId.trim()) {
    fail('HFM_MEMORY_READ_SERVER_AUTHORITY_GRANT_INVALID');
  }
  return Object.freeze({
    authorityId: grant.authorityId,
    purpose: grant.purpose,
    requestId: grant.requestId
  });
}

async function retrieveProjectMemory(options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.connect !== 'function') {
    fail('HFM_MEMORY_READ_POOL_REQUIRED');
  }
  const projectContext = buildTrustedProjectContext(options.req);
  if (projectContext.status !== 'PROJECT_CONTEXT_RESOLVED') {
    fail('HFM_MEMORY_READ_TRUSTED_PROJECT_CONTEXT_REQUIRED');
  }
  const projectId = projectContext.project.projectId;
  const limit = options.limit === undefined ? 100 : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    fail('HFM_MEMORY_READ_LIMIT_INVALID');
  }

  if (options.standingReadAuthority === true) {
    const allowedRecordTypes = ['learning_note', 'knowledge_item'];
    if (options.lifecycle !== undefined && options.lifecycle !== 'ACTIVE') {
      fail('HFM_STANDING_READ_LIFECYCLE_SCOPE_INVALID');
    }
    if (options.recordType !== undefined && !allowedRecordTypes.includes(options.recordType)) {
      fail('HFM_STANDING_READ_RECORD_TYPE_SCOPE_INVALID');
    }
    if (options.recordTypes !== undefined &&
        (!Array.isArray(options.recordTypes) ||
         options.recordTypes.length === 0 ||
         options.recordTypes.some(type => !allowedRecordTypes.includes(type)))) {
      fail('HFM_STANDING_READ_RECORD_TYPE_SCOPE_INVALID');
    }
    const result = await executeWithStandingReadAuthority({
      pool,
      verifiedPrincipal: options.req.session.hfmPrincipal,
      projectId,
      resource: 'memory:project:' + projectId,
      perform: (client, context) => listMemoryRecords({
        client,
        context,
        limit,
        lifecycle: 'ACTIVE',
        recordType: options.recordType,
        recordTypes: options.recordType ? [options.recordType] : allowedRecordTypes,
        allowPrivateRead: true,
        env: options.env || process.env
      })
    });
    return Object.freeze({
      status: 'AUTHORIZED_AND_COMMITTED',
      projectId,
      records: Object.freeze([...(result.value.records || [])]),
      count: result.value.count,
      authorityConsumed: false,
      standingAuthority: true,
      standingAuthorityId: result.standingAuthorityId,
      authorityExpiresAt: result.authorityExpiresAt,
      hostAuthorizationContext: result.hostAuthorizationContext,
      approvalRequiredPerRead: false,
      memoryWrites: false,
      localFallback: false,
      driveFallback: false
    });
  }

  const grant = validateAuthorityGrant(options.authorityGrant);

  const result = await executeWithConsumedAuthority({
    pool,
    verifiedPrincipal: options.req.session.hfmPrincipal,
    request: {
      authorityId: grant.authorityId,
      projectId,
      operation: 'memory.read',
      resource: 'memory:project:' + projectId,
      purpose: grant.purpose,
      requestId: grant.requestId
    },
    perform: (client, context) => listMemoryRecords({
      client,
      context,
      limit,
      lifecycle: options.lifecycle || 'ACTIVE',
      recordType: options.recordType,
      recordTypes: options.recordTypes,
      allowPrivateRead: true,
      env: options.env || process.env
    })
  });

  return Object.freeze({
    status: 'AUTHORIZED_AND_COMMITTED',
    projectId,
    records: Object.freeze([...(result.value.records || [])]),
    count: result.value.count,
    authorityConsumed: true,
    standingAuthority: false,
    memoryWrites: false,
    localFallback: false,
    driveFallback: false
  });
}

module.exports = Object.freeze({ retrieveProjectMemory, validateAuthorityGrant });
