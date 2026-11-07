"use strict";

// HFM authority consumption primitive.
// This is intentionally not wired to legacy Memory/Knowledge routes.
// The protected callback MUST use only the supplied transaction client;
// external side effects are forbidden because PostgreSQL rollback cannot undo them.
const { randomUUID } = require("node:crypto");
const { normalizeTrustedActorIdentity } = require("./mira-memory-host-identity-contract");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function bounded(value, name, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw fail("HFM_AUTHORITY_INPUT_INVALID");
  }
  return value.trim();
}

function validateRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw fail("HFM_AUTHORITY_INPUT_INVALID");
  }
  return Object.freeze({
    authorityId: bounded(input.authorityId, "authorityId", 256),
    projectId: bounded(input.projectId, "projectId", 256),
    operation: bounded(input.operation, "operation", 128),
    resource: bounded(input.resource, "resource", 512),
    purpose: bounded(input.purpose, "purpose", 512),
    requestId: bounded(input.requestId, "requestId", 256)
  });
}

function hasOperationPermission(permissions, operation) {
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return false;
  return Array.isArray(permissions.operations) &&
    permissions.operations.every(item => typeof item === "string") &&
    permissions.operations.includes(operation);
}

async function executeWithConsumedAuthority(options = {}) {
  const request = validateRequest(options.request);
  let trustedActor;
  try {
    // Caller must pass the server-held session principal, never a request-body actor ID.
    trustedActor = normalizeTrustedActorIdentity({ verifiedPrincipal: options.verifiedPrincipal });
  } catch (_error) {
    throw fail("HFM_TRUSTED_ACTOR_REQUIRED");
  }
  if (!options.pool || typeof options.pool.connect !== "function" ||
      typeof options.perform !== "function") {
    throw fail("HFM_AUTHORITY_EXECUTOR_NOT_CONFIGURED");
  }

  const client = await options.pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");

    // The requested project id is only a row filter here, not an authorization grant.
    // RLS scopes every project table before the owner/membership/authority checks.
    await client.query(
      "SELECT set_config('mira.project_id', $1, true)",
      [request.projectId]
    );
    // Actor scope is transaction-local and derived only from the verified session principal.
    await client.query(
      "SELECT set_config('mira.actor_id', $1, true)",
      [trustedActor.actorId]
    );
    await client.query("SELECT set_config('mira.operation', $1, true)", [request.operation]);
    await client.query("SELECT set_config('mira.resource', $1, true)", [request.resource]);
    await client.query("SELECT set_config('mira.request_id', $1, true)", [request.requestId]);

    // Read owner and membership under SERIALIZABLE isolation without row-lock privileges.
    // PostgreSQL SSI detects concurrent owner/membership changes and aborts a conflicting
    // transaction. The one-time authority row itself is locked before atomic consumption.
    const ownerResult = await client.query(
      "SELECT project_id, owner_actor_id, status, revision " +
      "FROM mira_hfm.project_owners WHERE project_id = $1",
      [request.projectId]
    );
    const owner = ownerResult.rows && ownerResult.rows[0];
    if (!owner || owner.status !== "ACTIVE") throw fail("HFM_PROJECT_OWNER_NOT_ACTIVE");

    const membershipResult = await client.query(
      "SELECT membership_id, project_id, actor_id, permissions, status, revision, " +
      "valid_from, expires_at FROM mira_hfm.project_memberships " +
      "WHERE project_id = $1 AND actor_id = $2 AND status = 'ACTIVE' AND valid_from <= clock_timestamp() AND (expires_at IS NULL OR expires_at > clock_timestamp())",
      [request.projectId, trustedActor.actorId]
    );
    const membership = membershipResult.rows && membershipResult.rows[0];
    if (!membership) throw fail("HFM_PROJECT_MEMBERSHIP_NOT_ACTIVE");
    if (!hasOperationPermission(membership.permissions, request.operation)) {
      throw fail("HFM_OPERATION_NOT_GRANTED");
    }

    const authorityResult = await client.query(
      "SELECT authority_id, project_id, actor_id, operation, resource, purpose, request_id, " +
      "membership_revision, owner_revision, status, approval_ref, valid_from, expires_at " +
      "FROM mira_hfm.operation_authorities WHERE authority_id = $1 AND project_id = $2 " +
      "AND actor_id = $3 AND request_id = $4 FOR UPDATE",
      [request.authorityId, request.projectId, trustedActor.actorId, request.requestId]
    );
    const authority = authorityResult.rows && authorityResult.rows[0];
    if (!authority || authority.status !== "ISSUED") {
      throw fail("HFM_AUTHORITY_MISSING_OR_ALREADY_USED");
    }
    if (authority.operation !== request.operation ||
        authority.resource !== request.resource ||
        authority.purpose !== request.purpose) {
      throw fail("HFM_AUTHORITY_SCOPE_MISMATCH");
    }
    if (String(authority.owner_revision) !== String(owner.revision) ||
        String(authority.membership_revision) !== String(membership.revision)) {
      throw fail("HFM_AUTHORITY_REVISION_STALE");
    }

    const consumeResult = await client.query(
      "UPDATE mira_hfm.operation_authorities SET status = 'CONSUMED', consumed_at = clock_timestamp() " +
      "WHERE authority_id = $1 AND project_id = $2 AND actor_id = $3 AND request_id = $4 " +
      "AND status = 'ISSUED' AND valid_from <= clock_timestamp() " +
      "AND expires_at > clock_timestamp() RETURNING authority_id",
      [request.authorityId, request.projectId, trustedActor.actorId, request.requestId]
    );
    if (!consumeResult.rowCount) throw fail("HFM_AUTHORITY_EXPIRED_OR_ALREADY_USED");

    await client.query(
      "INSERT INTO mira_hfm.authority_audit_events " +
      "(event_id, project_id, actor_id, event_type, request_id, occurred_at, " +
      "prior_revision, new_revision, approval_ref, details) " +
      "VALUES ($1, $2, $3, 'AUTHORITY_CONSUMED', $4, clock_timestamp(), $5, $6, $7, $8::jsonb)",
      [randomUUID(), request.projectId, trustedActor.actorId, request.requestId,
        owner.revision, membership.revision, authority.approval_ref,
        JSON.stringify({ authorityId: request.authorityId, operation: request.operation, resource: request.resource, ownerRevision: String(owner.revision), membershipRevision: String(membership.revision) })]
    );

    // All protected database reads/writes must use this same client/transaction.
    const value = await options.perform(client, Object.freeze({
      actorId: trustedActor.actorId,
      projectId: request.projectId,
      operation: request.operation,
      resource: request.resource,
      purpose: request.purpose,
      requestId: request.requestId,
      authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY'
    }));

    // Recheck time-bounded membership after the protected work and before commit.
    const finalMembership = await client.query(
      "SELECT (status = 'ACTIVE' AND valid_from <= clock_timestamp() " +
      "AND (expires_at IS NULL OR expires_at > clock_timestamp())) AS membership_valid " +
      "FROM mira_hfm.project_memberships WHERE membership_id = $1",
      [membership.membership_id]
    );
    if (!finalMembership.rows?.[0]?.membership_valid) {
      throw fail("HFM_MEMBERSHIP_EXPIRED_DURING_OPERATION");
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return { status: "AUTHORIZED_AND_COMMITTED", value };
  } catch (error) {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch (_rollbackError) {}
    }
    throw error;
  } finally {
    try { client.release(); } catch (_releaseError) {}
  }
}


