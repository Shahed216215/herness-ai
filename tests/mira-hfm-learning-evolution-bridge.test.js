'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildProposal, createLearningEvolutionBridge, hasProductionIntegrationCapabilities } = require('../services/mira-hfm-learning-evolution-bridge');
const { createPersistentProposalStore } = require('../services/mira-hfm-learning-proposal-store');
const { fromPublicRetrieval } = require('../services/mira-hfm-learning-evidence-adapter');
const evidence = [{ evidenceId:'evidence-001', projectId:'project-alpha', sourceType:'web_research',
  trustState:'UNVERIFIED', sourceRef:'https://example.invalid/source/1', content:'Synthetic untrusted evidence.' }];
const base = { projectId:'project-alpha', proposalId:'proposal-001', title:'Candidate learning improvement',
  rationale:'A bounded hypothesis supported by recorded evidence.', proposedChange:'Prepare a human-reviewable proposal only.',
  evidence, createdAt:'2026-11-05T06:00:00.000Z' };
const rawRetrieval = {
  providerId:'mira-hfm-public-web-retrieval', retrievalMode:'PUBLIC_FACEBOOK_SEARCH_INDEX_ONLY',
  status:'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED', page:{pageId:'123456789'},
  limits:{canonicalMemoryWrite:false,trustPromotion:false,directFacebookFetches:0,metaGraphApiCalls:0,loginOrCookieUse:0,privateOrGroupContentAccess:0},
  evidence:[{evidenceId:'fbweb-evidence-001',pageId:'123456789',
    sourceUrl:'https://www.facebook.com/123456789/posts/987654321',
    title:'Public page post',snippet:'Synthetic indexed snippet.'}]
};
const retrievalInput = fromPublicRetrieval({
  projectId:'project-alpha', proposalId:'proposal-retrieval-001',
  title:'Public research learning candidate', rationale:'Review public indexed evidence before any learning action.',
  proposedChange:'Prepare a human-reviewed learning candidate.', retrievalResult:rawRetrieval
});
assert.equal(retrievalInput.evidenceOrigin,'HFM_PUBLIC_FACEBOOK_SEARCH_RESULT_UNVERIFIED');
assert.equal(retrievalInput.evidence[0].trustState,'UNVERIFIED');
assert.equal(buildProposal(retrievalInput).trustState,'UNTRUSTED');
assert.throws(()=>fromPublicRetrieval({projectId:'project-alpha',proposalId:'proposal-retrieval-002',
  title:'Invalid evidence candidate',rationale:'This must be blocked.',proposedChange:'No changes.',
  retrievalResult:{...rawRetrieval,limits:{canonicalMemoryWrite:true,trustPromotion:false}}}),
  e=>e.code==='HFM_LEARNING_RETRIEVAL_INVALID');
assert.throws(()=>fromPublicRetrieval({projectId:'project-alpha',proposalId:'proposal-retrieval-003',
  title:'Invalid source candidate',rationale:'This must be blocked.',proposedChange:'No changes.',
  retrievalResult:{...rawRetrieval,evidence:[{...rawRetrieval.evidence[0],sourceUrl:'https://evil.example/x'}]}}),
  e=>e.code==='HFM_LEARNING_RETRIEVAL_INVALID');
assert.throws(()=>fromPublicRetrieval({projectId:'project-alpha',proposalId:'proposal-retrieval-004',
  title:'Mismatched Page path',rationale:'This must be blocked.',proposedChange:'No changes.',
  retrievalResult:{...rawRetrieval,evidence:[{...rawRetrieval.evidence[0],sourceUrl:'https://www.facebook.com/other/posts/987654321'}]}}),
  e=>e.code==='HFM_LEARNING_RETRIEVAL_INVALID');
assert.throws(()=>fromPublicRetrieval({projectId:'project-alpha',proposalId:'proposal-retrieval-005',
  title:'Trusted-state spoof',rationale:'This must be blocked.',proposedChange:'No changes.',
  retrievalResult:{...rawRetrieval,evidence:[{...rawRetrieval.evidence[0],trustStatus:'TRUSTED'}]}}),
  e=>e.code==='HFM_LEARNING_RETRIEVAL_INVALID');
assert.throws(()=>fromPublicRetrieval({projectId:'project-alpha',proposalId:'proposal-retrieval-006',
  title:'Provider miss with forged evidence',rationale:'This must be blocked.',proposedChange:'No changes.',
  retrievalResult:{...rawRetrieval,status:'NOT_FOUND_BY_PUBLIC_SEARCH'}}),
  e=>e.code==='HFM_LEARNING_RETRIEVAL_INVALID');

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
const memoryStore = { projectIsolated:true, createOnly:true, immutableVersions:true, readAfterWrite:true,
  async putIfAbsent(project,id,value) { const k=project+':'+id; if(records.has(k)) return {created:false}; records.set(k,structuredClone(value)); return {created:true}; },
  async get(project,id) { return structuredClone(records.get(project+':'+id)||null); } };
