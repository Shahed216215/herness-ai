'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGenerationCycleProposalOrchestrator, stageAgentGenerationCycleProposal } = require('../services/mira-hfm-learning-generation-cycle');

const retrievalResult = {
  providerId: 'mira-hfm-public-web-retrieval',
  retrievalMode: 'PUBLIC_FACEBOOK_SEARCH_INDEX_ONLY',
  status: 'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED',
  page: { pageId: '123456789' },
  lookup: { projectId: 'project-alpha', memoryId: null, query: '' },
  limits: {
    canonicalMemoryWrite: false, trustPromotion: false,
    directFacebookFetches: 0, metaGraphApiCalls: 0,
    loginOrCookieUse: 0, privateOrGroupContentAccess: 0
  },
  evidence: [{
    evidenceId: 'fbweb-evidence-001', pageId: '123456789',
    sourceUrl: 'https://www.facebook.com/123456789/posts/987654321',
    sourceType: 'FACEBOOK_PAGE_POST',
    identityBinding: 'PAGE_ID_PRESENT_IN_INDEXED_RESULT',
    trustStatus: 'SOURCE_RECORDED', integrityStatus: 'UNVERIFIED',
    lifecycle: 'PENDING_REVIEW', title: 'Public post',
    snippet: 'Synthetic untrusted evidence.'
  }]
};
const input = {
  explicitOptIn: true,
  actor: { authenticated: true, role: 'admin', actorId: 'named-admin' },
  projectId: 'project-alpha', proposalId: 'proposal-cycle-001',
  title: 'Candidate learning proposal',
  rationale: 'Review bounded public evidence.',
  proposedChange: 'Prepare a human-reviewable proposal only.',
  retrievalResult
};