const STANDING_READ_DENIAL_CODES = new Set([
  "HFM_PROJECT_OWNER_NOT_ACTIVE",
  "HFM_PROJECT_MEMBERSHIP_NOT_ACTIVE",
  "HFM_OPERATION_NOT_GRANTED",
  "HFM_STANDING_READ_AUTHORITY_MISSING_PAUSED_OR_EXPIRED",
  "HFM_STANDING_READ_AUTHORITY_REVISION_STALE",
  "HFM_STANDING_READ_AUTHORITY_SCOPE_MISMATCH",
  "HFM_MEMBERSHIP_EXPIRED_DURING_OPERATION"
]);

async function persistStandingReadFailureAudit(client, {
  projectId, actorId, resource, requestId, error
}) {
  const denied = STANDING_READ_DENIAL_CODES.has(error && error.code);
  const eventType = denied
    ? "STANDING_READ_AUTHORITY_DENIED"
    : "STANDING_READ_AUTHORITY_FAILED";
  const rawCode = error && typeof error.code === "string" ? error.code : "";
  const reasonCode = /^[A-Z0-9_]{1,128}$/.test(rawCode)
    ? rawCode
    : "HFM_STANDING_READ_FAILED";
  let auditTransactionOpen = false;
  try {
    await client.query("BEGIN");
    auditTransactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [projectId]);
    await client.query("SELECT set_config('mira.actor_id', $1, true)", [actorId]);
    await client.query("SELECT set_config('mira.operation', 'memory.read', true)");
    await client.query("SELECT set_config('mira.resource', $1, true)", [resource]);
    await client.query("SELECT set_config('mira.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('mira.standing_read_authority', 'true', true)");
    await client.query(
      "INSERT INTO mira_hfm.authority_audit_events " +
      "(event_id, project_id, actor_id, event_type, request_id, occurred_at, details) " +
      "VALUES ($1,$2,$3,$4,$5,clock_timestamp(),$6::jsonb)",
      [randomUUID(), projectId, actorId, eventType, requestId,
        JSON.stringify({ operation: "memory.read", resource, decision: denied ? "DENY" : "FAILED", reasonCode })]
    );
    await client.query("COMMIT");
    auditTransactionOpen = false;
    return "RECORDED";
  } catch (auditError) {
    if (auditTransactionOpen) {
      try { await client.query("ROLLBACK"); } catch (_rollbackError) {}
    }
    return "FAILED";
  }
}

