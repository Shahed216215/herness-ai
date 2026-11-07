'use strict';

const { retrieveProjectMemory } = require('./mira-hfm-authorized-memory-reader');
const { extractKnowledgeTitle } = require('./mira-hfm-knowledge-search-runtime');
const { approveAndIssueMemoryOperationAuthority } = require('./mira-hfm-authority-approval');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hasExplicitReviewIntent(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) return false;
  const negative = /\b(?:do not|don't|never)\s+(?:show|list|review|inspect)\b/i.test(value) ||
    /(?:দেখিও\s*না|দেখাবেন\s*না|রিভিউ\s*করো\s*না|পর্যালোচনা\s*করো\s*না)/u.test(value);
  if (negative) return false;
  const english = /\b(?:show|list|review|inspect)\b.{0,80}\b(?:pending|unverified|review)\b.{0,80}\b(?:knowledge|source|item|record)s?\b/i.test(value) ||
    /\b(?:pending knowledge|knowledge review queue|unverified sources)\b/i.test(value);
  const bengali = /(?:অযাচাইকৃত|যাচাইয়ের\s*জন্য|রিভিউ|পর্যালোচনা).{0,60}(?:জ্ঞান|তথ্য|সোর্স|রেকর্ড)|(?:জ্ঞান|তথ্য|সোর্স).{0,60}(?:রিভিউ|পর্যালোচনা|যাচাইয়ের\s*জন্য)/u.test(value);
  return english || bengali;
}

function safeReviewSourceUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.search = '';
    parsed.hash = '';
    return parsed.origin + parsed.pathname;
  } catch (_error) {
    return null;
  }
}

async function listPendingHfmKnowledgeForReview({
  req, pool, issuerPool, limit = 20, env = process.env, userIntent,
  now = new Date(), readMemory = retrieveProjectMemory,
  issueAuthority = approveAndIssueMemoryOperationAuthority
} = {}) {
  if (!hasExplicitReviewIntent(userIntent)) fail('HFM_KNOWLEDGE_REVIEW_EXPLICIT_USER_INTENT_REQUIRED');
  if (env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED !== 'true') {
    fail('HFM_KNOWLEDGE_REVIEW_STANDING_READ_AUTHORITY_DISABLED');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    fail('HFM_KNOWLEDGE_REVIEW_LIMIT_INVALID');
  }
  if (!req || !req.session || req.session.authenticated !== true ||
      req.session.role !== 'admin' || !req.session.hfmPrincipal) {
    fail('HFM_KNOWLEDGE_REVIEW_VERIFIED_ADMIN_REQUIRED');
  }
  const binding = req.session.hfmProjectBinding;
  if (!binding || binding.verified !== true || typeof binding.projectId !== 'string' || !binding.projectId.trim()) {
    fail('HFM_KNOWLEDGE_REVIEW_VERIFIED_PROJECT_REQUIRED');
  }
  if (!pool || typeof pool.connect !== 'function' ||
      !issuerPool || typeof issuerPool.connect !== 'function' ||
      typeof readMemory !== 'function') {
    fail('HFM_KNOWLEDGE_REVIEW_READ_AND_ISSUER_RUNTIMES_REQUIRED');
  }

  const projectId = binding.projectId;
  const authority = await issueAuthority({
    req, pool: issuerPool, env,
    operation: 'memory.read',
    resource: 'memory:project:' + projectId,
    purpose: 'User explicitly requested a read-only review of pending HFM knowledge items.',
    approvalConfirmed: true
  });
  if (!authority || authority.status !== 'AUTHORITY_ISSUED' ||
      authority.projectId !== projectId || authority.operation !== 'memory.read' ||
      authority.resource !== 'memory:project:' + projectId || !authority.grant) {
    fail('HFM_KNOWLEDGE_REVIEW_ONE_TIME_READ_AUTHORITY_NOT_VERIFIED');
  }

  const memory = await readMemory({
    pool, req, authorityGrant: authority.grant,
    recordTypes: ['knowledge_item', 'learning_note'], lifecycle: 'PENDING_REVIEW',
    limit, env, now
  });
  if (!memory || memory.status !== 'AUTHORIZED_AND_COMMITTED' ||
      memory.authorityConsumed !== true || memory.standingAuthority !== false ||
      !Array.isArray(memory.records) || !memory.hostAuthorizationContext) {
    fail('HFM_KNOWLEDGE_REVIEW_AUTHORIZED_READ_REQUIRED');
  }
  const host = memory.hostAuthorizationContext;
  if (memory.projectId !== binding.projectId || host.projectId !== binding.projectId ||
      typeof host.actorId !== 'string' || !host.actorId.startsWith('mira:')) {
    fail('HFM_KNOWLEDGE_REVIEW_HOST_CONTEXT_INVALID');
  }

  const items = memory.records
    .filter(record => record && record.projectId === binding.projectId &&
      ['knowledge_item', 'learning_note'].includes(record.recordType) &&
      record.lifecycle === 'PENDING_REVIEW' &&
      record.trust?.status === 'SOURCE_RECORDED' &&
      record.integrity?.status === 'VERIFIED' &&
      record.access?.classification === 'PROJECT_PRIVATE')
    .slice(0, limit)
    .map(record => Object.freeze({
      id: record.memoryId,
      recordType: record.recordType,
      title: extractKnowledgeTitle(record),
      content: record.content.slice(0, 10000),
      sourceUrl: safeReviewSourceUrl(record.source?.sourceUrl),
      createdAt: record.timestamps.createdAt,
      revision: record.version.revision,
      trust: record.trust.status,
      integrity: record.integrity.status,
      lifecycle: record.lifecycle,
      eligibleForTrustedSearch: false,
      requiresHumanReview: true
    }));

  return Object.freeze({
    success: true,
    status: 'REVIEW_REQUIRED',
    projectId: binding.projectId,
    count: items.length,
    items: Object.freeze(items),
    standingAuthority: false,
    authorityConsumed: true,
    authorityExpiresAt: authority.grant.expiresAt || null,
    approvalRequiredPerRead: true,
    promotionSupported: false,
    writeAllowed: false,
    localFallback: false,
    driveFallback: false
  });
}

module.exports = Object.freeze({
  hasExplicitReviewIntent,
  safeReviewSourceUrl,
  listPendingHfmKnowledgeForReview
});
