"use strict";

// HFM authority consumption primitive.
// This is intentionally not wired to legacy Memory/Knowledge routes.
// The protected callback MUST use only the supplied transaction client;
// external side effects are forbidden because PostgreSQL rollback cannot undo them.
const { randomUUID } = require("node:crypto");

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
    actorId: bounded(input.actorId, "actorId", 512),
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

    // Deterministic lock order: project owner -> actor membership -> one-time authority.
    // Revocation/owner revision updates must lock these same rows, so they cannot race
    // between validation and the protected operation's commit.
    const ownerResult = await client.query(
      "SELECT project_id, owner_actor_id, status, revision " +
      "FROM mira_hfm.project_owners WHERE project_id = $1 FOR UPDATE",
      [request.projectId]
    );
    const owner = ownerResult.rows && ownerResult.rows[0];
    if (!owner || owner.status !== "ACTIVE") throw fail("HFM_PROJECT_OWNER_NOT_ACTIVE");

    const membershipResult = await client.query(
      "SELECT membership_id, project_id, actor_id, permissions, status, revision, " +
      "valid_from, expires_at FROM mira_hfm.project_memberships " +
      "WHERE project_id = $1 AND actor_id = $2 AND status = 'ACTIVE' FOR UPDATE",
      [request.projectId, request.actorId]
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
      [request.authorityId, request.projectId, request.actorId, request.requestId]
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
      "WHERE authority_id = $1 AND status = 'ISSUED' " +
      "AND valid_from <= clock_timestamp() AND expires_at > clock_timestamp() " +
      "RETURNING authority_id",
      [request.authorityId]
    );
    if (!consumeResult.rowCount) throw fail("HFM_AUTHORITY_EXPIRED_OR_ALREADY_USED");

    await client.query(
      "INSERT INTO mira_hfm.authority_audit_events " +
      "(event_id, project_id, actor_id, event_type, request_id, occurred_at, " +
      "prior_revision, new_revision, approval_ref, details) " +
      "VALUES ($1, $2, $3, 'AUTHORITY_CONSUMED', $4, clock_timestamp(), $5, $6, $7, $8::jsonb)",
      [randomUUID(), request.projectId, request.actorId, request.requestId,
        Number(membership.revision), Number(membership.revision), authority.approval_ref,
        JSON.stringify({ authorityId: request.authorityId, operation: request.operation, resource: request.resource })]
    );

    // All protected database reads/writes must use this same client/transaction.
    const value = await options.perform(client, Object.freeze({
      actorId: request.actorId,
      projectId: request.projectId,
      operation: request.operation,
      resource: request.resource,
      purpose: request.purpose,
      requestId: request.requestId
    }));
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

module.exports = { executeWithConsumedAuthority, validateRequest, hasOperationPermission };
