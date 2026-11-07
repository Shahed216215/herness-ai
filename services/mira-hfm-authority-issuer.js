'use strict';

// HFM v0.2 server-only authority issuer.
// It issues only a single short-lived memory.read grant after validating a
// server-verifiable, one-time human approval receipt. No HTTP route is exposed.
const { randomUUID } = require('node:crypto');
const { normalizeTrustedActorIdentity } = require('./mira-memory-host-identity-contract');
const { buildTrustedProjectContext } = require('./mira-hfm-project-binding-context');

const MAX_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TTL_MS = 60 * 1000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function bounded(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw fail('HFM_AUTHORITY_ISSUE_INPUT_INVALID');
  }
  return value.trim();
}

function validateApproval(receipt, expected) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      receipt.verified !== true || receipt.approved !== true) {
    throw fail('HFM_AUTHORITY_APPROVAL_NOT_VERIFIED');
  }
  const approvalRef = bounded(receipt.approvalRef, 256);
  const fields = {
    projectId: bounded(receipt.projectId, 256),
    actorId: bounded(receipt.actorId, 512),
    operation: bounded(receipt.operation, 128),
    resource: bounded(receipt.resource, 512),
    purpose: bounded(receipt.purpose, 512)
  };
  for (const [key, value] of Object.entries(expected)) {
    if (fields[key] !== value) throw fail('HFM_AUTHORITY_APPROVAL_SCOPE_MISMATCH');
  }
  const issuedAt = Date.parse(receipt.issuedAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  const now = Date.now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt > now || expiresAt <= now || expiresAt <= issuedAt ||
      expiresAt - issuedAt > MAX_TTL_MS) {
    throw fail('HFM_AUTHORITY_APPROVAL_TIME_INVALID');
  }
  if (receipt.maxUses !== 1) throw fail('HFM_AUTHORITY_APPROVAL_MUST_BE_SINGLE_USE');
  return Object.freeze({ approvalRef, issuedAt: new Date(issuedAt), expiresAt: new Date(expiresAt) });
}

