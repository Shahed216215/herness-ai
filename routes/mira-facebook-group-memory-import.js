'use strict';

const express = require('express');
const rejectUnsupportedUploads = require('../services/security/reject-unsupported-uploads');
const {
  createFacebookGroupImportService,
  prepareFacebookGroupImport
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

  // The global JSON parser skips this endpoint; parse up to 1 MiB only
  // after the SYSTEM_ADMIN guard has authenticated the request.
  router.use(express.json({ limit: '1mb' }));
  router.use(rejectUnsupportedUploads);

  router.post('/import', async (req, res) => {
    let actor;
    try {
      actor = actorIdentity(req);
      const body = req.body || {};
      if (body.authorizedAccess !== true) {
        return res.status(400).json({
          success: false,
          code: 'FB_GROUP_IMPORT_AUTHORIZATION_REQUIRED',
          status: 'FAILED'
        });
      }
      if (!['json', 'jsonl', 'manual'].includes(body.format) ||
          typeof body.groupId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(body.groupId) ||
          typeof body.projectId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.projectId) ||
          typeof body.content !== 'string' || !body.content.trim()) {
        return res.status(400).json({
          success: false,
          code: 'FB_GROUP_IMPORT_INVALID_INPUT',
          status: 'FAILED'
        });
      }
      const store = createStore();
      const baseInput = {
        format: body.format,
        content: body.content,
        groupId: body.groupId,
        projectId: body.projectId,
        actorId: actor.id,
        authorizedAccess: body.authorizedAccess === true,
        sourceId: body.sourceId,
        sourceUrl: body.sourceUrl,
        recordType: body.recordType,
        memoryId: body.memoryId,
        observedAt: body.observedAt
      };
      const existingBatches = await store.listBatches({
        projectId: body.projectId,
        groupId: body.groupId
      });
      // Compute stable batch identity first. Exclude that batch from the
      // existing-record snapshot so identical retries reproduce the same
      // dispositions/digest, while earlier batches still drive conflict checks.
      const identityCandidate = prepareFacebookGroupImport({
        ...baseInput,
        existingRecords: []
      });
      const priorBatches = existingBatches.filter(batch =>
        batch.batchId !== identityCandidate.batchId
      );
      const existingRecords = priorBatches.flatMap(batch =>
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
      const service = createFacebookGroupImportService({ store });
      const result = await service.import({
        ...baseInput,
        existingRecords
      });
      return res.status(201).json({ success: true, result });
    } catch (error) {
      const code = safeErrorCode(error, 'FB_GROUP_IMPORT_FAILED');
      const committed = error && error.stateCommitted === true;
      const status = committed ? 503
        : /INVALID_INPUT|SCHEMA_INVALID|SCOPE_MISMATCH|ACTOR_REQUIRED|AUTHORIZATION_REQUIRED/.test(code) ? 400
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
      const service = createFacebookGroupImportService({ store });
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
