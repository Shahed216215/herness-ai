'use strict';

const express = require('express');
const { createMiraHfmSameOriginWriteGuard } = require('../services/security/mira-hfm-same-origin-write-guard');
const {
  createLearningEvolutionBridge,
  hasProductionIntegrationCapabilities
} = require('../services/mira-hfm-learning-evolution-bridge');
const { createPersistentProposalStore } = require('../services/mira-hfm-learning-proposal-store');
const { createSupabaseLearningProposalStore } = require('../services/mira-hfm-learning-proposal-supabase-store');
const { recordAudit } = require('../audit-log');
const { fromPublicRetrieval } = require('../services/mira-hfm-learning-evidence-adapter');
const { createGenerationCycleProposalOrchestrator } = require('../services/mira-hfm-learning-generation-cycle');
const {
  fromLegacyLearningRecord,
  fromLegacyExperiences,
  fromLegacyConsolidatedKnowledge
} = require('../services/mira-hfm-legacy-learning-evidence-adapter');

function registerMiraHfmLearningEvolutionRoutes(app, requireAdminPermission, PERMISSIONS, options = {}) {
  const router = express.Router();
  // Every state-changing HFM endpoint requires an explicit same-origin browser context.
  router.use(createMiraHfmSameOriginWriteGuard());
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
            reviewDigest: event.reviewDigest || null,
            decision: event.decision || null,
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
  const generationCycleOrchestrator = bridge
    ? createGenerationCycleProposalOrchestrator({
        bridge,
        enabled: process.env.MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED === 'true'
      })
    : null;
  if (!app.locals || typeof app.locals !== 'object') app.locals = Object.create(null);
  app.locals.miraHfmLearningGenerationCycle = Object.freeze({
    stage: input => generationCycleOrchestrator
      ? generationCycleOrchestrator.stage(input)
      : Promise.resolve({ success:false, status:'NOT_CERTIFIED',
          code:adapterErrorCode || 'HFM_LEARNING_PRODUCTION_ADAPTER_NOT_CONFIGURED',
          canonicalMemoryWrites:0, automaticExecution:false })
  });

  function requireSameOrigin(req, res) {
    const getHeader = name => {
      if (req && typeof req.get === 'function') return req.get(name);
      const headers = req && req.headers || {};
      return headers[name.toLowerCase()] || headers[name] || '';
    };
    const expectedHost = getHeader('host');
    const protocol = String(req && req.protocol || '').toLowerCase();
    const origin = String(getHeader('origin') || '').trim();
    const referer = String(getHeader('referer') || '').trim();
    const fetchSite = String(getHeader('sec-fetch-site') || '').trim().toLowerCase();

    if (!expectedHost || !['http', 'https'].includes(protocol) ||
        ['cross-site', 'same-site'].includes(fetchSite)) {
      res.status(403).json({ success:false, status:'BLOCKED',
        code:'HFM_LEARNING_CSRF_ORIGIN_REJECTED' });
      return false;
    }

    const suppliedUrl = origin || referer;
    if (!suppliedUrl) {
      if (fetchSite === 'same-origin') return true;
      res.status(403).json({ success:false, status:'BLOCKED',
        code:'HFM_LEARNING_CSRF_ORIGIN_REQUIRED' });
      return false;
    }

    let parsed;
    try { parsed = new URL(suppliedUrl); } catch {
      res.status(403).json({ success:false, status:'BLOCKED',
        code:'HFM_LEARNING_CSRF_ORIGIN_REJECTED' });
      return false;
    }
    const expectedOrigin = protocol + '://' + expectedHost;
    if (parsed.origin !== expectedOrigin) {
      res.status(403).json({ success:false, status:'BLOCKED',
        code:'HFM_LEARNING_CSRF_ORIGIN_REJECTED' });
      return false;
    }
    return true;
  }

  function requireNamedAdminSession(req, res, enforceSameOrigin = false) {
    if (enforceSameOrigin && !requireSameOrigin(req, res)) return null;
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

  router.get('/status', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res, req.method === 'POST');
    if (!actorId) return;
    return res.json({
      success:true,
      bridgeStatus:bridge ? 'AVAILABLE' : 'NOT_CERTIFIED',
      storageMode:proposalStore && proposalStore.storageMode || 'UNAVAILABLE',
      generationCycleHookEnabled:process.env.MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED === 'true',
      productionReady:isProduction && productionReady && !!bridge,
      humanReviewRequired:true,
      importedEvidenceTrust:'UNTRUSTED',
      canonicalMemoryWrites:0,
      automaticExecution:false
    });
  });

  router.post('/proposals', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res, req.method === 'POST');
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
    const actorId = requireNamedAdminSession(req, res, req.method === 'POST');
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
    const actorId = requireNamedAdminSession(req, res, req.method === 'POST');
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

  router.post('/proposals/from-experience-retrieval', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res, req.method === 'POST');
    if (!actorId) return;
    if (!requireBridge(res)) return;
    try {
      const experienceMemory = options.experienceMemory ||
        (isProduction ? null : require('../services/mira-experience-memory'));
      const retrievalEngine = options.experienceRetrievalEngine ||
        (isProduction ? null : require('../services/mira-experience-retrieval-engine'));
      if (!experienceMemory || !retrievalEngine ||
          typeof experienceMemory.getExperience !== 'function' ||
          typeof experienceMemory.verifyExperienceIntegrity !== 'function' ||
          typeof retrievalEngine.retrieveExperiences !== 'function') {
        return res.status(503).json({
          success: false, status: 'NOT_CERTIFIED',
          code: 'HFM_LEARNING_EXPERIENCE_SOURCE_UNAVAILABLE'
        });
      }
      const taskText = req.body && req.body.taskText;
      if (typeof taskText !== 'string' || !taskText.trim() || taskText.length > 10000) {
        return res.status(400).json({ success: false, code: 'HFM_LEARNING_EXPERIENCE_QUERY_INVALID' });
      }
      const matches = retrievalEngine.retrieveExperiences(taskText.trim(), { limit: 10 });
      if (!Array.isArray(matches) || !matches.length) {
        return res.status(404).json({ success: false, code: 'HFM_LEARNING_EXPERIENCE_NOT_FOUND' });
      }
      const experiences = matches.map(match => {
        if (!match || typeof match.experienceId !== 'string') {
          throw Object.assign(new Error('Experience retrieval returned an invalid identity.'), {
            code: 'HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED'
          });
        }
        const experience = experienceMemory.getExperience(match.experienceId);
        if (!experience || experienceMemory.verifyExperienceIntegrity(experience) !== true) {
          throw Object.assign(new Error('Legacy Experience integrity verification failed.'), {
            code: 'HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED'
          });
        }
        return { experience, integrityVerified: true };
      });
      const proposalInput = fromLegacyExperiences({
        ...(req.body || {}), experiences
      });
      const result = await bridge.submit(proposalInput, {
        actorRole: 'admin', actorId
      });
      return res.status(201).json({ success: true, proposal: result });
    } catch (error) {
      const code = String(error && error.code || 'HFM_LEARNING_EXPERIENCE_SUBMISSION_FAILED').slice(0, 80);
      const status = code === 'HFM_LEARNING_PROPOSAL_CONFLICT' ? 409
        : code === 'HFM_LEARNING_EXPERIENCE_QUERY_INVALID' ||
          code === 'HFM_LEARNING_LEGACY_INVALID' ||
          code === 'HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED' ? 400 : 503;
      return res.status(status).json({
        success: false, code,
        committed: error && error.stateCommitted === true,
        reconciliationRequired: error && error.stateCommitted === true
      });
    }
  });

  router.post('/proposals/from-consolidated-knowledge', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res, req.method === 'POST');
    if (!actorId) return;
    if (!requireBridge(res)) return;
    try {
      const knowledgeConsolidation = options.knowledgeConsolidation ||
        (isProduction ? null : require('../services/mira-work-knowledge-consolidation'));
      if (!knowledgeConsolidation ||
          typeof knowledgeConsolidation.verifyStoreIntegrity !== 'function' ||
          typeof knowledgeConsolidation.getConsolidatedKnowledge !== 'function') {
        return res.status(503).json({
          success: false, status: 'NOT_CERTIFIED',
          code: 'HFM_LEARNING_CONSOLIDATION_SOURCE_UNAVAILABLE'
        });
      }
      const knowledgeItemId = req.body && req.body.knowledgeItemId;
      if (typeof knowledgeItemId !== 'string' || !knowledgeItemId.trim()) {
        return res.status(400).json({ success: false, code: 'HFM_LEARNING_KNOWLEDGE_ITEM_ID_REQUIRED' });
      }
      const storeIntegrity = knowledgeConsolidation.verifyStoreIntegrity();
      if (!storeIntegrity || storeIntegrity.valid !== true) {
        return res.status(503).json({
          success: false, status: 'REVIEW_REQUIRED',
          code: 'HFM_LEARNING_CONSOLIDATION_INTEGRITY_FAILED'
        });
      }
      const items = knowledgeConsolidation.getConsolidatedKnowledge();
      if (!Array.isArray(items)) {
        return res.status(503).json({ success: false, code: 'HFM_LEARNING_CONSOLIDATION_INVALID' });
      }
      const item = items.find(candidate => candidate && candidate.id === knowledgeItemId.trim());
      if (!item) {
        return res.status(404).json({ success: false, code: 'HFM_LEARNING_KNOWLEDGE_ITEM_NOT_FOUND' });
      }
      const proposalInput = fromLegacyConsolidatedKnowledge({
        ...(req.body || {}), item, storeIntegrity
      });
      const result = await bridge.submit(proposalInput, {
        actorRole: 'admin', actorId
      });
      return res.status(201).json({ success: true, proposal: result });
    } catch (error) {
      const code = String(error && error.code || 'HFM_LEARNING_KNOWLEDGE_SUBMISSION_FAILED').slice(0, 80);
      const status = code === 'HFM_LEARNING_PROPOSAL_CONFLICT' ? 409
        : code === 'HFM_LEARNING_LEGACY_INVALID' ||
          code === 'HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED' ? 400 : 503;
      return res.status(status).json({
        success: false, code,
        committed: error && error.stateCommitted === true,
        reconciliationRequired: error && error.stateCommitted === true
      });
    }
  });

  router.post('/proposals/:projectId/:proposalId/review', async (req, res) => {
    const actorId = requireNamedAdminSession(req, res, req.method === 'POST');
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
    const actorId = requireNamedAdminSession(req, res, req.method === 'POST');
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
