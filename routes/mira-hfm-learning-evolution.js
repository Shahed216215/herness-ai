'use strict';
const express = require('express');
const { createLearningEvolutionBridge } = require('../services/mira-hfm-learning-evolution-bridge');
const { createPersistentProposalStore } = require('../services/mira-hfm-learning-proposal-store');
const { recordAudit } = require('../audit-log');

function registerMiraHfmLearningEvolutionRoutes(app, requireAdminPermission, PERMISSIONS, options = {}) {
  const router = express.Router();
  const bridge = options.bridge || createLearningEvolutionBridge({
    proposalStore: options.proposalStore || createPersistentProposalStore(),
    auditWriter: options.auditWriter || (event => recordAudit({
      actorRole: event.actorRole || 'admin',
      action: event.event,
      resource: 'hfm_learning_proposal',
      resourceId: event.proposalId,
      status: 'success',
      details: {
        projectId: event.projectId,
        proposalDigest: event.proposalDigest,
        proposalStatus: event.status,
        canonicalMemoryWrites: 0
      }
    }))
  });

  router.post('/proposals', async (req, res) => {
    try {
      const result = await bridge.submit(req.body || {}, { actorRole: req.role || 'admin' });
      return res.status(201).json({ success: true, proposal: result });
    } catch (error) {
      const code = String(error && error.code || 'HFM_LEARNING_SUBMISSION_FAILED').slice(0, 80);
      const status = code === 'HFM_LEARNING_PROPOSAL_CONFLICT' ? 409
        : code === 'HFM_LEARNING_INVALID' || code === 'HFM_LEARNING_PROJECT_MISMATCH' ||
          code === 'HFM_LEARNING_INVALID_ID' ? 400
        : error && error.stateCommitted === true ? 503 : 503;
      return res.status(status).json({
        success: false, code,
        committed: error && error.stateCommitted === true,
        reconciliationRequired: error && error.stateCommitted === true
      });
    }
  });

  router.get('/proposals/:projectId/:proposalId', async (req, res) => {
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
