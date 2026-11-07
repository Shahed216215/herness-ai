'use strict';

const crypto = require('node:crypto');
const { buildTrustedActorContext } = require('../services/mira-hfm-runtime-identity-context');
const { issueAuthorityForTrustedActor } = require('./mira-hfm-authorities');
const { getAuthorityIssuerPool } = require('../services/mira-hfm-authority-issuer-pool');
const { getMemoryWriterPool } = require('../services/mira-hfm-memory-writer-pool');
const { executeWithConsumedAuthority } = require('../services/mira-hfm-authority-transaction');
const repository = require('../services/mira-hfm-memory-repository');
const { saveDailyKnowledgePost, dateInTimeZone } = require('../services/mira-hfm-daily-knowledge-post');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function projectFor(req, body, identity) {
  const supplied = body && body.projectId;
  const projectId = typeof supplied === 'string' && supplied.trim()
    ? supplied.trim() : identity.activeProjectId;
  if (typeof projectId !== 'string' || !/^hfm_[0-9a-f]{32}$/.test(projectId)) {
    throw fail('HFM_ACTIVE_PROJECT_REQUIRED');
  }
  return projectId;
}

function statusForError(error) {
  const code = String(error && error.code || '');
  if (/TRUSTED_ACTOR|OWNER|MEMBERSHIP|NOT_GRANTED|PERMISSION/.test(code)) return 403;
  if (/NOT_FOUND/.test(code)) return 404;
  if (/IDEMPOTENCY|CONFLICT/.test(code)) return 409;
  if (/WRITER|ISSUER|DATABASE|CONNECTION|TIMEOUT|KEY_NOT_CONFIGURED|VAULT_KEY/.test(code)) return 503;
  return 400;
}

function registerDailyKnowledgeRoutes(app, requireAgentAuth) {
  if (!app || typeof app.post !== 'function' || typeof requireAgentAuth !== 'function') {
    throw new Error('Authenticated Express POST route is required.');
  }
  app.post('/api/hfm/daily-knowledge/generate', requireAgentAuth, async (req, res) => {
    try {
      const identity = buildTrustedActorContext(req);
      if (identity.status !== 'ACTOR_RESOLVED') throw fail('HFM_TRUSTED_ACTOR_REQUIRED');
      const body = req.body || {};
      const projectId = projectFor(req, body, identity);
      const timeZone = typeof body.timeZone === 'string' && body.timeZone.trim()
        ? body.timeZone.trim() : 'Asia/Dhaka';
      const now = new Date().toISOString();
      const localDate = typeof body.localDate === 'string' && body.localDate.trim()
        ? body.localDate.trim() : dateInTimeZone(now, timeZone);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw fail('HFM_DAILY_POST_LOCAL_DATE_INVALID');
      const stableId = crypto.createHash('sha256').update(projectId + ':' + localDate, 'utf8').digest('hex').slice(0, 32);
      const memoryId = 'daily-post-' + stableId;
      const request = {
        projectId,
        operation: 'memory.write',
        resource: 'memory:' + memoryId,
        purpose: 'daily-knowledge-generate'
      };
      const grant = await issueAuthorityForTrustedActor({
        pool: await getAuthorityIssuerPool(),
        verifiedPrincipal: req.session.hfmPrincipal,
        request,
        sessionId: req.sessionID
      });
      const result = await executeWithConsumedAuthority({
        pool: await getMemoryWriterPool(),
        verifiedPrincipal: req.session.hfmPrincipal,
        request: grant,
        perform: async (client, context) => {
          const existing = await client.query(
            'SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, integrity_status, trust_status, public_payload, encrypted_envelope, created_at, updated_at FROM mira_hfm.memory_records WHERE project_id = $1 AND memory_id = $2',
            [projectId, memoryId]
          );
          const row = existing.rows && existing.rows[0];
          if (row) {
            return {
              status: row.lifecycle === 'TRASHED' ? 'EXISTS_IN_TRASH' : 'ALREADY_GENERATED',
              memoryId,
              revision: Number(row.revision)
            };
          }
          const sourceRows = await client.query(
            "SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, integrity_status, trust_status, public_payload, encrypted_envelope, created_at, updated_at FROM mira_hfm.memory_records WHERE project_id = $1 AND classification = 'PROJECT_PRIVATE' AND record_type IN ('daily_activity','learning_note') AND lifecycle = 'ACTIVE' AND integrity_status <> 'FAILED' AND trust_status <> 'QUARANTINED' ORDER BY updated_at DESC, memory_id ASC LIMIT 500",
            [projectId]
          );
          const records = (sourceRows.rows || []).map(source =>
            repository.decodeStoredRow(source, { allowPrivateRead: true, env: process.env })
          );
          return saveDailyKnowledgePost({
            client,
            context,
            records,
            projectId,
            localDate,
            timeZone,
            now,
            allowPrivateWrite: true,
            env: process.env
          });
        }
      });
      if (result.status !== 'AUTHORIZED_AND_COMMITTED') throw fail('HFM_DAILY_POST_NOT_COMMITTED');
      return res.json({ ok: true, ...result.value });
    } catch (error) {
      return res.status(statusForError(error)).json({
        ok: false, code: error && error.code || 'HFM_DAILY_KNOWLEDGE_GENERATION_FAILED'
      });
    }
  });
}

module.exports = registerDailyKnowledgeRoutes;
