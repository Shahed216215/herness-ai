'use strict';

const crypto = require('node:crypto');
const { buildTrustedActorContext } = require('../services/mira-hfm-runtime-identity-context');
const { normalizeTrustedActorIdentity } = require('../services/mira-memory-host-identity-contract');

const PURPOSES = Object.freeze({
  'memory.read': new Set(['facebook-knowledge-search','facebook-public-web-search','facebook-knowledge-read']),
  'memory.write': new Set(['facebook-knowledge-import']),
  'memory.update': new Set(['facebook-knowledge-update']),
  'memory.trash': new Set(['facebook-knowledge-trash']),
  'memory.restore': new Set(['facebook-knowledge-restore'])
});
const ALLOWED_OPERATIONS = Object.freeze(Object.keys(PURPOSES));

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > max) {
    throw fail('HFM_AUTHORITY_ISSUE_REQUEST_INVALID');
  }
  return value;
}

function validateIssueRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('HFM_AUTHORITY_ISSUE_REQUEST_INVALID');
  const projectId = text(input.projectId, 128);
  const operation = text(input.operation, 128);
  const resource = text(input.resource, 512);
  const purpose = text(input.purpose, 128);
  if (!ALLOWED_OPERATIONS.includes(operation) || !PURPOSES[operation].has(purpose)) {
    throw fail('HFM_AUTHORITY_ISSUE_SCOPE_NOT_ALLOWED');
  }
  const projectResource = 'memory:project:' + projectId;
  const validResource = operation === 'memory.read'
    ? resource === projectResource || /^memory:[A-Za-z0-9_-]{8,128}$/.test(resource)
    : /^memory:[A-Za-z0-9_-]{8,128}$/.test(resource);
  if (!validResource) throw fail('HFM_AUTHORITY_ISSUE_RESOURCE_INVALID');
  return Object.freeze({ projectId, operation, resource, purpose });
}

function hasPermission(permissions, operation) {
  return Boolean(permissions && Array.isArray(permissions.operations) &&
    permissions.operations.every(item => typeof item === 'string') &&
    permissions.operations.includes(operation));
}

async function issueAuthorityForTrustedActor(options = {}) {
  const request = validateIssueRequest(options.request);
  let actor;
  try {
    actor = normalizeTrustedActorIdentity({ verifiedPrincipal: options.verifiedPrincipal });
  } catch (_error) {
    throw fail('HFM_TRUSTED_ACTOR_REQUIRED');
  }
  const pool = options.pool;
  if (!pool || typeof pool.connect !== 'function') throw fail('AUTHORITY_ISSUER_NOT_READY');
  const client = await pool.connect();
  let open = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    open = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [request.projectId]);
    const ownerResult = await client.query(
      "SELECT owner_actor_id, status, revision FROM mira_hfm.project_owners WHERE project_id = $1 FOR SHARE",
      [request.projectId]
    );
    const owner = ownerResult.rows && ownerResult.rows[0];
    if (!owner || owner.status !== 'ACTIVE' || owner.owner_actor_id !== actor.actorId) {
      throw fail('HFM_PROJECT_OWNER_APPROVAL_REQUIRED');
    }
    const membershipResult = await client.query(
      "SELECT membership_id, permissions, revision FROM mira_hfm.project_memberships WHERE project_id = $1 AND actor_id = $2 AND status = 'ACTIVE' AND valid_from <= clock_timestamp() AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR SHARE",
      [request.projectId, actor.actorId]
    );
    const membership = membershipResult.rows && membershipResult.rows[0];
    if (!membership) throw fail('HFM_PROJECT_MEMBERSHIP_NOT_ACTIVE');
    if (!hasPermission(membership.permissions, request.operation)) throw fail('HFM_OPERATION_NOT_GRANTED');

    const authorityId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const approvalRef = 'authenticated-owner-session:' + requestId;
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 90000);
    await client.query(
      "INSERT INTO mira_hfm.operation_authorities (authority_id, project_id, actor_id, operation, resource, purpose, request_id, membership_revision, owner_revision, status, issued_by_actor_id, approval_ref, valid_from, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ISSUED',$3,$10,$11,$12)",
      [authorityId, request.projectId, actor.actorId, request.operation,
        request.resource, request.purpose, requestId, membership.revision,
        owner.revision, approvalRef, issuedAt.toISOString(), expiresAt.toISOString()]
    );
    await client.query(
      "INSERT INTO mira_hfm.authority_audit_events (event_id, project_id, actor_id, event_type, request_id, occurred_at, prior_revision, new_revision, approval_ref, evidence_ref, details) VALUES ($1,$2,$3,'AUTHORITY_ISSUED',$4,clock_timestamp(),$5,$5,$6,$7,$8::jsonb)",
      [crypto.randomUUID(), request.projectId, actor.actorId, requestId,
        owner.revision, approvalRef, 'session:' + (options.sessionId || 'agent-context'),
        JSON.stringify({ authorityId, operation: request.operation, resource: request.resource, purpose: request.purpose, expiresAt: expiresAt.toISOString() })]
    );
    await client.query('COMMIT');
    open = false;
    return Object.freeze({
      authorityId, requestId, projectId: request.projectId,
      operation: request.operation, resource: request.resource,
      purpose: request.purpose, expiresAt: expiresAt.toISOString(), singleUse: true
    });
  } catch (error) {
    if (open) { try { await client.query('ROLLBACK'); } catch (_rollbackError) {} }
    throw error;
  } finally {
    try { client.release(); } catch (_error) {}
  }
}

function statusForError(error) {
  const code = String(error && error.code || '');
  if (/TRUSTED_ACTOR|OWNER|MEMBERSHIP|NOT_GRANTED|PERMISSION/.test(code)) return 403;
  if (/PREFLIGHT|ISSUER|DATABASE|CONNECTION|TIMEOUT/.test(code)) return 503;
  if (/CONFLICT|SERIALIZATION/.test(code)) return 409;
  return 400;
}

function registerHfmAuthorityRoutes(app, requireAgentAuth, options = {}) {
  if (!app || typeof app.post !== 'function' || typeof requireAgentAuth !== 'function' ||
      typeof options.getPool !== 'function') {
    throw new Error('Authenticated Express POST route and authority issuer pool are required.');
  }
  app.post('/api/hfm/authorities/issue', requireAgentAuth, async (req, res) => {
    try {
      const identity = buildTrustedActorContext(req);
      if (identity.status !== 'ACTOR_RESOLVED') throw fail('HFM_TRUSTED_ACTOR_REQUIRED');
      const grant = await issueAuthorityForTrustedActor({
        pool: await options.getPool(),
        verifiedPrincipal: req.session.hfmPrincipal,
        request: req.body,
        sessionId: req.sessionID
      });
      return res.status(201).json({ ok: true, ...grant });
    } catch (error) {
      return res.status(statusForError(error)).json({
        ok: false, code: error && error.code || 'HFM_AUTHORITY_ISSUE_FAILED'
      });
    }
  });
}

module.exports = Object.freeze({
  PURPOSES, ALLOWED_OPERATIONS, validateIssueRequest, hasPermission,
  issueAuthorityForTrustedActor, registerHfmAuthorityRoutes
});
