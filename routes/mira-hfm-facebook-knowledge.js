'use strict';

const crypto = require('node:crypto');
const { buildTrustedActorContext } = require('../services/mira-hfm-runtime-identity-context');
const { executeWithConsumedAuthority } = require('../services/mira-hfm-authority-transaction');
const knowledge = require('../services/mira-hfm-facebook-knowledge');
const repository = require('../services/mira-hfm-memory-repository');
const { createContentHash } = require('../services/mira-hfm-record-schema');

const PURPOSE = Object.freeze({
  IMPORT: 'facebook-knowledge-import',
  SEARCH: 'facebook-knowledge-search',
  RESEARCH: 'facebook-public-web-search',
  READ: 'facebook-knowledge-read',
  UPDATE: 'facebook-knowledge-update',
  DELETE: 'facebook-knowledge-trash',
  RESTORE: 'facebook-knowledge-restore'
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function text(value, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > max) {
    throw fail('HFM_FACEBOOK_KNOWLEDGE_REQUEST_INVALID');
  }
  return value;
}

function statusForError(error) {
  const code = String(error && error.code || '');
  if (/NOT_FOUND/.test(code)) return 404;
  if (/AUTHORITY|AUTHORIZATION|TRUSTED_ACTOR|MEMBERSHIP|NOT_GRANTED|PERMISSION|OWNER|PROJECT_SCOPE/.test(code)) return 403;
  if (/DUPLICATE|IDEMPOTENCY|CONFLICT|ALREADY/.test(code)) return 409;
  if (/UNKNOWN|PREFLIGHT|WRITER|DATABASE|CONNECTION|TIMEOUT/.test(code)) return 503;
  return 400;
}

function registerFacebookKnowledgeRoutes(app, requireAgentAuth, options = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function' || typeof app.delete !== 'function') {
    throw new Error('Express app with GET, POST and DELETE routes is required.');
  }
  if (typeof requireAgentAuth !== 'function' || typeof options.getPool !== 'function') {
    throw new Error('Authenticated middleware and HFM writer pool resolver are required.');
  }

  async function perform(req, input, operation, resource, purpose, callback) {
    const identity = buildTrustedActorContext(req);
    if (identity.status !== 'ACTOR_RESOLVED') throw fail('HFM_TRUSTED_ACTOR_REQUIRED');
    const pool = await options.getPool();
    if (!pool || typeof pool.connect !== 'function') throw fail('MEMORY_WRITER_NOT_READY');
    const result = await executeWithConsumedAuthority({
      pool,
      verifiedPrincipal: req.session.hfmPrincipal,
      request: {
        authorityId: text(input.authorityId),
        projectId: text(input.projectId),
        operation,
        resource,
        purpose,
        requestId: text(input.requestId)
      },
      perform: callback
    });
    if (result.status !== 'AUTHORIZED_AND_COMMITTED') throw fail('HFM_FACEBOOK_KNOWLEDGE_NOT_COMMITTED');
    return result.value;
  }

  function sendError(res, error) {
    return res.status(statusForError(error)).json({
      ok: false,
      code: error && error.code || 'HFM_FACEBOOK_KNOWLEDGE_FAILED'
    });
  }

  app.post('/api/hfm/facebook-knowledge/import', requireAgentAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const memoryId = text(body.memoryId, 128);
      const projectId = text(body.projectId);
      const value = await perform(req, body, 'memory.write', 'memory:' + memoryId, PURPOSE.IMPORT,
        (client, context) => knowledge.ingestFacebookKnowledge({
          client, context, memoryId,
          content: body.content,
          sourceType: body.sourceType,
          sourceId: body.sourceId,
          sourceUrl: body.sourceUrl,
          collectionMethod: body.collectionMethod || 'manual_copy',
          publicContentConfirmed: body.publicContentConfirmed === true,
          originalPublishedAt: body.originalPublishedAt || null,
          idempotencyKey: text(body.idempotencyKey),
          now: new Date().toISOString()
        }));
      return res.status(value.status === 'DUPLICATE' ? 200 : 201).json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.get('/api/hfm/facebook-knowledge/research', requireAgentAuth, async (req, res) => {
    try {
      const projectId = text(req.query.projectId);
      const authorization = await perform(req, req.query, 'memory.read',
        'memory:project:' + projectId, PURPOSE.RESEARCH,
        async () => ({ status: 'AUTHORIZED' }));
      if (authorization.status !== 'AUTHORIZED') throw fail('HFM_FACEBOOK_RESEARCH_AUTHORIZATION_FAILED');
      const value = await knowledge.researchFacebookSource({
        sourceUrl: req.query.sourceUrl
      });
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.get('/api/hfm/facebook-knowledge/search', requireAgentAuth, async (req, res) => {
    try {
      const projectId = text(req.query.projectId);
      const value = await perform(req, req.query, 'memory.read',
        'memory:project:' + projectId, PURPOSE.SEARCH,
        (client, context) => knowledge.searchFacebookKnowledge({
          client, context, query: req.query.q,
          limit: Number(req.query.limit) || 10
        }));
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.get('/api/hfm/facebook-knowledge/history', requireAgentAuth, async (req, res) => {
    try {
      const projectId = text(req.query.projectId);
      const value = await perform(req, req.query, 'memory.read',
        'memory:project:' + projectId, PURPOSE.READ,
        async (client, context) => {
          const result = await client.query(
            "SELECT event_type, memory_id, result_status, occurred_at, details FROM mira_hfm.memory_audit_events WHERE project_id = $1 AND actor_id = $2 AND details ->> 'recordType' = 'knowledge_item' ORDER BY event_sequence DESC LIMIT 50",
            [context.projectId, context.actorId]
          );
          return {
            status: 'FOUND',
            events: (result.rows || []).map(row => ({
              eventType: row.event_type,
              memoryId: row.memory_id,
              resultStatus: row.result_status,
              occurredAt: row.occurred_at,
              revision: row.details && row.details.revision ? row.details.revision : null
            }))
          };
        });
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.get('/api/hfm/facebook-knowledge/:memoryId', requireAgentAuth, async (req, res) => {
    try {
      const memoryId = text(req.params.memoryId, 128);
      const projectId = text(req.query.projectId);
      const value = await perform(req, req.query, 'memory.read', 'memory:' + memoryId, PURPOSE.READ,
        async (client, context) => {
          const found = await repository.getMemoryRecord({ client, context, memoryId });
          if (found.status !== 'FOUND' || found.record.recordType !== 'knowledge_item' ||
              found.record.access.classification !== 'PUBLIC') return { status: 'NOT_FOUND' };
          return { status: 'FOUND', record: found.record };
        });
      if (value.status === 'NOT_FOUND') return res.status(404).json({ ok: false, code: 'HFM_KNOWLEDGE_NOT_FOUND' });
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.post('/api/hfm/facebook-knowledge/:memoryId/update', requireAgentAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const memoryId = text(req.params.memoryId, 128);
      const value = await perform(req, body, 'memory.update', 'memory:' + memoryId, PURPOSE.UPDATE,
        async (client, context) => {
          const current = await client.query(
            "SELECT memory_id, project_id, owner_actor_id, record_type, schema_version, classification, lifecycle, revision, integrity_status, trust_status, public_payload, encrypted_envelope, created_at, updated_at FROM mira_hfm.memory_records WHERE project_id = $1 AND memory_id = $2 FOR UPDATE",
            [context.projectId, memoryId]
          );
          const row = current.rows && current.rows[0];
          if (!row || row.record_type !== 'knowledge_item' || row.classification !== 'PUBLIC') {
            throw fail('HFM_KNOWLEDGE_NOT_FOUND');
          }
          const previous = repository.decodeStoredRow(row);
          const clean = knowledge.redactSensitiveText(body.content);
          const now = new Date().toISOString();
          const next = {
            ...previous,
            content: clean.content,
            timestamps: { ...previous.timestamps, updatedAt: now },
            version: { revision: Number(row.revision) + 1, contentHash: createContentHash(clean.content) },
            integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' },
            trust: { status: 'SOURCE_RECORDED' },
            provenance: previous.provenance ? {
              ...previous.provenance,
              capturedAt: now,
              collectionMethod: 'manual_copy',
              verificationStatus: 'SOURCE_RECORDED',
              redactionApplied: clean.redacted
            } : undefined
          };
          return repository.reviseMemoryRecord({
            client, context, memoryId, record: next,
            idempotencyKey: text(body.idempotencyKey)
          });
        });
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.delete('/api/hfm/facebook-knowledge/:memoryId', requireAgentAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const memoryId = text(req.params.memoryId, 128);
      const value = await perform(req, body, 'memory.trash', 'memory:' + memoryId, PURPOSE.DELETE,
        (client, context) => repository.trashMemoryRecord({
          client, context, memoryId, idempotencyKey: text(body.idempotencyKey)
        }));
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });

  app.post('/api/hfm/facebook-knowledge/:memoryId/restore', requireAgentAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const memoryId = text(req.params.memoryId, 128);
      const value = await perform(req, body, 'memory.restore', 'memory:' + memoryId, PURPOSE.RESTORE,
        (client, context) => repository.restoreMemoryRecord({
          client, context, memoryId, idempotencyKey: text(body.idempotencyKey)
        }));
      return res.json({ ok: true, ...value });
    } catch (error) { return sendError(res, error); }
  });
}

module.exports = registerFacebookKnowledgeRoutes;
