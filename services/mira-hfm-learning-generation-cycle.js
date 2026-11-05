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


/**
 * Agent-loop boundary: only a named administrator's explicit request may
 * hand a completed HFM retrieval result to the already configured stage().
 * Ordinary retrievals and all non-HFM tool calls remain proposal-free.
 */
async function stageAgentGenerationCycleProposal({
  toolName, requestBody, requestRole, session, toolResult, stage
} = {}) {
  if (toolName !== 'mira_hfm_public_web_retrieval' ||
      !requestBody || requestBody.learningProposalOptIn !== true) {
    return Object.freeze({ attempted: false, result: null });
  }
  const blockedResult = (status, code) => Object.freeze({
    success: false, status, code, canonicalMemoryWrites: 0, automaticExecution: false
  });
  if (requestRole !== 'admin' || !session || session.authenticated !== true ||
      session.role !== 'admin' || typeof session.username !== 'string' ||
      !session.username.trim()) {
    return Object.freeze({ attempted: true, result: blockedResult('BLOCKED', 'HFM_LEARNING_NAMED_ADMIN_REQUIRED') });
  }
  const proposalInput = requestBody.learningProposal;
  if (!proposalInput || typeof proposalInput !== 'object' || Array.isArray(proposalInput)) {
    return Object.freeze({ attempted: true, result: blockedResult('BLOCKED', 'HFM_LEARNING_PROPOSAL_INPUT_REQUIRED') });
  }
  if (typeof stage !== 'function') {
    return Object.freeze({ attempted: true, result: blockedResult('NOT_CERTIFIED', 'HFM_LEARNING_GENERATION_BRIDGE_UNAVAILABLE') });
  }
  let retrievalReport;
  try {
    retrievalReport = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
  } catch {
    return Object.freeze({ attempted: true, result: blockedResult('BLOCKED', 'HFM_LEARNING_RETRIEVAL_INVALID') });
  }
  try {
    const result = await stage({
      explicitOptIn: true,
      actor: { authenticated: true, role: 'admin', actorId: session.username.trim().slice(0, 128) },
      projectId: proposalInput.projectId,
      proposalId: proposalInput.proposalId,
      title: proposalInput.title,
      rationale: proposalInput.rationale,
      proposedChange: proposalInput.proposedChange,
      retrievalResult: retrievalReport
    });
    return Object.freeze({ attempted: true, result });
  } catch {
    return Object.freeze({ attempted: true,
      result: blockedResult('NOT_CERTIFIED', 'HFM_LEARNING_GENERATION_HANDOFF_FAILED') });
  }
}

module.exports = { createGenerationCycleProposalOrchestrator, stageAgentGenerationCycleProposal };