(async () => {
  let submitCalls = 0;
  let submittedInput;
  let submittedContext;
  const bridge = {
    async submit(proposalInput, context) {
      submitCalls++;
      submittedInput = proposalInput;
      submittedContext = context;
      return {
        status: 'PENDING_HUMAN_REVIEW',
        trustState: 'UNTRUSTED',
        canonicalMemoryWrites: 0,
        automaticExecution: false
      };
    }
  };

  const disabled = createGenerationCycleProposalOrchestrator({ bridge, enabled: false });
  assert.equal((await disabled.stage(input)).code, 'HFM_LEARNING_GENERATION_HOOK_DISABLED');
  assert.equal(submitCalls, 0);

  const enabled = createGenerationCycleProposalOrchestrator({ bridge, enabled: true });
  assert.equal((await enabled.stage({ ...input, explicitOptIn: false })).code,
    'HFM_LEARNING_EXPLICIT_OPT_IN_REQUIRED');
  assert.equal((await enabled.stage({ ...input, actor: { authenticated: true, role: 'user', actorId: 'user-1' } })).code,
    'HFM_LEARNING_NAMED_ADMIN_REQUIRED');
  assert.equal((await enabled.stage({ ...input, actor: { authenticated: true, role: 'admin', actorId: '' } })).code,
    'HFM_LEARNING_NAMED_ADMIN_REQUIRED');
  assert.equal(submitCalls, 0);

  const projectMismatch = await enabled.stage({ ...input, projectId: 'project-beta' });
  assert.equal(projectMismatch.code, 'HFM_LEARNING_RETRIEVAL_INVALID');
  assert.equal(submitCalls, 0);

  const invalid = await enabled.stage({ ...input, retrievalResult: { ...retrievalResult, limits: { canonicalMemoryWrite: true } } });
  assert.equal(invalid.status, 'BLOCKED');
  assert.equal(invalid.code, 'HFM_LEARNING_RETRIEVAL_INVALID');
  assert.equal(submitCalls, 0);

  const result = await enabled.stage(input);
  assert.equal(result.success, true);
  assert.equal(result.status, 'STAGED_FOR_HUMAN_REVIEW');
  assert.equal(result.canonicalMemoryWrites, 0);
  assert.equal(result.automaticExecution, false);
  assert.equal(result.trustPromotion, false);
  assert.equal(submitCalls, 1);
  assert.equal(submittedInput.evidence[0].trustState, 'UNVERIFIED');
  assert.deepEqual(submittedContext, { actorRole: 'admin', actorId: 'named-admin' });

  const failedBridge = createGenerationCycleProposalOrchestrator({
    enabled: true,
    bridge: { async submit() { throw Object.assign(new Error('audit failed'), { code: 'HFM_AUDIT_FAILED', stateCommitted: true }); } }
  });
  const failed = await failedBridge.stage(input);
  assert.equal(failed.status, 'NOT_CERTIFIED');
  assert.equal(failed.committed, true);
  assert.equal(failed.reconciliationRequired, true);
  assert.equal(failed.canonicalMemoryWrites, 0);


  let agentStageInput;
  const stage = async value => { agentStageInput = value; return { success:true, status:'STAGED_FOR_HUMAN_REVIEW' }; };
  const requestBody = { learningProposalOptIn:true, learningProposal:{
    projectId:'project-alpha', proposalId:'proposal-agent-001',
    title:'Agent proposal', rationale:'Evidence review', proposedChange:'Human review only'
  }};
  const session = { authenticated:true, role:'admin', username:'named-admin' };
  const noOptIn = await stageAgentGenerationCycleProposal({
    toolName:'mira_hfm_public_web_retrieval', requestBody:{ ...requestBody, learningProposalOptIn:false },
    requestRole:'admin', session, toolResult:JSON.stringify(retrievalResult), stage
  });
  assert.equal(noOptIn.attempted, false);
  const wrongTool = await stageAgentGenerationCycleProposal({
    toolName:'other_tool', requestBody, requestRole:'admin', session,
    toolResult:JSON.stringify(retrievalResult), stage
  });
  assert.equal(wrongTool.attempted, false);
  const nonAdmin = await stageAgentGenerationCycleProposal({
    toolName:'mira_hfm_public_web_retrieval', requestBody, requestRole:'user',
    session:{ authenticated:true, role:'user', username:'ordinary-user' },
    toolResult:JSON.stringify(retrievalResult), stage
  });
  assert.equal(nonAdmin.result.code, 'HFM_LEARNING_NAMED_ADMIN_REQUIRED');
  const noProposal = await stageAgentGenerationCycleProposal({
    toolName:'mira_hfm_public_web_retrieval', requestBody:{ learningProposalOptIn:true },
    requestRole:'admin', session, toolResult:JSON.stringify(retrievalResult), stage
  });
  assert.equal(noProposal.result.code, 'HFM_LEARNING_PROPOSAL_INPUT_REQUIRED');
  const invalidJson = await stageAgentGenerationCycleProposal({
    toolName:'mira_hfm_public_web_retrieval', requestBody, requestRole:'admin', session,
    toolResult:'not-json', stage
  });
  assert.equal(invalidJson.result.code, 'HFM_LEARNING_RETRIEVAL_INVALID');
  const noBridge = await stageAgentGenerationCycleProposal({
    toolName:'mira_hfm_public_web_retrieval', requestBody, requestRole:'admin', session,
    toolResult:JSON.stringify(retrievalResult)
  });
  assert.equal(noBridge.result.code, 'HFM_LEARNING_GENERATION_BRIDGE_UNAVAILABLE');
  const agentHandoff = await stageAgentGenerationCycleProposal({
    toolName:'mira_hfm_public_web_retrieval', requestBody, requestRole:'admin', session,
    toolResult:JSON.stringify(retrievalResult), stage
  });
  assert.equal(agentHandoff.attempted, true);
  assert.equal(agentHandoff.result.status, 'STAGED_FOR_HUMAN_REVIEW');
  assert.equal(agentStageInput.explicitOptIn, true);
  assert.deepEqual(agentStageInput.actor, { authenticated:true, role:'admin', actorId:'named-admin' });
  assert.equal(agentStageInput.projectId, 'project-alpha');
  assert.equal(agentStageInput.retrievalResult.providerId, 'mira-hfm-public-web-retrieval');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /stageAgentGenerationCycleProposal\(/);
  assert.match(serverSource, /learningProposalOptIn === true/);
  assert.match(serverSource, /miraHfmLearningGenerationCycle\.stage/);
  console.log('HFM_PHASE8_AGENT_LOOP_EXPLICIT_OPT_IN_HANDOFF=PASS');
  console.log('HFM_PHASE8_AGENT_LOOP_NAMED_ADMIN_ENFORCEMENT=PASS');
  console.log('HFM_PHASE8_AGENT_LOOP_RETRIEVAL_REPORT_BINDING=PASS');
  console.log('HFM_PHASE8_AGENT_LOOP_NO_TOOL_NO_OPTIN_HANDOFF=PASS');
  console.log('HFM_PHASE8_AGENT_LOOP_UNAVAILABLE_BRIDGE_FAIL_CLOSED=PASS');

  console.log('HFM_PHASE8_GENERATION_HOOK_DISABLED_BY_DEFAULT=PASS');
  console.log('HFM_PHASE8_GENERATION_HOOK_EXPLICIT_OPT_IN=PASS');
  console.log('HFM_PHASE8_GENERATION_HOOK_NAMED_ADMIN=PASS');
  console.log('HFM_PHASE8_GENERATION_HOOK_UNTRUSTED_EVIDENCE=PASS');
  console.log('HFM_PHASE8_GENERATION_HOOK_NO_CANONICAL_WRITES=PASS');
  console.log('HFM_PHASE8_GENERATION_HOOK_NO_AUTOMATIC_EXECUTION=PASS');
  console.log('HFM_PHASE8_GENERATION_HOOK_COMMIT_RECONCILIATION=PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
