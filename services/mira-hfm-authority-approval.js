'use strict';

const crypto = require('node:crypto');
const { normalizeTrustedActorIdentity } = require('./mira-memory-host-identity-contract');
const { buildTrustedProjectContext } = require('./mira-hfm-project-binding-context');
const { signApprovalToken, createApprovalTokenVerifier } = require('./mira-hfm-approval-token');
const { issueMemoryReadAuthority } = require('./mira-hfm-authority-issuer');

const DEFAULT_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 5 * 60 * 1000;
const MAX_REAUTH_AGE_MS = 5 * 60 * 1000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function bounded(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw fail('HFM_APPROVAL_ISSUE_INPUT_INVALID');
  }
  return value.trim();
}

function trustedAdmin(req, env = process.env, now = Date.now()) {
  if (!req || typeof req !== 'object' || !req.session ||
      req.session.authenticated !== true || req.session.role !== 'admin') {
    throw fail('HFM_APPROVAL_ADMIN_SESSION_REQUIRED');
  }
  const project = buildTrustedProjectContext(req);
  if (project.status !== 'PROJECT_CONTEXT_RESOLVED' || project.actor.role !== 'admin') {
    throw fail('HFM_APPROVAL_ADMIN_PROJECT_CONTEXT_REQUIRED');
  }
  let actor;
  try {
    actor = normalizeTrustedActorIdentity({ verifiedPrincipal: req.session.hfmPrincipal });
  } catch (_error) {
    throw fail('HFM_APPROVAL_TRUSTED_ADMIN_REQUIRED');
  }
  const principal = req.session.hfmPrincipal;
  const configured = env.MIRA_ADMIN_SUBJECT_ID;
  if (principal.issuer !== 'mira.admins' || typeof configured !== 'string' ||
      configured.trim() !== principal.subject) {
    throw fail('HFM_APPROVAL_ADMIN_SUBJECT_NOT_CONFIGURED');
  }
  const authenticatedAt = Date.parse(principal.authenticatedAt);
  if (!Number.isFinite(authenticatedAt) || authenticatedAt > now ||
      now - authenticatedAt > MAX_REAUTH_AGE_MS) {
    throw fail('HFM_APPROVAL_RECENT_AUTHENTICATION_REQUIRED');
  }
  return Object.freeze({ actor, projectId: project.project.projectId, principal });
}

