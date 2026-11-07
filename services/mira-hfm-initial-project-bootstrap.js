'use strict';

const crypto = require('node:crypto');
const { buildTrustedActorContext } = require('./mira-hfm-runtime-identity-context');
const { normalizeTrustedActorIdentity } = require('./mira-memory-host-identity-contract');

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const MAX_REAUTH_AGE_MS = 5 * 60 * 1000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function resolveBootstrapAdmin(req, env = process.env, now = Date.now()) {
  if (!req || typeof req !== 'object' || !req.session ||
      req.session.authenticated !== true || req.session.role !== 'admin' ||
      req.role !== 'admin') {
    fail('HFM_BOOTSTRAP_ADMIN_SESSION_REQUIRED');
  }
  const identity = buildTrustedActorContext(req);
  if (identity.status !== 'ACTOR_RESOLVED' || identity.actor.role !== 'admin') {
    fail('HFM_BOOTSTRAP_VERIFIED_ADMIN_REQUIRED');
  }
  let actor;
  try {
    actor = normalizeTrustedActorIdentity({
      verifiedPrincipal: req.session.hfmPrincipal,
      now: new Date(now)
    });
  } catch (_error) {
    fail('HFM_BOOTSTRAP_TRUSTED_ADMIN_REQUIRED');
  }
  const principal = req.session.hfmPrincipal;
  if (principal.issuer !== 'mira.admins' ||
      typeof env.MIRA_ADMIN_SUBJECT_ID !== 'string' ||
      env.MIRA_ADMIN_SUBJECT_ID.trim() !== principal.subject) {
    fail('HFM_BOOTSTRAP_ADMIN_SUBJECT_NOT_CONFIGURED');
  }
  const authenticatedAt = Date.parse(principal.authenticatedAt);
  if (!Number.isFinite(authenticatedAt) || authenticatedAt > now ||
      now - authenticatedAt > MAX_REAUTH_AGE_MS) {
    fail('HFM_BOOTSTRAP_RECENT_AUTHENTICATION_REQUIRED');
  }
  return Object.freeze({ actorId: actor.actorId, subject: principal.subject });
}

function validateProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value.trim())) {
    fail('HFM_BOOTSTRAP_PROJECT_ID_INVALID');
  }
  return value.trim();
}

async function bootstrapInitialHfmProject(options = {}) {
  if (options.confirm !== true) fail('HFM_BOOTSTRAP_EXPLICIT_CONFIRMATION_REQUIRED');
  const env = options.env || process.env;
  const { actorId } = resolveBootstrapAdmin(options.req, env);
  const projectId = validateProjectId(options.projectId);
  const pool = options.pool;
  if (!pool || typeof pool.connect !== 'function') {
    fail('HFM_BOOTSTRAP_POOL_REQUIRED');
  }

  const approvalRef = 'hfm-bootstrap-' + crypto.randomUUID();
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [projectId]);
    await client.query("SELECT set_config('mira.actor_id', $1, true)", [actorId]);
    await client.query("SELECT set_config('mira.bootstrap_approval_ref', $1, true)", [approvalRef]);

    const latch = await client.query(
      "INSERT INTO mira_hfm.bootstrap_registry (bootstrap_key, project_id, actor_id, approval_ref) " +
      "VALUES ('initial', $1, $2, $3)",
      [projectId, actorId, approvalRef]
    );
    if (latch.rowCount !== 1) fail('HFM_BOOTSTRAP_SINGLE_USE_LATCH_NOT_ACQUIRED');

    const now = new Date();
    const owner = await client.query(
      "INSERT INTO mira_hfm.project_owners " +
      "(project_id, owner_actor_id, status, revision, assignment_evidence_ref, approval_ref, " +
      "assigned_by_actor_id, assigned_at, updated_at) " +
      "VALUES ($1,$2,'ACTIVE',1,$3,$4,$2,$5,$5)",
      [projectId, actorId, 'bootstrap:' + approvalRef, approvalRef, now]
    );
    if (owner.rowCount !== 1) fail('HFM_BOOTSTRAP_OWNER_INSERT_FAILED');

    const membership = await client.query(
      "INSERT INTO mira_hfm.project_memberships " +
      "(membership_id, project_id, actor_id, membership_role, permissions, status, revision, " +
      "valid_from, expires_at, granted_by_actor_id, approval_ref) " +
      "VALUES ($1,$2,$3,'ADMIN',$4::jsonb,'ACTIVE',1,$5,NULL,$3,$6)",
      [crypto.randomUUID(), projectId, actorId,
        JSON.stringify({ operations: ['memory.read', 'memory.write', 'memory.trash', 'memory.restore'] }), now, approvalRef]
    );
    if (membership.rowCount !== 1) fail('HFM_BOOTSTRAP_ADMIN_MEMBERSHIP_INSERT_FAILED');

    const audit = await client.query(
      "INSERT INTO mira_hfm.authority_audit_events " +
      "(event_id, project_id, actor_id, event_type, request_id, occurred_at, approval_ref, details) " +
      "VALUES ($1,$2,$3,'PROJECT_BOOTSTRAPPED',$4,clock_timestamp(),$5,$6::jsonb)",
      [crypto.randomUUID(), projectId, actorId, crypto.randomUUID(), approvalRef,
        JSON.stringify({
          bootstrapVersion: 'HFM_INITIAL_PROJECT_V1',
          ownerActorId: actorId,
          membershipRole: 'ADMIN',
          permissions: ['memory.read', 'memory.write', 'memory.trash', 'memory.restore'],
          oneTimeOnly: true
        })]
    );
    if (audit.rowCount !== 1) fail('HFM_BOOTSTRAP_AUDIT_INSERT_FAILED');

    await client.query('COMMIT');
    transactionOpen = false;
    return Object.freeze({
      status: 'HFM_INITIAL_PROJECT_BOOTSTRAPPED',
      projectId,
      ownerActorId: actorId,
      membershipRole: 'ADMIN',
      permissions: Object.freeze(['memory.read', 'memory.write', 'memory.trash', 'memory.restore']),
      approvalRef,
      oneTimeOnly: true,
      memoryRecordsImported: 0
    });
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
    }
    if (error && error.code === '23505') {
      fail('HFM_BOOTSTRAP_ALREADY_CONSUMED');
    }
    throw error;
  } finally {
    try { client.release(); } catch (_releaseError) {}
  }
}

module.exports = Object.freeze({
  PROJECT_ID_PATTERN,
  MAX_REAUTH_AGE_MS,
  resolveBootstrapAdmin,
  validateProjectId,
  bootstrapInitialHfmProject
});
