'use strict';

const TOOL_NAME = 'mira_hfm_public_web_retrieval';

function blocked(code) {
  return Object.freeze({
    success: false, status: 'BLOCKED', code,
    canonicalMemoryWrites: 0, automaticExecution: false
  });
}

function parseReport(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * Dispatches an already completed public retrieval result to the gated
 * proposal adapter. This function never performs retrieval or approval.
 */
async function dispatchGenerationCycleProposalHandoff({
  toolName,
  explicitOptIn = false,
  alreadyAttempted = false,
  actor = null,
  proposalInput = null,
  toolResult = null,
  stage
} = {}) {
  if (toolName !== TOOL_NAME || explicitOptIn !== true || alreadyAttempted === true) {
    return { attempted: alreadyAttempted === true, handoff: null };
  }

  if (!actor || actor.authenticated !== true || actor.role !== 'admin' ||
      typeof actor.actorId !== 'string' || !actor.actorId.trim()) {
    return { attempted: true, handoff: blocked('HFM_LEARNING_NAMED_ADMIN_REQUIRED') };
  }
  if (!proposalInput || typeof proposalInput !== 'object' || Array.isArray(proposalInput)) {
    return { attempted: true, handoff: blocked('HFM_LEARNING_PROPOSAL_INPUT_REQUIRED') };
  }
  if (typeof stage !== 'function') {
    return {
      attempted: true,
      handoff: Object.freeze({
        success:false, status:'NOT_CERTIFIED',
        code:'HFM_LEARNING_GENERATION_BRIDGE_UNAVAILABLE',
        canonicalMemoryWrites:0, automaticExecution:false
      })
    };
  }

  const retrievalResult = parseReport(toolResult);
  if (!retrievalResult || typeof retrievalResult !== 'object' || Array.isArray(retrievalResult)) {
    return { attempted: true, handoff: blocked('HFM_LEARNING_RETRIEVAL_RESULT_INVALID') };
  }

  try {
    const handoff = await stage({
      explicitOptIn: true,
      actor: { authenticated:true, role:'admin', actorId:actor.actorId.trim().slice(0,128) },
      projectId: proposalInput.projectId,
      proposalId: proposalInput.proposalId,
      title: proposalInput.title,
      rationale: proposalInput.rationale,
      proposedChange: proposalInput.proposedChange,
      retrievalResult
    });
    return { attempted:true, handoff };
  } catch (error) {
    return {
      attempted:true,
      handoff:Object.freeze({
        success:false, status:'NOT_CERTIFIED',
        code:String(error && error.code || 'HFM_LEARNING_HANDOFF_FAILED').slice(0,80),
        canonicalMemoryWrites:0, automaticExecution:false
      })
    };
  }
}

module.exports = { dispatchGenerationCycleProposalHandoff };
