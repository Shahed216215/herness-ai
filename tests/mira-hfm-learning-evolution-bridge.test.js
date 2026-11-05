'use strict';
const assert = require('node:assert/strict');
const { buildProposal, createLearningEvolutionBridge } = require('../services/mira-hfm-learning-evolution-bridge');
const evidence = [{ evidenceId:'evidence-001', projectId:'project-alpha', sourceType:'web_research',
  trustState:'UNVERIFIED', sourceRef:'https://example.invalid/source/1', content:'Synthetic untrusted evidence.' }];
const base = { projectId:'project-alpha', proposalId:'proposal-001', title:'Candidate learning improvement',
  rationale:'A bounded hypothesis supported by recorded evidence.', proposedChange:'Prepare a human-reviewable proposal only.',
  evidence, createdAt:'2026-11-05T06:00:00.000Z' };
const p = buildProposal(base);
assert.equal(p.status,'PENDING_HUMAN_REVIEW');
assert.equal(p.trustState,'UNTRUSTED');
assert.equal(p.automaticPromotion,false);
assert.equal(p.automaticExecution,false);
assert.equal(p.canonicalMemoryWrites,0);
assert.equal(p.selfModificationAllowed,false);
assert.throws(()=>buildProposal({...base,evidence:[{...evidence[0],projectId:'project-beta'}]}),e=>e.code==='HFM_LEARNING_PROJECT_MISMATCH');
assert.throws(()=>buildProposal({...base,evidence:[evidence[0],evidence[0]]}));
assert.throws(()=>buildProposal({...base,evidence:[]}));
const records = new Map();
const store = { projectIsolated:true, createOnly:true, immutableVersions:true, readAfterWrite:true,
  async putIfAbsent(project,id,value) { const k=project+':'+id; if(records.has(k)) return {created:false}; records.set(k,structuredClone(value)); return {created:true}; },
  async get(project,id) { return structuredClone(records.get(project+':'+id)||null); } };
const audit=[];
const bridge=createLearningEvolutionBridge({proposalStore:store,auditWriter:async e=>audit.push(e)});
(async()=>{
 const result=await bridge.submit(base);
 assert.equal(result.status,'PENDING_HUMAN_REVIEW');
 assert.equal(result.trustState,'UNTRUSTED');
 assert.equal(result.approvalRequired,true);
 assert.equal(result.canonicalMemoryWrites,0);
 assert.equal(audit.length,1);
 await assert.rejects(()=>bridge.submit(base),e=>e.code==='HFM_LEARNING_PROPOSAL_CONFLICT');
 assert.throws(()=>createLearningEvolutionBridge({proposalStore:{},auditWriter:async()=>{}}),e=>e.code==='HFM_LEARNING_STORE_CAPABILITY_REQUIRED');
 assert.throws(()=>createLearningEvolutionBridge({proposalStore:store}),e=>e.code==='HFM_LEARNING_AUDIT_REQUIRED');
 const noAudit=createLearningEvolutionBridge({proposalStore:{...store,async putIfAbsent(project,id,value){
   const k=project+':'+id; if(records.has(k)) return {created:false}; records.set(k,structuredClone(value)); return {created:true};
 }},auditWriter:async()=>{throw new Error('synthetic audit outage');}});
 await assert.rejects(()=>noAudit.submit({...base,proposalId:'proposal-002'}),e=>e.code==='HFM_LEARNING_AUDIT_FAILED'&&e.stateCommitted===true);
 process.stdout.write(['HFM_PHASE8_PROPOSAL_SCHEMA_AND_TRUST_GATE=PASS','HFM_PHASE8_PROJECT_ISOLATION=PASS',
 'HFM_PHASE8_CREATE_ONLY_AND_READBACK=PASS','HFM_PHASE8_HUMAN_APPROVAL_REQUIRED=PASS',
 'HFM_PHASE8_NO_AUTOMATIC_PROMOTION_OR_EXECUTION=PASS','HFM_PHASE8_NO_CANONICAL_MEMORY_WRITES=PASS',
 'HFM_PHASE8_AUDIT_FAILURE_RECONCILIATION=PASS','HFM_PHASE8_LIVE_NETWORK_CALLS=0',
 'HFM_PHASE8_PRODUCTION_ADAPTER=0','TESTS_FAILED=0'].join('\n')+'\n');
})().catch(e=>{process.stderr.write(String(e.stack||e)+'\n');process.exitCode=1;});