async function executeWithStandingReadAuthority(options = {}) {
  const projectId = bounded(options.projectId, "projectId", 256);
  const resource = bounded(options.resource || ("memory:project:" + projectId), "resource", 512);
  if (resource !== "memory:project:" + projectId) throw fail("HFM_STANDING_READ_SCOPE_INVALID");
  let trustedActor;
  try {
    trustedActor = normalizeTrustedActorIdentity({ verifiedPrincipal: options.verifiedPrincipal });
  } catch (_error) {
    throw fail("HFM_TRUSTED_ACTOR_REQUIRED");
  }
  if (!options.pool || typeof options.pool.connect !== "function" ||
      typeof options.perform !== "function") {
    throw fail("HFM_AUTHORITY_EXECUTOR_NOT_CONFIGURED");
  }
  const requestId = randomUUID();
  const client = await options.pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [projectId]);
    await client.query("SELECT set_config('mira.actor_id', $1, true)", [trustedActor.actorId]);
    await client.query("SELECT set_config('mira.operation', 'memory.read', true)");
    await client.query("SELECT set_config('mira.resource', $1, true)", [resource]);
    await client.query("SELECT set_config('mira.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('mira.standing_read_authority', 'true', true)");

    const ownerResult = await client.query(
      "SELECT project_id, status, revision FROM mira_hfm.project_owners WHERE project_id = $1",
      [projectId]
    );
    const owner = ownerResult.rows && ownerResult.rows[0];
    if (!owner || owner.status !== "ACTIVE") throw fail("HFM_PROJECT_OWNER_NOT_ACTIVE");

    const membershipResult = await client.query(
      "SELECT membership_id, project_id, actor_id, permissions, status, revision, valid_from, expires_at " +
      "FROM mira_hfm.project_memberships WHERE project_id = $1 AND actor_id = $2 " +
      "AND status = 'ACTIVE' AND valid_from <= clock_timestamp() " +
      "AND (expires_at IS NULL OR expires_at > clock_timestamp())",
      [projectId, trustedActor.actorId]
    );
    const membership = membershipResult.rows && membershipResult.rows[0];
    if (!membership) throw fail("HFM_PROJECT_MEMBERSHIP_NOT_ACTIVE");
    if (!hasOperationPermission(membership.permissions, "memory.read")) {
      throw fail("HFM_OPERATION_NOT_GRANTED");
    }

    // Serialize each read against pause/resume/revoke without granting the
    // memory-reader role any UPDATE privilege on the authority table.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["hfm-standing-read:" + projectId + ":" + trustedActor.actorId]
    );
    const authorityResult = await client.query(
      "SELECT standing_authority_id, project_id, actor_id, operation, resource, purpose, " +
      "owner_revision, membership_revision, status, approval_ref, " +
      "to_char(valid_from AT TIME ZONE 'UTC', 'YYYY-MM-DD\\\"T\\\"HH24:MI:SS.US\\\"Z\\\"') AS valid_from_rfc3339, " +
      "to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\\\"T\\\"HH24:MI:SS.US\\\"Z\\\"') AS expires_at_rfc3339 " +
      "FROM mira_hfm.standing_read_authorities WHERE project_id = $1 AND actor_id = $2 " +
      "AND operation = 'memory.read' AND resource = $3 AND status = 'ACTIVE' " +
      "AND valid_from <= clock_timestamp() AND expires_at > clock_timestamp()",
      [projectId, trustedActor.actorId, resource]
    );
    const authority = authorityResult.rows && authorityResult.rows[0];
    if (!authority) throw fail("HFM_STANDING_READ_AUTHORITY_MISSING_PAUSED_OR_EXPIRED");
    if (String(authority.owner_revision) !== String(owner.revision) ||
        String(authority.membership_revision) !== String(membership.revision)) {
      throw fail("HFM_STANDING_READ_AUTHORITY_REVISION_STALE");
    }
    if (authority.actor_id !== trustedActor.actorId ||
        authority.project_id !== projectId ||
        authority.resource !== resource ||
        authority.operation !== "memory.read") {
      throw fail("HFM_STANDING_READ_AUTHORITY_SCOPE_MISMATCH");
    }

    await client.query(
      "INSERT INTO mira_hfm.authority_audit_events " +
      "(event_id, project_id, actor_id, event_type, request_id, occurred_at, " +
      "prior_revision, new_revision, approval_ref, details) " +
      "VALUES ($1,$2,$3,'STANDING_READ_AUTHORITY_USED',$4,clock_timestamp(),$5,$6,$7,$8::jsonb)",
      [randomUUID(), projectId, trustedActor.actorId, requestId,
        owner.revision, membership.revision, authority.approval_ref,
        JSON.stringify({
          standingAuthorityId: authority.standing_authority_id,
          operation: "memory.read",
          resource,
          purpose: authority.purpose,
          expiresAt: authority.expires_at_rfc3339,
          approvalPerRead: false
        })]
    );

    const value = await options.perform(client, Object.freeze({
      actorId: trustedActor.actorId,
      projectId,
      operation: "memory.read",
      resource,
      purpose: authority.purpose,
      requestId,
      authorityId: authority.standing_authority_id,
      approvalRef: authority.approval_ref,
      expiresAt: new Date(authority.expires_at).toISOString(),
      authorityContext: "HFM_ACTIVE_STANDING_READ_AUTHORITY"
    }));

    const finalMembership = await client.query(
      "SELECT (status = 'ACTIVE' AND valid_from <= clock_timestamp() " +
      "AND (expires_at IS NULL OR expires_at > clock_timestamp())) AS membership_valid " +
      "FROM mira_hfm.project_memberships WHERE membership_id = $1",
      [membership.membership_id]
    );
    if (!finalMembership.rows?.[0]?.membership_valid) {
      throw fail("HFM_MEMBERSHIP_EXPIRED_DURING_OPERATION");
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return {
      status: "AUTHORIZED_AND_COMMITTED",
      value,
      standingAuthorityId: authority.standing_authority_id,
      authorityExpiresAt: authority.expires_at_rfc3339,
      authorityConsumed: false,
      hostAuthorizationContext: Object.freeze({
        actorId: trustedActor.actorId,
        actorType: "HUMAN",
        projectId,
        purpose: authority.purpose,
        requestId,
        authorityRef: authority.standing_authority_id,
        issuedAt: authority.valid_from_rfc3339,
        expiresAt: new Date(authority.expires_at).toISOString()
      })
    };
  } catch (error) {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch (_rollbackError) {}
      transactionOpen = false;
    }
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.auditStatus = await persistStandingReadFailureAudit(client, {
      projectId,
      actorId: trustedActor.actorId,
      resource,
      requestId,
      error: failure
    });
    throw failure;
  } finally {
    try { client.release(); } catch (_releaseError) {}
  }
}

module.exports = { executeWithConsumedAuthority, executeWithStandingReadAuthority, validateRequest, hasOperationPermission };
