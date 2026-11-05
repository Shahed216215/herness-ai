'use strict';

const express = require('express');
const {
  createFacebookGroupImportService
} = require('../services/mira-facebook-group-memory-import');
const {
  createSupabaseFacebookGroupImportStore
} = require('../services/mira-facebook-group-memory-supabase-store');

function actorIdentity(req) {
  const session = req.session;
  if (!session || session.authenticated !== true ||
      session.role !== 'admin' || req.role !== 'admin' ||
      typeof session.username !== 'string' || !session.username.trim()) {
    const error = new Error('A named authenticated administrator session is required for Group import.');
    error.code = 'FB_GROUP_IMPORT_ACTOR_REQUIRED';
    throw error;
  }
  return { id: session.username.trim(), role: 'admin' };
}

function safeErrorCode(error, fallback) {
  return String(error && error.code || fallback).slice(0, 80);
}

function registerFacebookGroupMemoryImportRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS,
  options = {}
) {
  const router = express.Router();
  const createStore = options.createStore || createSupabaseFacebookGroupImportStore;
  const audit = options.auditWriter || ((event, store) => store.writeAuditEvent(event));

  // The global JSON parser skips this endpoint; parse up to 1 MiB only
  // after the SYSTEM_ADMIN guard has authenticated the request.
  router.use(express.json({ limit: '1mb' }));

  router.post('/import', async (req, res) => {
    let actor;
    try {
      actor = actorIdentity(req);
      const body = req.body || {};
      const store = createStore();
      const existingBatches = await store.listBatches({
        projectId: body.projectId,
        groupId: body.groupId
      });
      const existingRecords = existingBatches.flatMap(batch =>
        Array.isArray(batch.items)
          ? batch.items.map(item => item && item.record).filter(Boolean)
          : []
      );
      if (existingRecords.length > 10000) {
        return res.status(503).json({
          success: false,
          code: 'FB_GROUP_IMPORT_EXISTING_MEMORY_LIMIT',
          status: 'INCONCLUSIVE'
        });
      }
      const service = createFacebookGroupImportService({
        store,
        auditWriter: event => audit({ ...event, actorId: actor.id }, store)
      });
      const result = await service.import({
        format: body.format,
        content: body.content,
        groupId: body.groupId,
        projectId: body.projectId,
        actorId: actor.id,
        sourceId: body.sourceId,
        sourceUrl: body.sourceUrl,
        recordType: body.recordType,
        memoryId: body.memoryId,
        observedAt: body.observedAt,
        existingRecords
      });
      return res.status(201).json({ success: true, result });
    } catch (error) {
      const code = safeErrorCode(error, 'FB_GROUP_IMPORT_FAILED');
      const committed = error && error.stateCommitted === true;
      const status = committed ? 503
        : /INVALID_INPUT|SCHEMA_INVALID|SCOPE_MISMATCH|ACTOR_REQUIRED/.test(code) ? 400
        : /BATCH_ID_CONFLICT|IDENTITY_CONFLICT/.test(code) ? 409
        : 503;
      return res.status(status).json({
        success: false,
        code,
        status: committed ? 'INCONCLUSIVE' : 'FAILED',
        stateCommitted: committed,
        recoveryRequired: committed
      });
    }
  });

  router.get('/retrieve', async (req, res) => {
    try {
      const store = createStore();
      const service = createFacebookGroupImportService({
        store,
        auditWriter: async () => {}
      });
      const result = await service.retrieve({
        projectId: req.query && req.query.projectId,
        groupId: req.query && req.query.groupId,
        query: req.query && req.query.query || '',
        limit: req.query && req.query.limit === undefined
          ? 50 : Number(req.query.limit)
      });
      return res.status(200).json({ success: true, result });
    } catch (error) {
      const code = safeErrorCode(error, 'FB_GROUP_IMPORT_RETRIEVAL_FAILED');
      const status = /INVALID_INPUT/.test(code) ? 400 : 503;
      return res.status(status).json({
        success: false,
        code,
        status: 'INCONCLUSIVE'
      });
    }
  });

  app.use(
    '/api/admin/facebook-group',
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN),
    router
  );
}

module.exports = registerFacebookGroupMemoryImportRoutes;
module.exports.actorIdentity = actorIdentity;
