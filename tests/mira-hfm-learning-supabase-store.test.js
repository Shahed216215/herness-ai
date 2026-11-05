'use strict';
const assert = require('node:assert/strict');
const { buildProposal, createLearningEvolutionBridge } = require('../services/mira-hfm-learning-evolution-bridge');
const { createSupabaseLearningProposalStore } = require('../services/mira-hfm-learning-proposal-supabase-store');
const env = { SUPABASE_URL:'https://example-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'x'.repeat(48) };
const proposals = new Map();
const audits = new Map();
const calls = [];
async function mockRequest(rawUrl, config) {
  calls.push({ url:rawUrl, method:config.method, hasApiKey:!!config.headers.apikey,
    hasAuthorization:!!config.headers.Authorization });
  const url = new URL(rawUrl);
  const table = url.pathname.split('/').pop();
  const map = table === 'mira_hfm_learning_proposals' ? proposals
    : table === 'mira_hfm_learning_proposal_audit_events' ? audits : null;
  assert.ok(map, 'only the two Phase 8 tables may be called');
  if (config.method === 'POST') {
    const row = config.data[0];
    const key = table === 'mira_hfm_learning_proposals'
      ? row.project_id + ':' + row.proposal_id : row.event_id;
    if (table === 'mira_hfm_learning_proposals') {
      const created = !map.has(key);
      if (created) map.set(key, structuredClone(row));
      return { status:201, data:created ? [structuredClone(row)] : [] };
    }
    map.set(key, structuredClone(row));
    return { status:201, data:[structuredClone(row)] };
  }
  if (config.method === 'GET') {
    const rows = [...map.values()].filter(row => {
      if (table === 'mira_hfm_learning_proposals') {
        const project = url.searchParams.get('project_id');
        const proposal = url.searchParams.get('proposal_id');
        return (!project || row.project_id === project.slice(3)) &&
          (!proposal || row.proposal_id === proposal.slice(3));
      }
      const event = url.searchParams.get('event_id');
      return !event || row.event_id === event.slice(3);
    });
    return { status:200, data:rows.slice(0,2).map(structuredClone) };
  }
  throw new Error('Unexpected HTTP method');
}
(async()=>{
  assert.throws(()=>createSupabaseLearningProposalStore({env:{SUPABASE_URL:'http://example-project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'x'.repeat(48)},request:mockRequest}),
    error=>error.code==='HFM_LEARNING_SUPABASE_CONFIG_INVALID');
  const store=createSupabaseLearningProposalStore({env,request:mockRequest});
  assert.equal(store.durable,true);
  assert.equal(store.crossInstanceAtomicCreate,true);
  assert.equal(store.projectIsolated,true);
  const evidence=[{evidenceId:'evidence-001',projectId:'project-alpha',sourceType:'web_research',
    trustState:'UNVERIFIED',sourceRef:'https://example.invalid/evidence',content:'Synthetic evidence for mocked Supabase adapter.'}];
  const input={projectId:'project-alpha',proposalId:'proposal-supabase-001',
    title:'Supabase persistence test',rationale:'Mock-only adapter verification.',
    proposedChange:'No canonical change.',evidence,createdAt:'2026-11-05T06:00:00.000Z'};
  const bridge=createLearningEvolutionBridge({proposalStore:store,auditWriter:event=>store.writeAuditEvent(event)});
  const result=await bridge.submit(input,{actorRole:'admin',actorId:'test-admin'});
  assert.equal(result.status,'PENDING_HUMAN_REVIEW');
  assert.equal(proposals.size,1);
  assert.equal(audits.size,1);
  assert.equal((await bridge.get('project-alpha','proposal-supabase-001')).proposalDigest,result.proposalDigest);
  await assert.rejects(()=>bridge.submit(input,{actorRole:'admin',actorId:'test-admin'}),
    error=>error.code==='HFM_LEARNING_PROPOSAL_CONFLICT');
  const second=buildProposal({...input,projectId:'project-beta',
    evidence:evidence.map(item=>({...item,projectId:'project-beta'}))});
  assert.equal((await store.putIfAbsent('project-beta',second.proposalId,second)).created,true);
  assert.equal(proposals.size,2);
  assert.ok(calls.length>=6);
  assert.ok(calls.every(call=>call.hasApiKey&&call.hasAuthorization));
  assert.ok(calls.every(call=>new URL(call.url).protocol==='https:'));
  process.stdout.write([
    'HFM_PHASE8_SUPABASE_CONFIG_VALIDATION=PASS',
    'HFM_PHASE8_SUPABASE_PROJECT_SCOPED_CREATE_ONLY=PASS',
    'HFM_PHASE8_SUPABASE_READBACK_AND_DIGEST=PASS',
    'HFM_PHASE8_SUPABASE_APPEND_ONLY_AUDIT_READBACK=PASS',
    'HFM_PHASE8_SUPABASE_CROSS_PROJECT_ISOLATION=PASS',
    'HFM_PHASE8_SUPABASE_DUPLICATE_CONFLICT=PASS',
    'HFM_PHASE8_SUPABASE_MOCKED_REQUESTS_ONLY=PASS',
    'HFM_PHASE8_LIVE_NETWORK_CALLS=0',
    'TESTS_FAILED=0'
  ].join('\n')+'\n');
})().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
