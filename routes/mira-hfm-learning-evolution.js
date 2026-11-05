'use strict';

const express = require('express');
const {
  createLearningEvolutionBridge,
  hasProductionIntegrationCapabilities
} = require('../services/mira-hfm-learning-evolution-bridge');
const { createPersistentProposalStore } = require('../services/mira-hfm-learning-proposal-store');
const { createSupabaseLearningProposalStore } = require('../services/mira-hfm-learning-proposal-supabase-store');
const { recordAudit } = require('../audit-log');
const { fromPublicRetrieval } = require('../services/mira-hfm-learning-evidence-adapter');
const { fromLegacyLearningRecord } = require('../services/mira-hfm-legacy-learning-evidence-adapter');

function registerMiraHfmLearningEvolutionRoutes(app, requireAdminPermission, PERMISSIONS, options = {}) {
  const router = express.Router();
  const isProduction = process.env.NODE_ENV === 'production';
  const backend = String(process.env.MIRA_HFM_LEARNING_PROPOSAL_BACKEND || 'local').trim().toLowerCase();
  let proposalStore = options.proposalStore || null;
  let auditWriter = options.auditWriter || null;
  let adapterErrorCode = null;

  if (!proposalStore && !auditWriter) {
    try {
      if (backend === 'supabase') {
        proposalStore = createSupabaseLearningProposalStore();
        auditWriter = event => proposalStore.writeAuditEvent(event);
        auditWriter.durable = true;
        auditWriter.idempotent = true;
        auditWriter.idempotent = true;
      } else if (backend === 'local' && !isProduction) {
        proposalStore = createPersistentProposalStore();
        auditWriter = event => recordAudit({
          actorRole: event.actorRole || 'admin',
          action: event.event,
          resource: 'hfm_learning_proposal',
          resourceId: event.proposalId,
          status: 'success',
          details: {
            projectId: event.projectId,
            proposalDigest: event.proposalDigest,
            proposalStatus: event.status,
            actorId: event.actorId || 'unknown',
            canonicalMemoryWrites: 0
          }
        });
      } else if (!['local', 'supabase'].includes(backend)) {
        adapterErrorCode = 'HFM_LEARNING_BACKEND_UNSUPPORTED';
      }
    } catch (error) {
      adapterErrorCode = String(error && error.code || 'HFM_LEARNING_ADAPTER_CONFIG_INVALID').slice(0, 80);
      proposalStore = null;
      auditWriter = null;
    }
  }

  const productionReady = !isProduction ||
    hasProductionIntegrationCapabilities({
      proposalStore, auditWriter,
      productionIntegrationReady: options.productionIntegrationReady === true ||
        process.env.MIRA_HFM_LEARNING_PROPOSAL_PRODUCTION_READY === 'true'
    });
  const bridge = productionReady && proposalStore && auditWriter
    ? (options.bridge || createLearningEvolutionBridge({ proposalStore, auditWriter }))
    : null;

  function requireNamedAdminSession(req, res) {
    const session = req && req.session;
    if (!session || session.authenticated !== true || session.role !== 'admin' ||
        typeof session.username !== 'string' || !session.username.trim()) {
      res.status(403).json({
        success: false,
        status: 'BLOCKED',
        code: 'HFM_LEARNING_NAMED_ADMIN_SESSION_REQUIRED'
      });
      return null;
    }
    return session.username.trim().slice(0, 128);
  }

  function requireBridge(res) {
    if (bridge) return true;
    res.status(503).json({
      success: false,
      status: 'NOT_CERTIFIED',
      code: adapterErrorCode || 'HFM_LEARNING_PRODUCTION_ADAPTER_NOT_CONFIGURED',
      canonicalMemoryWrites: 0
    });
    return false;
  }

  router.post('/proposals', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res);
    if (!actorId) return;
    if (!requireBridge(res)) return;
    try {
      const result = await bridge.submit(req.body || {}, {
        actorRole: 'admin', actorId
      });
      return res.status(201).json({ success: true, proposal: result });
    } catch (error) {
      const code = String(error && error.code || 'HFM_LEARNING_SUBMISSION_FAILED').slice(0, 80);
      const status = code === 'HFM_LEARNING_PROPOSAL_CONFLICT' ? 409
        : code === 'HFM_LEARNING_INVALID' || code === 'HFM_LEARNING_PROJECT_MISMATCH' ||
          code === 'HFM_LEARNING_INVALID_ID' ? 400 : 503;
      return res.status(status).json({
        success: false, code,
        committed: error && error.stateCommitted === true,
        reconciliationRequired: error && error.stateCommitted === true
      });
    }
  });

  router.post('/proposals/from-public-retrieval', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res);
    if (!actorId) return;
    if (!requireBridge(res)) return;
    try {
      const proposalInput = fromPublicRetrieval(req.body || {});
      const result = await bridge.submit(proposalInput, {
        actorRole: 'admin', actorId
      });
      return res.status(201).json({ success: true, proposal: result });
    } catch (error) {
      const code = String(error && error.code || 'HFM_LEARNING_RETRIEVAL_SUBMISSION_FAILED').slice(0, 80);
      const status = code === 'HFM_LEARNING_PROPOSAL_CONFLICT' ? 409
        : code === 'HFM_LEARNING_RETRIEVAL_INVALID' || code === 'HFM_LEARNING_INVALID' ||
          code === 'HFM_LEARNING_PROJECT_MISMATCH' ? 400 : 503;
      return res.status(status).json({ success: false, code,
        committed: error && error.stateCommitted === true,
        reconciliationRequired: error && error.stateCommitted === true });
    }
  });

  router.post('/proposals/from-legacy-learning', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res);
    if (!actorId) return;
    if (!requireBridge(res)) return;
    try {
      const learningEngine = options.learningEngine ||
        (isProduction ? null : require('../services/mira-work-learning-engine'));
      if (!learningEngine ||
          typeof learningEngine.getLearningRecord !== 'function' ||
          typeof learningEngine.verifyLearningRecordIntegrity !== 'function') {
        return res.status(503).json({
          success: false, status: 'NOT_CERTIFIED',
          code: 'HFM_LEARNING_LEGACY_ENGINE_UNAVAILABLE'
        });
      }
      const learningId = req.body && req.body.learningId;
      if (typeof learningId !== 'string' || !learningId.trim()) {
        return res.status(400).json({
          success: false, code: 'HFM_LEARNING_LEGACY_ID_REQUIRED'
        });
      }
      const record = learningEngine.getLearningRecord(learningId.trim());
      if (!record) {
        return res.status(404).json({
          success: false, code: 'HFM_LEARNING_LEGACY_RECORD_NOT_FOUND'
        });
      }
      const integrity = learningEngine.verifyLearningRecordIntegrity(record.learningId);
      const proposalInput = fromLegacyLearningRecord({
        ...(req.body || {}), record, integrity
      });
      const result = await bridge.submit(proposalInput, {
        actorRole: 'admin', actorId
      });
      return res.status(201).json({ success: true, proposal: result });
    } catch (error) {
      const code = String(error && error.code || 'HFM_LEARNING_LEGACY_SUBMISSION_FAILED').slice(0, 80);
      const status = code === 'HFM_LEARNING_PROPOSAL_CONFLICT' ? 409
        : code === 'HFM_LEARNING_LEGACY_INVALID' ||
          code === 'HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED' ||
          code === 'HFM_LEARNING_LEGACY_SECRET_SUSPECTED' ||
          code === 'HFM_LEARNING_INVALID' ? 400 : 503;
      return res.status(status).json({
        success: false, code,
        committed: error && error.stateCommitted === true,
        reconciliationRequired: error && error.stateCommitted === true
      });
    }
  });

  router.post('/proposals/:projectId/:proposalId/review', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res);
    if (!actorId) return;
    if (!requireBridge(res)) return;
    try {
      const result = await bridge.review(req.params.projectId, req.params.proposalId,
        req.body || {}, { actorRole: 'admin', actorId });
      return res.status(201).json({ success: true, review: result });
    } catch (error) {
      const code = String(error && error.code || 'HFM_LEARNING_REVIEW_FAILED').slice(0, 80);
      const status = code === 'HFM_LEARNING_REVIEW_CONFLICT' ? 409
        : code === 'HFM_LEARNING_PROPOSAL_NOT_FOUND' ? 404
        : code === 'HFM_LEARNING_REVIEW_INVALID' || code === 'HFM_LEARNING_REVIEW_ACTOR_REQUIRED' ? 400
        : 503;
      return res.status(status).json({ success: false, code,
        committed: error && error.stateCommitted === true,
        reconciliationRequired: error && error.stateCommitted === true });
    }
  });

  router.get('/proposals/:projectId/:proposalId', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res);
    if (!actorId) return;
    if (!requireBridge(res)) return;
    try {
      const proposal = await bridge.get(req.params.projectId, req.params.proposalId);
      if (!proposal) return res.status(404).json({ success: false, code: 'HFM_LEARNING_PROPOSAL_NOT_FOUND' });
      return res.json({ success: true, proposal });
    } catch (error) {
      return res.status(400).json({ success: false, code: String(error && error.code || 'HFM_LEARNING_READ_FAILED').slice(0, 80) });
    }
  });

  app.use('/api/admin/mira-hfm-learning-evolution',
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN), router);
}
module.exports = registerMiraHfmLearningEvolutionRoutes;
