'use strict';

const express = require('express');
const {
  createLearningEvolutionBridge,
  hasProductionIntegrationCapabilities
} = require('../services/mira-hfm-learning-evolution-bridge');
const { createPersistentProposalStore } = require('../services/mira-hfm-learning-proposal-store');
const { recordAudit } = require('../audit-log');
const { fromPublicRetrieval } = require('../services/mira-hfm-learning-evidence-adapter');

function registerMiraHfmLearningEvolutionRoutes(app, requireAdminPermission, PERMISSIONS, options = {}) {
  const router = express.Router();
  const isProduction = process.env.NODE_ENV === 'production';
  const proposalStore = options.proposalStore ||
    (isProduction ? null : createPersistentProposalStore());
  const auditWriter = options.auditWriter ||
    (isProduction ? null : (event => recordAudit({
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
    })));
  const productionReady = !isProduction ||
    hasProductionIntegrationCapabilities({
      proposalStore, auditWriter,
      productionIntegrationReady: options.productionIntegrationReady
    });
  const bridge = productionReady
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
      code: 'HFM_LEARNING_PRODUCTION_ADAPTER_NOT_CONFIGURED',
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
