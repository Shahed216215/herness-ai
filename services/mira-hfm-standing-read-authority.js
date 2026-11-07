'use strict';

// Human-approved, persistent HFM v0.2 memory.read authority.
// This registry is separate from operation_authorities: it never grants writes,
// never changes project membership, and every read is still checked/audited.
const crypto = require('node:crypto');
const { normalizeTrustedActorIdentity } = require('./mira-memory-host-identity-contract');
const {
  trustedAdmin,
  issueApprovalToken,
  createDatabaseApprovalVerifier
} = require('./mira-hfm-authority-approval');

const STANDING_READ_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const RESOURCE_PREFIX = 'memory:project:';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function bounded(value, max, code = 'HFM_STANDING_READ_INPUT_INVALID') {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(code);
  return value.trim();
}
function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') fail('HFM_STANDING_READ_POOL_REQUIRED');
}
function actorFrom(req) {
  try {
    return normalizeTrustedActorIdentity({
      verifiedPrincipal: req && req.session && req.session.hfmPrincipal
    });
  } catch (_error) {
    fail('HFM_STANDING_READ_TRUSTED_ADMIN_REQUIRED');
  }
}
function validateStandingReceipt(receipt, expected) {
  if (!receipt || receipt.verified !== true || receipt.approved !== true ||
      receipt.consumed !== true || receipt.maxUses !== 1 ||
      receipt.projectId !== expected.projectId ||
      receipt.actorId !== expected.actorId ||
      receipt.approverActorId !== expected.actorId ||
      receipt.operation !== 'memory.read' ||
      receipt.resource !== expected.resource ||
      receipt.purpose !== expected.purpose ||
      typeof receipt.approvalRef !== 'string' || !receipt.approvalRef.trim()) {
    fail('HFM_STANDING_READ_APPROVAL_RECEIPT_INVALID');
  }
  return receipt.approvalRef;
}

