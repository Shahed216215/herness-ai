'use strict';

const crypto = require('node:crypto');
const { buildTrustedActorContext } = require('../services/mira-hfm-runtime-identity-context');
const { normalizeTrustedActorIdentity } = require('../services/mira-memory-host-identity-contract');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateProjectId(value) {
  if (typeof value !== 'string' || !/^hfm_[0-9a-f]{32}$/.test(value)) {
    throw fail('HFM_PROJECT_ID_INVALID');
  }
  return value;
}

function saveSession(session) {
  if (!session || typeof session.save !== 'function') throw fail('HFM_SESSION_PERSISTENCE_REQUIRED');
  return new Promise((resolve, reject) => {
    session.save(error => error ? reject(fail('HFM_ACTIVE_PROJECT_SESSION_SAVE_FAILED')) : resolve());
  });
}

async function createOwnedProject(options = {}) {
  const projectId = validateProjectId(options.projectId);
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
  let created = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    open = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [projectId]);
    await client.query('SELECT pg_advisory_xact_lock(74291, hashtext($1))', [projectId]);

    const existing = await client.query(
      'SELECT owner_actor_id, status, revision FROM mira_hfm.project_owners WHERE project_id = $1',
      [projectId]
    );
    if (existing.rows && existing.rows[0]) {
      const owner = existing.rows[0];
      if (owner.owner_actor_id !== actor.actorId || owner.status !== 'ACTIVE') {
        throw fail('HFM_PROJECT_ID_ALREADY_OWNED');
      }
      const membership = await client.query(
        "SELECT membership_id, status, permissions FROM mira_hfm.project_memberships WHERE project_id = $1 AND actor_id = $2",
        [projectId, actor.actorId]
      );
      if (!membership.rows?.[0] || membership.rows[0].status !== 'ACTIVE') {
        throw fail('HFM_PROJECT_MEMBERSHIP_REPAIR_REQUIRED');
      }
      const requiredOperations = ['memory.read','memory.write','memory.update','memory.trash','memory.restore','memory.social_post.copy','memory.social_post.confirm_published','memory.social_post.delete_payload'];
      if (!requiredOperations.every(operation => Array.isArray(membership.rows[0].permissions?.operations) && membership.rows[0].permissions.operations.includes(operation))) {
        throw fail('HFM_PROJECT_PERMISSION_REPAIR_REQUIRED');
      }
      await client.query('COMMIT');
      open = false;
      return Object.freeze({ status: 'ALREADY_EXISTS', projectId, actorId: actor.actorId });
    }

    const now = new Date().toISOString();
    const requestId = crypto.randomUUID();
    const membershipId = 'mbr_' + crypto.randomUUID().replace(/-/g, '');
    const approvalRef = 'authenticated-session-project-create:' + requestId;
    const evidenceRef = 'session:' + (options.sessionId || 'authenticated-session');
    const permissions = {
      operations: ['memory.read', 'memory.write', 'memory.update', 'memory.trash', 'memory.restore', 'memory.social_post.copy', 'memory.social_post.confirm_published', 'memory.social_post.delete_payload']
    };
    await client.query(
      'INSERT INTO mira_hfm.project_owners (project_id, owner_actor_id, status, revision, assignment_evidence_ref, approval_ref, assigned_by_actor_id, assigned_at, updated_at) VALUES ($1,$2,\'ACTIVE\',1,$3,$4,$2,$5,$5)',
      [projectId, actor.actorId, evidenceRef, approvalRef, now]
    );
    await client.query(
      "INSERT INTO mira_hfm.project_memberships (membership_id, project_id, actor_id, membership_role, permissions, status, revision, valid_from, expires_at, granted_by_actor_id, approval_ref) VALUES ($1,$2,$3,'ADMIN',$4::jsonb,'ACTIVE',1,$5,NULL,$3,$6)",
      [membershipId, projectId, actor.actorId, JSON.stringify(permissions), now, approvalRef]
    );
    await client.query(
      "INSERT INTO mira_hfm.authority_audit_events (event_id, project_id, actor_id, event_type, request_id, occurred_at, prior_revision, new_revision, approval_ref, evidence_ref, details) VALUES ($1,$2,$3,'PROJECT_OWNER_ASSIGNED',$4,clock_timestamp(),NULL,1,$5,$6,$7::jsonb)",
      [crypto.randomUUID(), projectId, actor.actorId, requestId, approvalRef, evidenceRef,
        JSON.stringify({ membershipId, role: 'ADMIN', grantedOperations: permissions.operations })]
    );
    await client.query('COMMIT');
    open = false;
    created = true;
    return Object.freeze({ status: 'CREATED', projectId, actorId: actor.actorId, created });
  } catch (error) {
    if (open) { try { await client.query('ROLLBACK'); } catch (_rollbackError) {} }
    throw error;
  } finally {
    try { client.release(); } catch (_error) {}
  }
}

function statusForError(error) {
  const code = String(error && error.code || '');
  if (/TRUSTED_ACTOR/.test(code)) return 403;
  if (/ALREADY_OWNED|CONFLICT/.test(code)) return 409;
  if (/ISSUER|SESSION|DATABASE|CONNECTION/.test(code)) return 503;
  return 400;
}

function registerHfmProjectRoutes(app, requireAgentAuth, options = {}) {
  if (!app || typeof app.post !== 'function' || typeof app.get !== 'function' ||
      typeof requireAgentAuth !== 'function' || typeof options.getPool !== 'function') {
    throw new Error('Authenticated project routes and authority issuer pool are required.');
  }
  app.post('/api/hfm/projects/create', requireAgentAuth, async (req, res) => {
    try {
      const identity = buildTrustedActorContext(req);
      if (identity.status !== 'ACTOR_RESOLVED') throw fail('HFM_TRUSTED_ACTOR_REQUIRED');
      const projectId = validateProjectId(req.body && req.body.projectId);
      const result = await createOwnedProject({
        pool: await options.getPool(),
        verifiedPrincipal: req.session.hfmPrincipal,
        projectId,
        sessionId: req.sessionID
      });
      req.session.hfmActiveProjectId = projectId;
      await saveSession(req.session);
      return res.status(result.status === 'CREATED' ? 201 : 200).json({
        ok: true, status: result.status, projectId
      });
    } catch (error) {
      return res.status(statusForError(error)).json({
        ok: false, code: error && error.code || 'HFM_PROJECT_CREATE_FAILED'
      });
    }
  });
  app.get('/api/hfm/projects/active', requireAgentAuth, (req, res) => {
    const identity = buildTrustedActorContext(req);
    if (identity.status !== 'ACTOR_RESOLVED') {
      return res.status(403).json({ ok: false, code: 'HFM_TRUSTED_ACTOR_REQUIRED' });
    }
    const projectId = req.session.hfmActiveProjectId;
    return res.json({
      ok: true,
      projectId: typeof projectId === 'string' && /^hfm_[0-9a-f]{32}$/.test(projectId) ? projectId : null
    });
  });
}

module.exports = Object.freeze({ validateProjectId, createOwnedProject, registerHfmProjectRoutes });
