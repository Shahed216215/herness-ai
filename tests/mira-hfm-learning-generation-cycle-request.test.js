'use strict';

const assert = require('node:assert/strict');
const { stageAgentGenerationProposal } = require('../services/mira-hfm-learning-generation-cycle-request');

const retrievalReport = {
  providerId: 'mira-hfm-public-web-retrieval',
  retrievalMode: 'PUBLIC_FACEBOOK_SEARCH_INDEX_ONLY',
  status: 'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED',
  evidence: [{ evidenceId: 'evidence-001', trustStatus: 'SOURCE_RECORDED' }]
};
const proposal = {
  projectId: 'project-alpha',
  proposalId: 'proposal-agent-001',
  title: 'Candidate',
  rationale: 'Test request-boundary handoff.',
  proposedChange: 'Stage for manual review only.'
};
const adminReq = {
  role: 'admin',
  session: { authenticated: true, role: 'admin', username: 'named-admin' },
  body: { learningProposalOptIn: true, learningProposal: proposal }
};
const normalReq = {
  role: 'user',
  session: { authenticated: true, role: 'user', username: 'ordinary-user' },
  body: { learningProposalOptIn: true, learningProposal: proposal }
};

(async () => {
  let calls = 0;
  let args;
  const stage = async input => {
    calls++;
    args = input;
    return {
      success: true,
      status: 'STAGED_FOR_HUMAN_REVIEW',
      canonicalMemoryWrites: 0,
      automaticExecution: false
    };
  };

  assert.deepEqual(await stageAgentGenerationProposal({
    req: adminReq, toolName: 'other_tool', toolResult: retrievalReport, stage
  }), { attempted: false, result: null });
  assert.deepEqual(await stageAgentGenerationProposal({
    req: { ...adminReq, body: { ...adminReq.body, learningProposalOptIn: false } },
    toolName: 'mira_hfm_public_web_retrieval', toolResult: retrievalReport, stage
  }), { attempted: false, result: null });
  assert.equal(calls, 0);

  const denied = await stageAgentGenerationProposal({
    req: normalReq, toolName: 'mira_hfm_public_web_retrieval', toolResult: retrievalReport, stage
  });
  assert.equal(denied.attempted, true);
  assert.equal(denied.result.code, 'HFM_LEARNING_NAMED_ADMIN_REQUIRED');
  assert.equal(calls, 0);

  const noSession = await stageAgentGenerationProposal({
    req: { ...adminReq, session: null },
    toolName: 'mira_hfm_public_web_retrieval', toolResult: retrievalReport, stage
  });
  assert.equal(noSession.result.code, 'HFM_LEARNING_NAMED_ADMIN_REQUIRED');

  const missingProposal = await stageAgentGenerationProposal({
    req: { ...adminReq, body: { learningProposalOptIn: true } },
    toolName: 'mira_hfm_public_web_retrieval', toolResult: retrievalReport, stage
  });
  assert.equal(missingProposal.result.code, 'HFM_LEARNING_PROPOSAL_INPUT_REQUIRED');

  const missingStage = await stageAgentGenerationProposal({
    req: adminReq, toolName: 'mira_hfm_public_web_retrieval', toolResult: retrievalReport
  });
  assert.equal(missingStage.result.status, 'NOT_CERTIFIED');
  assert.equal(missingStage.result.code, 'HFM_LEARNING_GENERATION_BRIDGE_UNAVAILABLE');

  const malformed = await stageAgentGenerationProposal({
    req: adminReq, toolName: 'mira_hfm_public_web_retrieval', toolResult: '{bad json', stage
  });
  assert.equal(malformed.result.code, 'HFM_LEARNING_RETRIEVAL_REPORT_INVALID');
  assert.equal(calls, 0);

  const staged = await stageAgentGenerationProposal({
    req: adminReq, toolName: 'mira_hfm_public_web_retrieval',
    toolResult: JSON.stringify(retrievalReport), stage
  });
  assert.equal(staged.attempted, true);
  assert.equal(staged.result.status, 'STAGED_FOR_HUMAN_REVIEW');
  assert.equal(calls, 1);
  assert.equal(args.explicitOptIn, true);
  assert.deepEqual(args.actor, {
    authenticated: true, role: 'admin', actorId: 'named-admin'
  });
  assert.equal(args.projectId, proposal.projectId);
  assert.equal(args.retrievalResult.providerId, retrievalReport.providerId);

  const failed = await stageAgentGenerationProposal({
    req: adminReq, toolName: 'mira_hfm_public_web_retrieval', toolResult: retrievalReport,
    stage: async () => { throw Object.assign(new Error('unexpected failure'), { code: 'BRIDGE_ERROR' }); }
  });
  assert.equal(failed.result.status, 'NOT_CERTIFIED');
  assert.equal(failed.result.code, 'BRIDGE_ERROR');
  assert.equal(failed.result.canonicalMemoryWrites, 0);
  assert.equal(failed.result.automaticExecution, false);

  console.log('HFM_PHASE8_AGENT_HOOK_EXACT_TOOL_AND_OPT_IN=PASS');
  console.log('HFM_PHASE8_AGENT_HOOK_NAMED_ADMIN_SESSION=PASS');
  console.log('HFM_PHASE8_AGENT_HOOK_REQUIRED_PROPOSAL=PASS');
  console.log('HFM_PHASE8_AGENT_HOOK_RETRIEVAL_REPORT_VALIDATION=PASS');
  console.log('HFM_PHASE8_AGENT_HOOK_HANDOFF_CONTEXT=PASS');
  console.log('HFM_PHASE8_AGENT_HOOK_FAILURE_FAIL_CLOSED=PASS');
  console.log('HFM_PHASE8_AGENT_HOOK_NO_CANONICAL_WRITES=PASS');
  console.log('HFM_PHASE8_AGENT_HOOK_NO_AUTOMATIC_EXECUTION=PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