async function issueStandingReadAuthority(options = {}) {
  requirePool(options.pool);
  if (options.approvalConfirmed !== true) fail('HFM_STANDING_READ_EXPLICIT_CONFIRMATION_REQUIRED');
  const env = options.env || process.env;
  const admin = trustedAdmin(options.req, env);
  const actor = actorFrom(options.req);
  if (admin.actor.actorId !== actor.actorId) fail('HFM_STANDING_READ_ACTOR_MISMATCH');
  const projectId = admin.projectId;
  const purpose = bounded(options.purpose, 512);
  const resource = RESOURCE_PREFIX + projectId;
  const approval = await issueApprovalToken({
    ...options,
    req: options.req,
    pool: options.pool,
    env,
    approvalConfirmed: true,
    operation: 'memory.read',
    resource,
    purpose,
    ttlMs: options.approvalTtlMs
  });
  const verify = createDatabaseApprovalVerifier({ pool: options.pool, env });
  const expected = Object.freeze({
    projectId,
    actorId: actor.actorId,
    approverActorId: actor.actorId,
    operation: 'memory.read',
    resource,
    purpose
  });
  const receipt = await verify(approval.token, expected, { consume: true, singleUse: true });
  const approvalRef = validateStandingReceipt(receipt, expected);
  const standingAuthorityId = crypto.randomUUID();
  const validFrom = new Date();
  const expiresAt = new Date(validFrom.getTime() + STANDING_READ_TTL_MS);

  const client = await options.pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [projectId]);
    await client.query("SELECT set_config('mira.actor_id', $1, true)", [actor.actorId]);
    // Use the same transaction-scoped lock as reads and lifecycle changes.
    // This serializes issuance with pause/resume/revoke and an in-flight read.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["hfm-standing-read:" + projectId + ":" + actor.actorId]
    );
    const ownerResult = await client.query(
      "SELECT revision, status FROM mira_hfm.project_owners WHERE project_id = $1",
      [projectId]
    );
    const owner = ownerResult.rows && ownerResult.rows[0];
    if (!owner || owner.status !== 'ACTIVE') fail('HFM_STANDING_READ_PROJECT_OWNER_NOT_ACTIVE');
    const membershipResult = await client.query(
      "SELECT revision, permissions, status, valid_from, expires_at " +
      "FROM mira_hfm.project_memberships WHERE project_id = $1 AND actor_id = $2 " +
      "AND status = 'ACTIVE' AND valid_from <= clock_timestamp() " +
      "AND (expires_at IS NULL OR expires_at > clock_timestamp())",
      [projectId, actor.actorId]
    );
    const membership = membershipResult.rows && membershipResult.rows[0];
    if (!membership || !Array.isArray(membership.permissions?.operations) ||
        !membership.permissions.operations.includes('memory.read')) {
      fail('HFM_STANDING_READ_MEMBERSHIP_PERMISSION_REQUIRED');
    }
    const priorResult = await client.query(
      "SELECT standing_authority_id, status, expires_at, approval_ref, " +
      "(expires_at > clock_timestamp()) AS is_live " +
      "FROM mira_hfm.standing_read_authorities WHERE project_id = $1 AND actor_id = $2 " +
      "AND status IN ('ACTIVE','PAUSED') FOR UPDATE",
      [projectId, actor.actorId]
    );
    const prior = priorResult.rows?.[0];
    if (prior && prior.is_live === true) {
      fail('HFM_STANDING_READ_AUTHORITY_ALREADY_ACTIVE');
    }
    if (prior) {
      const expiredPrior = await client.query(
        "UPDATE mira_hfm.standing_read_authorities SET status = 'EXPIRED', " +
        "updated_at = clock_timestamp(), paused_at = NULL " +
        "WHERE standing_authority_id = $1 AND project_id = $2 AND actor_id = $3 " +
        "AND status IN ('ACTIVE','PAUSED') AND expires_at <= clock_timestamp()",
        [prior.standing_authority_id, projectId, actor.actorId]
      );
      if (expiredPrior.rowCount !== 1) fail('HFM_STANDING_READ_AUTHORITY_ALREADY_ACTIVE');
    }
    await client.query(
      "INSERT INTO mira_hfm.standing_read_authorities " +
      "(standing_authority_id, project_id, actor_id, operation, resource, purpose, " +
      "owner_revision, membership_revision, status, approval_ref, approved_by_actor_id, " +
      "valid_from, expires_at) " +
      "VALUES ($1,$2,$3,'memory.read',$4,$5,$6,$7,'ACTIVE',$8,$3,$9,$10)",
      [standingAuthorityId, projectId, actor.actorId, resource, purpose,
        owner.revision, membership.revision, approvalRef, validFrom, expiresAt]
    );
    const finalMembership = await client.query(
      "SELECT (status = 'ACTIVE' AND valid_from <= clock_timestamp() " +
      "AND (expires_at IS NULL OR expires_at > clock_timestamp())) AS membership_valid " +
      "FROM mira_hfm.project_memberships WHERE project_id = $1 AND actor_id = $2",
      [projectId, actor.actorId]
    );
    if (finalMembership.rows?.[0]?.membership_valid !== true) {
      fail('HFM_STANDING_READ_MEMBERSHIP_CHANGED_DURING_ISSUE');
    }
    await client.query('COMMIT');
    transactionOpen = false;
    return Object.freeze({
      status: 'STANDING_READ_AUTHORITY_ISSUED',
      standingAuthorityId,
      projectId,
      operation: 'memory.read',
      resource,
      purpose,
      durationDays: 365,
      validFrom: validFrom.toISOString(),
      expiresAt: expiresAt.toISOString(),
      recordTypes: Object.freeze(['learning_note', 'knowledge_item']),
      writesAllowed: false,
      requiresApprovalPerRead: false
    });
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
    }
    throw error;
  } finally {
    try { client.release(); } catch (_error) {}
  }
}