async function issueMemoryReadAuthority(options = {}) {
  if (!options.req || typeof options.req !== 'object') throw fail('HFM_AUTHORITY_SESSION_REQUIRED');
  if (typeof options.verifyApprovalToken !== 'function') {
    throw fail('HFM_AUTHORITY_APPROVAL_VERIFIER_REQUIRED');
  }
  if (!options.pool || typeof options.pool.connect !== 'function') {
    throw fail('HFM_AUTHORITY_ISSUER_POOL_REQUIRED');
  }

  const projectContext = buildTrustedProjectContext(options.req);
  if (projectContext.status !== 'PROJECT_CONTEXT_RESOLVED' ||
      projectContext.actor.role !== 'admin') {
    throw fail('HFM_AUTHORITY_ADMIN_PROJECT_CONTEXT_REQUIRED');
  }

  let actor;
  try {
    actor = normalizeTrustedActorIdentity({
      verifiedPrincipal: options.req.session.hfmPrincipal
    });
  } catch (_error) {
    throw fail('HFM_AUTHORITY_TRUSTED_ADMIN_REQUIRED');
  }

  const configuredAdmin = options.env?.MIRA_ADMIN_SUBJECT_ID || process.env.MIRA_ADMIN_SUBJECT_ID;
  if (typeof configuredAdmin !== 'string' ||
      configuredAdmin.trim() !== options.req.session.hfmPrincipal.subject) {
    throw fail('HFM_AUTHORITY_ADMIN_SUBJECT_NOT_CONFIGURED');
  }

  const projectId = projectContext.project.projectId;
  const expected = Object.freeze({
    projectId,
    actorId: actor.actorId,
    operation: 'memory.read',
    resource: 'memory:project:' + projectId,
    purpose: bounded(options.purpose, 512)
  });

  let verifiedReceipt;
  try {
    verifiedReceipt = await options.verifyApprovalToken(bounded(options.approvalToken, 8192), expected);
  } catch (_error) {
    throw fail('HFM_AUTHORITY_APPROVAL_VERIFICATION_FAILED');
  }
  const approval = validateApproval(verifiedReceipt, expected);

  const requestedTtl = options.ttlMs === undefined ? DEFAULT_TTL_MS : options.ttlMs;
  if (!Number.isInteger(requestedTtl) || requestedTtl < 1000 || requestedTtl > MAX_TTL_MS) {
    throw fail('HFM_AUTHORITY_TTL_INVALID');
  }

  const authorityId = randomUUID();
  const requestId = randomUUID();
  const now = new Date();
  const validFrom = new Date(Math.max(now.getTime(), approval.issuedAt.getTime()));
  const expiresAt = new Date(Math.min(validFrom.getTime() + requestedTtl, approval.expiresAt.getTime()));
  if (expiresAt <= validFrom) throw fail('HFM_AUTHORITY_APPROVAL_EXPIRED');

  const client = await options.pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [projectId]);
    await client.query("SELECT set_config('mira.actor_id', $1, true)", [actor.actorId]);

    const ownerResult = await client.query(
      "SELECT revision, status FROM mira_hfm.project_owners WHERE project_id = $1",
      [projectId]
    );
    const owner = ownerResult.rows?.[0];
    if (!owner || owner.status !== 'ACTIVE') throw fail('HFM_AUTHORITY_PROJECT_OWNER_NOT_ACTIVE');

    const membershipResult = await client.query(
      "SELECT revision, permissions, status, valid_from, expires_at FROM mira_hfm.project_memberships " +
      "WHERE project_id = $1 AND actor_id = $2 AND status = 'ACTIVE' " +
      "AND valid_from <= clock_timestamp() AND (expires_at IS NULL OR expires_at > clock_timestamp())",
      [projectId, actor.actorId]
    );
    const membership = membershipResult.rows?.[0];
    if (!membership || !Array.isArray(membership.permissions?.operations) ||
        !membership.permissions.operations.includes('memory.read')) {
      throw fail('HFM_AUTHORITY_MEMORY_READ_NOT_GRANTED');
    }

    await client.query(
      "INSERT INTO mira_hfm.operation_authorities " +
      "(authority_id, project_id, actor_id, operation, resource, purpose, request_id, " +
      "membership_revision, owner_revision, status, issued_by_actor_id, approval_ref, valid_from, expires_at) " +
      "VALUES ($1,$2,$3,'memory.read',$4,$5,$6,$7,$8,'ISSUED',$3,$9,$10,$11)",
      [authorityId, projectId, actor.actorId, expected.resource, expected.purpose, requestId,
        membership.revision, owner.revision, approval.approvalRef, validFrom, expiresAt]
    );

    await client.query(
      "INSERT INTO mira_hfm.authority_audit_events " +
      "(event_id, project_id, actor_id, event_type, request_id, occurred_at, " +
      "prior_revision, new_revision, approval_ref, details) " +
      "VALUES ($1,$2,$3,'AUTHORITY_ISSUED',$4,clock_timestamp(),$5,$6,$7,$8::jsonb)",
      [randomUUID(), projectId, actor.actorId, requestId, owner.revision, membership.revision,
        approval.approvalRef, JSON.stringify({ authorityId, operation: 'memory.read', resource: expected.resource,
          purpose: expected.purpose, expiresAt: expiresAt.toISOString(), singleUse: true })]
    );

    const finalMembership = await client.query(
      "SELECT (status = 'ACTIVE' AND valid_from <= clock_timestamp() " +
      "AND (expires_at IS NULL OR expires_at > clock_timestamp())) AS membership_valid " +
      "FROM mira_hfm.project_memberships WHERE project_id = $1 AND actor_id = $2",
      [projectId, actor.actorId]
    );
    if (finalMembership.rows?.[0]?.membership_valid !== true) {
      throw fail('HFM_AUTHORITY_MEMBERSHIP_CHANGED_DURING_ISSUE');
    }

    await client.query('COMMIT');
    transactionOpen = false;
    return Object.freeze({
      status: 'AUTHORITY_ISSUED',
      grant: Object.freeze({ authorityId, purpose: expected.purpose, requestId }),
      projectId,
      operation: 'memory.read',
      singleUse: true,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
    }
    throw error;
  } finally {
    try { client.release(); } catch (_releaseError) {}
  }
}

module.exports = Object.freeze({ issueMemoryReadAuthority, validateApproval, MAX_TTL_MS });