async function issueApprovalToken(options = {}) {
  if (options.approvalConfirmed !== true) throw fail('HFM_APPROVAL_EXPLICIT_CONFIRMATION_REQUIRED');
  if (!options.pool || typeof options.pool.connect !== 'function') {
    throw fail('HFM_APPROVAL_ISSUER_POOL_REQUIRED');
  }
  const env = options.env || process.env;
  const now = Date.now();
  const { actor, projectId } = trustedAdmin(options.req, env, now);
  const purpose = bounded(options.purpose, 512);
  const requestedTtl = options.ttlMs === undefined ? DEFAULT_TTL_MS : options.ttlMs;
  if (!Number.isInteger(requestedTtl) || requestedTtl < 1000 || requestedTtl > MAX_TTL_MS) {
    throw fail('HFM_APPROVAL_TTL_INVALID');
  }

  const issuedAt = new Date(now);
  const expiresAt = new Date(now + requestedTtl);
  const approvalRef = crypto.randomUUID();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const nonceHash = crypto.createHash('sha256').update(nonce, 'utf8').digest('hex');
  const resource = 'memory:project:' + projectId;
  const payload = Object.freeze({
    approvalRef, nonce, projectId,
    actorId: actor.actorId,
    approverActorId: actor.actorId,
    operation: 'memory.read',
    resource,
    purpose,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maxUses: 1
  });
  const token = signApprovalToken({
    secret: options.secret || env.MIRA_HFM_APPROVAL_TOKEN_SECRET,
    payload
  });

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
    if (!owner || owner.status !== 'ACTIVE') throw fail('HFM_APPROVAL_PROJECT_OWNER_NOT_ACTIVE');

    const membershipResult = await client.query(
      "SELECT revision, permissions, status FROM mira_hfm.project_memberships " +
      "WHERE project_id = $1 AND actor_id = $2 AND status = 'ACTIVE' " +
      "AND valid_from <= clock_timestamp() AND (expires_at IS NULL OR expires_at > clock_timestamp())",
      [projectId, actor.actorId]
    );
    const membership = membershipResult.rows?.[0];
    if (!membership || !Array.isArray(membership.permissions?.operations) ||
        !membership.permissions.operations.includes('memory.read')) {
      throw fail('HFM_APPROVAL_MEMORY_READ_NOT_GRANTED');
    }

    await client.query(
      "INSERT INTO mira_hfm.authority_approval_nonces " +
      "(nonce_hash, approval_ref, project_id, actor_id, approver_actor_id, operation, resource, purpose, issued_at, expires_at) " +
      "VALUES ($1,$2,$3,$4,$4,'memory.read',$5,$6,$7,$8)",
      [nonceHash, approvalRef, projectId, actor.actorId, resource, purpose, issuedAt, expiresAt]
    );
    await client.query(
      "INSERT INTO mira_hfm.authority_audit_events " +
      "(event_id, project_id, actor_id, event_type, request_id, occurred_at, approval_ref, details) " +
      "VALUES ($1,$2,$3,'APPROVAL_TOKEN_ISSUED',$4,clock_timestamp(),$5,$6::jsonb)",
      [crypto.randomUUID(), projectId, actor.actorId, crypto.randomUUID(), approvalRef,
        JSON.stringify({ operation: 'memory.read', resource, purpose, expiresAt: expiresAt.toISOString(), singleUse: true })]
    );
    await client.query('COMMIT');
    transactionOpen = false;
    return Object.freeze({
      status: 'APPROVAL_TOKEN_ISSUED',
      token,
      approvalRef,
      projectId,
      operation: 'memory.read',
      expiresAt: expiresAt.toISOString(),
      singleUse: true
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

function createDatabaseApprovalVerifier(options = {}) {
  if (!options.pool || typeof options.pool.connect !== 'function') {
    throw fail('HFM_APPROVAL_ISSUER_POOL_REQUIRED');
  }
  const env = options.env || process.env;
  const secret = options.secret || env.MIRA_HFM_APPROVAL_TOKEN_SECRET;
  return createApprovalTokenVerifier({
    secret,
    async consumeNonce(receipt) {
      const client = await options.pool.connect();
      let transactionOpen = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        transactionOpen = true;
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        await client.query("SET LOCAL lock_timeout = '3000ms'");
        await client.query("SELECT set_config('mira.project_id', $1, true)", [receipt.projectId]);
        await client.query("SELECT set_config('mira.actor_id', $1, true)", [receipt.actorId]);
        const result = await client.query(
          "UPDATE mira_hfm.authority_approval_nonces SET consumed_at = clock_timestamp() " +
          "WHERE nonce_hash = $1 AND approval_ref = $2 AND project_id = $3 AND actor_id = $4 " +
          "AND approver_actor_id = $5 AND operation = $6 AND resource = $7 AND purpose = $8 " +
          "AND issued_at = $9 AND expires_at = $10 AND consumed_at IS NULL " +
          "AND expires_at > clock_timestamp()",
          [receipt.nonceHash, receipt.approvalRef, receipt.projectId, receipt.actorId,
            receipt.approverActorId, receipt.operation, receipt.resource, receipt.purpose,
            receipt.issuedAt, receipt.expiresAt]
        );
        if (result.rowCount !== 1) {
          await client.query('ROLLBACK');
          transactionOpen = false;
          return false;
        }
        await client.query(
          "INSERT INTO mira_hfm.authority_audit_events " +
          "(event_id, project_id, actor_id, event_type, request_id, occurred_at, approval_ref, details) " +
          "VALUES ($1,$2,$3,'APPROVAL_TOKEN_CONSUMED',$4,clock_timestamp(),$5,$6::jsonb)",
          [crypto.randomUUID(), receipt.projectId, receipt.actorId, crypto.randomUUID(), receipt.approvalRef,
            JSON.stringify({ operation: receipt.operation, resource: receipt.resource,
              purpose: receipt.purpose, nonceHash: receipt.nonceHash, singleUse: true })]
        );
        await client.query('COMMIT');
        transactionOpen = false;
        return true;
      } catch (error) {
        if (transactionOpen) {
          try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
        }
        throw error;
      } finally {
        try { client.release(); } catch (_releaseError) {}
      }
    }
  });
}

async function approveAndIssueMemoryReadAuthority(options = {}) {
  const approval = await issueApprovalToken(options);
  const verifyApprovalToken = createDatabaseApprovalVerifier(options);
  return issueMemoryReadAuthority({
    ...options,
    approvalToken: approval.token,
    verifyApprovalToken
  });
}

module.exports = Object.freeze({
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  MAX_REAUTH_AGE_MS,
  trustedAdmin,
  issueApprovalToken,
  createDatabaseApprovalVerifier,
  approveAndIssueMemoryReadAuthority
});
