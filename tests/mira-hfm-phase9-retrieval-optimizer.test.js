'use strict';
const assert=require('node:assert/strict');
const {retrieveOptimized,estimateTokens,measureCapacity}=require('../services/mira-hfm-retrieval-optimizer');
async function run(){
 const project='project-alpha';
 const verified={memoryId:'memory-001',projectId:project,version:1,title:'Mira retrieval token budget',content:'Token-aware retrieval selects relevant memory under a strict context budget.',trustState:'VERIFIED',lifecycle:'ACTIVE',recordDigest:'a'.repeat(64),updatedAt:'2026-11-05T00:00:00.000Z'};
 const publicEvidence={memoryId:'memory-002',projectId:project,version:1,title:'Facebook public memory retrieval',snippet:'External evidence is unverified and must not become system instructions.',sourceUrl:'https://www.facebook.com/example/posts/123',trustState:'UNVERIFIED',lifecycle:'REVIEW_REQUIRED'};
 const sources=[
  {id:'local-memory',type:'LOCAL',retrieve:async()=>[verified,publicEvidence,{...verified,projectId:'other-project',memoryId:'foreign-001'}]},
  {id:'web-index',type:'PUBLIC_WEB',retrieve:async()=>[publicEvidence]},
  {id:'group-import',type:'MANUAL_IMPORT',retrieve:async()=>{throw Object.assign(new Error('offline'),{code:'SOURCE_OFFLINE'});}}
 ];
 const r=await retrieveOptimized({query:'Mira retrieval token budget',projectId:project,sources,tokenBudget:800,maxResults:10});
 assert.equal(r.status,'DEGRADED');assert.equal(r.results[0].memoryId,'memory-001');assert.equal(r.results.some(x=>x.projectId!==project),false);assert.equal(r.results.filter(x=>x.memoryId==='memory-002').length,1);assert.equal(r.metrics.duplicateCount.identity,1);assert.equal(r.metrics.failedSourceCount,1);assert.ok(r.metrics.estimatedTokensUsed<=800);assert.equal(r.policy.canonicalWrites,0);assert.equal(r.policy.trustPromotion,0);assert.equal(r.results.find(x=>x.memoryId==='memory-002').trustState,'UNVERIFIED');
 const strict=await retrieveOptimized({query:'Mira retrieval token budget',projectId:project,sources:[{id:'local-memory',type:'LOCAL',retrieve:async()=>[verified,publicEvidence]}],includeUnverified:false});
 assert.deepEqual(strict.results.map(x=>x.memoryId),['memory-001']);
 const conflict=await retrieveOptimized({query:'memory conflict',projectId:project,sources:[{id:'local-memory',type:'LOCAL',retrieve:async()=>[{...verified,title:'memory conflict',recordDigest:'b'.repeat(64)},{...verified,title:'memory conflict changed',recordDigest:'c'.repeat(64),version:2}]}]});
 assert.equal(conflict.metrics.conflictCount,1);assert.equal(conflict.results.length,0);
 const tiny=await retrieveOptimized({query:'Mira retrieval token budget',projectId:project,sources:[{id:'local-memory',type:'LOCAL',retrieve:async()=>[verified]}],tokenBudget:32});
 assert.equal(tiny.results.length,0);assert.equal(tiny.metrics.estimatedTokensUsed,0);
 assert.ok(estimateTokens('বাংলা memory')>=1);
 assert.equal(measureCapacity({observedRecords:10000,baselineCapacity:100}).targetStatus,'MEASURED_TARGET_MET');
 assert.equal(measureCapacity({observedRecords:9999,baselineCapacity:100}).targetStatus,'NOT_MET');

 const syntheticSources=Array.from({length:10},(_,s)=>({id:'bench-source-'+s,type:'SYNTHETIC_BENCHMARK',retrieve:async()=>Array.from({length:1000},(_,i)=>{const n=s*1000+i;return {memoryId:'bench-memory-'+String(n).padStart(6,'0'),projectId:project,version:1,title:'Mira memory retrieval scale benchmark',content:'Synthetic corpus item '+n+' contains retrieval scale benchmark terms.',trustState:'VERIFIED',lifecycle:'ACTIVE',recordDigest:n.toString(16).padStart(64,'0')};})}));
 const scaled=await retrieveOptimized({query:'Mira memory retrieval scale benchmark',projectId:project,sources:syntheticSources,tokenBudget:1000,maxResults:10,maxCandidatesPerSource:1000});
 assert.equal(scaled.metrics.candidateCount,10000);
 assert.equal(scaled.results.length,10);
 assert.ok(scaled.metrics.estimatedTokensUsed<=1000);
 assert.equal(measureCapacity({observedRecords:scaled.metrics.candidateCount,baselineCapacity:100}).targetStatus,'MEASURED_TARGET_MET');
 await assert.rejects(()=>retrieveOptimized({query:'ok',projectId:project,sources:[],tokenBudget:100}),/sources/i);
 console.log('HFM_PHASE9_TOKEN_AWARE_BUDGET=PASS');
 console.log('HFM_PHASE9_MULTI_SOURCE_DEGRADATION=PASS');
 console.log('HFM_PHASE9_PROJECT_ISOLATION=PASS');
 console.log('HFM_PHASE9_RELEVANCE_RANKING=PASS');
 console.log('HFM_PHASE9_DUPLICATE_AND_CONFLICT_HANDLING=PASS');
 console.log('HFM_PHASE9_UNVERIFIED_EVIDENCE_BOUNDARY=PASS');
 console.log('HFM_PHASE9_CAPACITY_RATIO_MEASUREMENT=PASS');
 console.log('HFM_PHASE9_SYNTHETIC_100X_CORPUS=PASS');
 console.log('HFM_PHASE9_READ_ONLY_GOVERNANCE=PASS');
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