async function setStandingReadAuthorityStatus(options = {}) {
  requirePool(options.pool);
  const env = options.env || process.env;
  const admin = trustedAdmin(options.req, env);
  const actor = actorFrom(options.req);
  if (admin.actor.actorId !== actor.actorId) fail('HFM_STANDING_READ_ACTOR_MISMATCH');
  const authorityId = bounded(options.standingAuthorityId, 256);
  const nextStatus = options.status;
  if (!['ACTIVE', 'PAUSED', 'REVOKED'].includes(nextStatus)) {
    fail('HFM_STANDING_READ_STATUS_INVALID');
  }
  const client = await options.pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [admin.projectId]);
    await client.query("SELECT set_config('mira.actor_id', $1, true)", [actor.actorId]);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["hfm-standing-read:" + admin.projectId + ":" + actor.actorId]
    );
    const currentResult = await client.query(
      "SELECT standing_authority_id, status, expires_at, approval_ref, " +
      "(expires_at > clock_timestamp()) AS is_live " +
      "FROM mira_hfm.standing_read_authorities " +
      "WHERE standing_authority_id = $1 AND project_id = $2 AND actor_id = $3 FOR UPDATE",
      [authorityId, admin.projectId, actor.actorId]
    );
    const current = currentResult.rows?.[0];
    if (!current) fail('HFM_STANDING_READ_AUTHORITY_NOT_FOUND');
    if (current.status === 'REVOKED') fail('HFM_STANDING_READ_AUTHORITY_ALREADY_REVOKED');
    if (current.is_live !== true) fail('HFM_STANDING_READ_AUTHORITY_EXPIRED');
    if (current.status === nextStatus) {
      await client.query('COMMIT');
      transactionOpen = false;
      return Object.freeze({ status: 'UNCHANGED', standingAuthorityId: authorityId, authorityStatus: nextStatus });
    }
    if (current.status === 'PAUSED' && nextStatus === 'PAUSED') {
      fail('HFM_STANDING_READ_STATUS_INVALID');
    }
    const updated = await client.query(
      "UPDATE mira_hfm.standing_read_authorities SET status = $1, updated_at = clock_timestamp(), " +
      "paused_at = CASE WHEN $1 = 'PAUSED' THEN clock_timestamp() ELSE NULL END, " +
      "revoked_at = CASE WHEN $1 = 'REVOKED' THEN clock_timestamp() ELSE NULL END " +
      "WHERE standing_authority_id = $2 AND project_id = $3 AND actor_id = $4 " +
      "AND status IN ('ACTIVE','PAUSED') AND expires_at > clock_timestamp() RETURNING expires_at",
      [nextStatus, authorityId, admin.projectId, actor.actorId]
    );
    if (updated.rowCount !== 1) fail('HFM_STANDING_READ_STATUS_UPDATE_FAILED');
    await client.query('COMMIT');
    transactionOpen = false;
    return Object.freeze({
      status: 'STANDING_READ_AUTHORITY_UPDATED',
      standingAuthorityId: authorityId,
      authorityStatus: nextStatus,
      expiresAt: new Date(updated.rows[0].expires_at).toISOString()
    });
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
    }
    throw error;
  } finally {
    try { client.release(); } catch (_error) {}
  }
}


async function getStandingReadAuthorityStatus(options = {}) {
  requirePool(options.pool);
  const env = options.env || process.env;
  const admin = trustedAdmin(options.req, env);
  const actor = actorFrom(options.req);
  if (admin.actor.actorId !== actor.actorId) fail('HFM_STANDING_READ_ACTOR_MISMATCH');
  const client = await options.pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [admin.projectId]);
    await client.query("SELECT set_config('mira.actor_id', $1, true)", [actor.actorId]);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["hfm-standing-read:" + admin.projectId + ":" + actor.actorId]
    );
    const result = await client.query(
      "SELECT standing_authority_id, status, purpose, valid_from, expires_at " +
      "FROM mira_hfm.standing_read_authorities WHERE project_id = $1 AND actor_id = $2 " +
      "ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [admin.projectId, actor.actorId]
    );
    let row = result.rows?.[0] || null;
    if (row && ['ACTIVE', 'PAUSED'].includes(row.status)) {
      const expired = await client.query(
        "UPDATE mira_hfm.standing_read_authorities " +
        "SET status = 'EXPIRED', updated_at = clock_timestamp(), paused_at = NULL " +
        "WHERE standing_authority_id = $1 AND project_id = $2 AND actor_id = $3 " +
        "AND status IN ('ACTIVE','PAUSED') AND expires_at <= clock_timestamp() " +
        "RETURNING status, expires_at",
        [row.standing_authority_id, admin.projectId, actor.actorId]
      );
      if (expired.rowCount === 1) {
        row = { ...row, status: expired.rows[0].status, expires_at: expired.rows[0].expires_at };
      }
    }
    await client.query('COMMIT');
    transactionOpen = false;
    return Object.freeze({
      status: row ? 'STANDING_READ_AUTHORITY_FOUND' : 'STANDING_READ_AUTHORITY_NOT_FOUND',
      authority: row ? Object.freeze({
        standingAuthorityId: row.standing_authority_id,
        authorityStatus: row.status,
        purpose: row.purpose,
        validFrom: new Date(row.valid_from).toISOString(),
        expiresAt: new Date(row.expires_at).toISOString()
      }) : null
    });
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
    }
    throw error;
  } finally {
    try { client.release(); } catch (_error) {}
  }
}

module.exports = Object.freeze({
  STANDING_READ_TTL_MS,
  validateStandingReceipt,
  issueStandingReadAuthority,
  setStandingReadAuthorityStatus,
  getStandingReadAuthorityStatus
});
