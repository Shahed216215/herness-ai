'use strict';

const { fromPublicRetrieval } = require('./mira-hfm-learning-evidence-adapter');

function blocked(code) {
  return Object.freeze({
    success: false,
    status: 'BLOCKED',
    code,
    canonicalMemoryWrites: 0,
    automaticExecution: false
  });
}

/**
 * Creates a deliberately opt-in handoff from an already completed HFM
 * public-retrieval result into the immutable proposal bridge.
 *
 * This module does not run retrieval, approve proposals, promote trust,
 * write canonical Memory, execute learning, or modify code.
 */
function createGenerationCycleProposalOrchestrator({ bridge, enabled = false } = {}) {
  if (!bridge || typeof bridge.submit !== 'function') {
    throw Object.assign(new Error('A proposal bridge with submit() is required.'), {
      code: 'HFM_LEARNING_BRIDGE_REQUIRED'
    });
  }

  return Object.freeze({
    async stage({
      explicitOptIn = false,
      actor = null,
      projectId,
      proposalId,
      title,
      rationale,
      proposedChange,
      retrievalResult
    } = {}) {
      if (enabled !== true) return blocked('HFM_LEARNING_GENERATION_HOOK_DISABLED');
      if (explicitOptIn !== true) return blocked('HFM_LEARNING_EXPLICIT_OPT_IN_REQUIRED');
      if (!actor || actor.authenticated !== true || actor.role !== 'admin' ||
          typeof actor.actorId !== 'string' || !actor.actorId.trim()) {
        return blocked('HFM_LEARNING_NAMED_ADMIN_REQUIRED');
      }

      let proposalInput;
      try {
        proposalInput = fromPublicRetrieval({
          projectId,
          proposalId,
          title,
          rationale,
          proposedChange,
          retrievalResult
        });
      } catch (error) {
        return blocked(String(error && error.code || 'HFM_LEARNING_RETRIEVAL_INVALID'));
      }

      try {
        const proposal = await bridge.submit(proposalInput, {
          actorRole: 'admin',
          actorId: actor.actorId.trim()
        });
        if (!proposal || proposal.status !== 'PENDING_HUMAN_REVIEW' ||
            proposal.trustState !== 'UNTRUSTED' ||
            proposal.canonicalMemoryWrites !== 0 ||
            proposal.automaticExecution !== false) {
          return blocked('HFM_LEARNING_PROPOSAL_GOVERNANCE_READBACK_FAILED');
        }
        return Object.freeze({
          success: true,
          status: 'STAGED_FOR_HUMAN_REVIEW',
          proposal,
          canonicalMemoryWrites: 0,
          automaticExecution: false,
          trustPromotion: false
        });
      } catch (error) {
        return Object.freeze({
          success: false,
          status: 'NOT_CERTIFIED',
          code: String(error && error.code || 'HFM_LEARNING_PROPOSAL_STAGE_FAILED').slice(0, 80),
          committed: error && error.stateCommitted === true,
          reconciliationRequired: error && error.stateCommitted === true,
          canonicalMemoryWrites: 0,
          automaticExecution: false
        });
      }
    }
  });
}


module.exports = { createGenerationCycleProposalOrchestrator };
