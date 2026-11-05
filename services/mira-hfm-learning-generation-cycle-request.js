'use strict';

function blocked(code, status = 'BLOCKED') {
  return {
    success: false,
    status,
    code,
    canonicalMemoryWrites: 0,
    automaticExecution: false
  };
}

/**
 * Request-boundary adapter for the authenticated /api/agent tool loop.
 * Only a named administrator's explicit opt-in and a completed HFM retrieval
 * may stage an untrusted proposal for human review.
 */
async function stageAgentGenerationProposal({ req, toolName, toolResult, stage } = {}) {
  if (toolName !== 'mira_hfm_public_web_retrieval' ||
      !req || !req.body || req.body.learningProposalOptIn !== true) {
    return { attempted: false, result: null };
  }

  const session = req.session;
  const namedAdmin = req.role === 'admin' && session &&
    session.authenticated === true && session.role === 'admin' &&
    typeof session.username === 'string' && session.username.trim().length > 0;
  if (!namedAdmin) {
    return { attempted: true, result: blocked('HFM_LEARNING_NAMED_ADMIN_REQUIRED') };
  }

  const proposalInput = req.body.learningProposal;
  if (!proposalInput || typeof proposalInput !== 'object' || Array.isArray(proposalInput)) {
    return { attempted: true, result: blocked('HFM_LEARNING_PROPOSAL_INPUT_REQUIRED') };
  }
  if (typeof stage !== 'function') {
    return {
      attempted: true,
      result: blocked('HFM_LEARNING_GENERATION_BRIDGE_UNAVAILABLE', 'NOT_CERTIFIED')
    };
  }

  let retrievalReport;
  try {
    retrievalReport = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
  } catch {
    return { attempted: true, result: blocked('HFM_LEARNING_RETRIEVAL_REPORT_INVALID') };
  }
  if (!retrievalReport || typeof retrievalReport !== 'object' || Array.isArray(retrievalReport)) {
    return { attempted: true, result: blocked('HFM_LEARNING_RETRIEVAL_REPORT_INVALID') };
  }

  try {
    const result = await stage({
      explicitOptIn: true,
      actor: {
        authenticated: true,
        role: 'admin',
        actorId: session.username.trim().slice(0, 128)
      },
      projectId: proposalInput.projectId,
      proposalId: proposalInput.proposalId,
      title: proposalInput.title,
      rationale: proposalInput.rationale,
      proposedChange: proposalInput.proposedChange,
      retrievalResult: retrievalReport
    });
    return {
      attempted: true,
      result: result && typeof result === 'object'
        ? result
        : blocked('HFM_LEARNING_GENERATION_BRIDGE_RESPONSE_INVALID', 'NOT_CERTIFIED')
    };
  } catch (error) {
    return {
      attempted: true,
      result: blocked(
        String(error && error.code || 'HFM_LEARNING_GENERATION_BRIDGE_FAILED').slice(0, 80),
        'NOT_CERTIFIED'
      )
    };
  }
}

module.exports = { stageAgentGenerationProposal };