const audit=[];
const bridge=createLearningEvolutionBridge({proposalStore:memoryStore,auditWriter:async e=>audit.push(e)});
const localAudit = async () => {};
const productionStore = {
  ...memoryStore,
  durable: true,
  crossInstanceAtomicCreate: true
};
const productionAudit = async () => {};
productionAudit.durable = true;
assert.equal(hasProductionIntegrationCapabilities({
  proposalStore: memoryStore, auditWriter: localAudit, productionIntegrationReady: true
}), false);
assert.equal(hasProductionIntegrationCapabilities({
  proposalStore: productionStore, auditWriter: productionAudit, productionIntegrationReady: false
}), false);
assert.equal(hasProductionIntegrationCapabilities({
  proposalStore: productionStore, auditWriter: productionAudit, productionIntegrationReady: true
}), true);
(async()=>{
 const result=await bridge.submit(base,{actorRole:'admin'});
 assert.equal(result.status,'PENDING_HUMAN_REVIEW');
 assert.equal(result.trustState,'UNTRUSTED');
 assert.equal(result.approvalRequired,true);
 assert.equal(result.canonicalMemoryWrites,0);
 assert.equal(audit.length,1);
 assert.equal(audit[0].actorRole,'admin');
 await assert.rejects(()=>bridge.submit(base),e=>e.code==='HFM_LEARNING_PROPOSAL_CONFLICT');
 assert.throws(()=>createLearningEvolutionBridge({proposalStore:{},auditWriter:async()=>{}}),e=>e.code==='HFM_LEARNING_STORE_CAPABILITY_REQUIRED');
 assert.throws(()=>createLearningEvolutionBridge({proposalStore:memoryStore}),e=>e.code==='HFM_LEARNING_AUDIT_REQUIRED');

 const noAudit=createLearningEvolutionBridge({proposalStore:{...memoryStore,async putIfAbsent(project,id,value){
   const k=project+':'+id; if(records.has(k)) return {created:false}; records.set(k,structuredClone(value)); return {created:true};
 }},auditWriter:async()=>{throw new Error('synthetic audit outage');}});
 await assert.rejects(()=>noAudit.submit({...base,proposalId:'proposal-002'}),
   e=>e.code==='HFM_LEARNING_AUDIT_FAILED'&&e.stateCommitted===true);

 const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mira-hfm-phase8-'));
 try {
   const persistent=createPersistentProposalStore({baseDirectory:tempRoot});
   assert.equal(persistent.durable, false);
   assert.equal(persistent.crossInstanceAtomicCreate, false);
   assert.equal(persistent.storageMode, 'LOCAL_SINGLE_INSTANCE_ONLY');
   const durableBridge=createLearningEvolutionBridge({proposalStore:persistent,auditWriter:async()=>{}});
   const durableResult=await durableBridge.submit({...base,proposalId:'proposal-durable-001'});
   assert.equal(durableResult.status,'PENDING_HUMAN_REVIEW');
   const reopened=createPersistentProposalStore({baseDirectory:tempRoot});
   const restored=await reopened.get('project-alpha','proposal-durable-001');
   assert.equal(restored.proposalDigest,durableResult.proposalDigest);
   assert.equal((await reopened.putIfAbsent('project-alpha','proposal-durable-001',restored)).created,false);
   assert.equal(await reopened.get('project-beta','proposal-durable-001'),null);
   const verified=await createLearningEvolutionBridge({proposalStore:reopened,auditWriter:async()=>{}}).get('project-alpha','proposal-durable-001');
   assert.equal(verified.proposalDigest,durableResult.proposalDigest);
   const tamperedPath=path.join(tempRoot,require('node:crypto').createHash('sha256').update('project-alpha').digest('hex'),
     require('node:crypto').createHash('sha256').update('proposal-durable-001').digest('hex')+'.json');
   const tampered=JSON.parse(fs.readFileSync(tamperedPath,'utf8'));
   tampered.evidence[0].content='tampered';
   fs.writeFileSync(tamperedPath,JSON.stringify(tampered));
   await assert.rejects(()=>createLearningEvolutionBridge({proposalStore:reopened,auditWriter:async()=>{}}).get('project-alpha','proposal-durable-001'),
     e=>e.code==='HFM_LEARNING_STORED_INTEGRITY_FAILED');
 } finally {
   fs.rmSync(tempRoot,{recursive:true,force:true});
 }

 process.stdout.write(['HFM_PHASE8_PROPOSAL_SCHEMA_AND_TRUST_GATE=PASS','HFM_PHASE8_PROJECT_ISOLATION=PASS',
 'HFM_PHASE8_CREATE_ONLY_AND_READBACK=PASS','HFM_PHASE8_HUMAN_APPROVAL_REQUIRED=PASS',
 'HFM_PHASE8_NO_AUTOMATIC_PROMOTION_OR_EXECUTION=PASS','HFM_PHASE8_NO_CANONICAL_MEMORY_WRITES=PASS',
 'HFM_PHASE8_AUDIT_FAILURE_RECONCILIATION=PASS','HFM_PHASE8_DURABLE_STORE_REOPEN_AND_IMMUTABILITY=PASS',
 'HFM_PHASE8_STORED_TAMPER_DETECTION=PASS','HFM_PHASE8_PUBLIC_RETRIEVAL_EVIDENCE_ADAPTER=PASS',
 'HFM_PHASE8_RETRIEVAL_TRUST_AND_SOURCE_GATES=PASS','HFM_PHASE8_PRODUCTION_PERSISTENCE_GATE=PASS',
 'HFM_PHASE8_LOCAL_STORE_NOT_PRODUCTION_CERTIFIED=PASS','HFM_PHASE8_LIVE_NETWORK_CALLS=0',
 'HFM_PHASE8_PRODUCTION_DATABASE_ADAPTER=0','TESTS_FAILED=0'].join('\n')+'\n');
})().catch(e=>{process.stderr.write(String(e.stack||e)+'\n');process.exitCode=1;});
