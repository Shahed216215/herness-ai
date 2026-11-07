'use strict';

// Internal server-side adapter for HFM v0.2 project Memory retrieval.
// The caller must supply a server-held, previously issued one-time authority grant.
// HTTP/model arguments are never accepted as actor or project identity.

const { buildTrustedProjectContext } = require('./mira-hfm-project-binding-context');
const { executeWithConsumedAuthority } = require('./mira-hfm-authority-transaction');
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
  const grant = validateAuthorityGrant(options.authorityGrant);
  const projectId = projectContext.project.projectId;
  const limit = options.limit === undefined ? 100 : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    fail('HFM_MEMORY_READ_LIMIT_INVALID');
  }

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
    memoryWrites: false,
    localFallback: false,
    driveFallback: false
  });
}

module.exports = Object.freeze({ retrieveProjectMemory, validateAuthorityGrant });
