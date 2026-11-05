'use strict';

const assert = require('node:assert/strict');
const { dispatchGenerationCycleProposalHandoff } = require('../services/mira-hfm-learning-generation-cycle-dispatch');

const report = {
  providerId:'mira-hfm-public-web-retrieval',
  retrievalMode:'PUBLIC_FACEBOOK_SEARCH_INDEX_ONLY',
  status:'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED',
  page:{pageId:'123456789'},
  lookup:{projectId:'project-alpha'},
  limits:{canonicalMemoryWrite:false,trustPromotion:false,directFacebookFetches:0,
    metaGraphApiCalls:0,loginOrCookieUse:0,privateOrGroupContentAccess:0},
  evidence:[{evidenceId:'evidence-1',pageId:'123456789',
    sourceUrl:'https://www.facebook.com/123456789/posts/987654321'}]
};
const proposalInput = {projectId:'project-alpha',proposalId:'proposal-1',
  title:'Candidate',rationale:'Review',proposedChange:'Human review only'};
const actor = {authenticated:true,role:'admin',actorId:'named-admin'};

(async()=>{
  let calls=0, captured=null;
  const stage=async input=>{
    calls++; captured=input;
    return {success:true,status:'STAGED_FOR_HUMAN_REVIEW',
      canonicalMemoryWrites:0,automaticExecution:false,trustPromotion:false};
  };

  let r=await dispatchGenerationCycleProposalHandoff({
    toolName:'mira_hfm_public_web_retrieval',explicitOptIn:false,
    actor,proposalInput,toolResult:report,stage
  });
  assert.equal(r.attempted,false); assert.equal(calls,0);

  r=await dispatchGenerationCycleProposalHandoff({
    toolName:'other_tool',explicitOptIn:true,actor,proposalInput,toolResult:report,stage
  });
  assert.equal(r.attempted,false); assert.equal(calls,0);

  r=await dispatchGenerationCycleProposalHandoff({
    toolName:'mira_hfm_public_web_retrieval',explicitOptIn:true,alreadyAttempted:true,
    actor,proposalInput,toolResult:report,stage
  });
  assert.equal(r.handoff,null); assert.equal(calls,0);

  r=await dispatchGenerationCycleProposalHandoff({
    toolName:'mira_hfm_public_web_retrieval',explicitOptIn:true,
    actor:{authenticated:true,role:'user',actorId:'user-1'},proposalInput,toolResult:report,stage
  });
  assert.equal(r.handoff.code,'HFM_LEARNING_NAMED_ADMIN_REQUIRED'); assert.equal(calls,0);

  r=await dispatchGenerationCycleProposalHandoff({
    toolName:'mira_hfm_public_web_retrieval',explicitOptIn:true,
    actor,proposalInput:null,toolResult:report,stage
  });
  assert.equal(r.handoff.code,'HFM_LEARNING_PROPOSAL_INPUT_REQUIRED'); assert.equal(calls,0);

  r=await dispatchGenerationCycleProposalHandoff({
    toolName:'mira_hfm_public_web_retrieval',explicitOptIn:true,
    actor,proposalInput,toolResult:'{invalid',stage
  });
  assert.equal(r.handoff.code,'HFM_LEARNING_RETRIEVAL_RESULT_INVALID'); assert.equal(calls,0);

  r=await dispatchGenerationCycleProposalHandoff({
    toolName:'mira_hfm_public_web_retrieval',explicitOptIn:true,
    actor,proposalInput,toolResult:JSON.stringify(report),stage
  });
  assert.equal(r.attempted,true); assert.equal(r.handoff.status,'STAGED_FOR_HUMAN_REVIEW');
  assert.equal(calls,1); assert.equal(captured.retrievalResult.providerId,report.providerId);
  assert.deepEqual(captured.actor,{authenticated:true,role:'admin',actorId:'named-admin'});
  assert.equal(captured.projectId,'project-alpha');

  r=await dispatchGenerationCycleProposalHandoff({
    toolName:'mira_hfm_public_web_retrieval',explicitOptIn:true,
    actor,proposalInput,toolResult:report,stage:async()=>{throw Object.assign(new Error('failure'),{code:'STAGE_FAILURE'});}
  });
  assert.equal(r.handoff.status,'NOT_CERTIFIED');
  assert.equal(r.handoff.code,'STAGE_FAILURE');
  assert.equal(r.handoff.canonicalMemoryWrites,0);

  console.log('HFM_PHASE8_AGENT_DISPATCH_EXPLICIT_OPT_IN=PASS');
  console.log('HFM_PHASE8_AGENT_DISPATCH_RETRIEVAL_TOOL_BOUNDARY=PASS');
  console.log('HFM_PHASE8_AGENT_DISPATCH_SINGLE_ATTEMPT=PASS');
  console.log('HFM_PHASE8_AGENT_DISPATCH_NAMED_ADMIN=PASS');
  console.log('HFM_PHASE8_AGENT_DISPATCH_PROPOSAL_INPUT_REQUIRED=PASS');
  console.log('HFM_PHASE8_AGENT_DISPATCH_RETRIEVAL_REPORT_VALIDATION=PASS');
  console.log('HFM_PHASE8_AGENT_DISPATCH_PROJECT_CONTEXT_PASSTHROUGH=PASS');
  console.log('HFM_PHASE8_AGENT_DISPATCH_FAILURE_FAIL_CLOSED=PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
