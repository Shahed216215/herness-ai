'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {retrieveOptimized,estimateTokens}=require('../services/mira-hfm-retrieval-optimizer');
const {createCanonicalMemorySource,createFacebookResearchArchiveSource,createFacebookGroupImportSource,createModelTokenizerCounter}=require('../services/mira-hfm-retrieval-provider-adapters');
function percentile(values,p){const a=[...values].sort((x,y)=>x-y);return Number(a[Math.min(a.length-1,Math.ceil(p*a.length)-1)].toFixed(3));}
async function run(){
 const project='project-alpha';let facadeCalls=0,archiveCalls=0,groupCalls=0;
 const canonical=createCanonicalMemorySource({retrieveAuthorized:async input=>{
  facadeCalls++;assert.equal(input.projectId,project);assert.equal(input.readOnly,true);
  const record={memoryId:'canonical-001',projectId:project,title:'Canonical Mira Memory',content:'Authorized canonical retrieval content.',version:{revision:3},integrity:{status:'VERIFIED'},lifecycle:'ACTIVE',source:{sourceType:'local',sourceId:'local-1'},timestamps:{updatedAt:'2026-11-05T00:00:00.000Z'}};
  return {records:[record],provenance:[{memoryId:record.memoryId,projectId:project,revision:3,recordDigest:'a'.repeat(64),source:record.source}],eligibility:[{memoryId:record.memoryId,status:'ELIGIBLE',reasonCode:'AUTHORIZED_READ'}]};
 }});
 const archive=createFacebookResearchArchiveSource({pageId:'123456789',lookup:async input=>{
  archiveCalls++;assert.equal(input.pageId,'123456789');
  return {pageId:'123456789',results:[
   {archiveId:'archive-001',evidenceId:'evidence-001',title:'project-alpha public Facebook memory',snippet:'Public memory snippet project-alpha',sourceUrl:'https://facebook.com/page/posts/123',trustStatus:'SOURCE_RECORDED',integrityStatus:'UNVERIFIED'},
   {archiveId:'archive-foreign',title:'other-project public memory',snippet:'not this project',sourceUrl:'https://facebook.com/page/posts/456'}
  ]};
 }});
 const group=createFacebookGroupImportSource({groupId:'group-001',retrieve:async input=>{
  groupCalls++;assert.equal(input.projectId,project);assert.equal(input.groupId,'group-001');
  return {projectId:project,groupId:'group-001',results:[
   {memoryId:'group-memory-001',revision:2,content:'Manual group import content',source:{sourceType:'facebook_group',sourceId:'post-001',sourceUrl:'https://facebook.com/groups/1/posts/2'},recordDigest:'b'.repeat(64),disposition:'PENDING_REVIEW',trustStatus:'SOURCE_RECORDED',integrityStatus:'UNVERIFIED',lifecycle:'PENDING_REVIEW',retrievableAsTrustedMemory:false}
  ]};
 }});
 const rows=await Promise.all([canonical.retrieve('Mira',{projectId:project,limit:10,readOnly:true}),archive.retrieve('project-alpha',{projectId:project,limit:10,readOnly:true}),group.retrieve('group',{projectId:project,limit:10,readOnly:true})]);
 assert.equal(rows[0][0].trustState,'VERIFIED');
 assert.equal(rows[1].length,1);assert.equal(rows[1][0].trustState,'UNVERIFIED');
 assert.equal(rows[2][0].lifecycle,'REVIEW_REQUIRED');
 assert.equal(facadeCalls,1);assert.equal(archiveCalls,1);assert.equal(groupCalls,1);
 const counter=createModelTokenizerCounter({modelId:'test-model-tokenizer-v1',encode:value=>value.match(/\S+/g)||[]});
 assert.equal(counter('one two three'),3);
 const result=await retrieveOptimized({query:'Mira memory content',projectId:project,sources:[canonical,archive,group],tokenBudget:500,maxResults:10,tokenCounter:counter});
 assert.equal(result.metrics.tokenEstimator,'MODEL_TOKENIZER');
 assert.equal(result.metrics.tokenizerModelId,'test-model-tokenizer-v1');
 assert.equal(result.policy.canonicalWrites,0);
 assert.equal(result.results.some(x=>x.memoryId==='canonical-001'),true);
 assert.equal(result.results.some(x=>x.memoryId==='archive-foreign'),false);
 assert.equal(result.results.find(x=>x.memoryId==='archive-001').trustState,'UNVERIFIED');
 assert.equal(result.results.find(x=>x.memoryId==='group-memory-001').trustState,'UNVERIFIED');
 await assert.rejects(()=>retrieveOptimized({query:'Mira',projectId:project,sources:[canonical],tokenBudget:500,tokenCounter:()=>NaN}),/tokenCounter/i);
 await assert.rejects(()=>createModelTokenizerCounter({modelId:'bad'}),/encode/i);
 const benchmark=[];
 for(const size of [100,1000,10000]){
  const times=[];let last;
  for(let round=0;round<3;round++){
   const sourceCount=Math.ceil(size/1000);
   const sources=Array.from({length:sourceCount},(_,s)=>({id:'scale-source-'+s,type:'SYNTHETIC_SCALE',retrieve:async()=>Array.from({length:Math.min(1000,size-s*1000)},(_,i)=>{const n=s*1000+i;return {memoryId:'scale-memory-'+String(n).padStart(6,'0'),projectId:project,version:1,title:'Mira retrieval scale benchmark',content:'Synthetic retrieval benchmark record '+n,trustState:'VERIFIED',lifecycle:'ACTIVE',recordDigest:n.toString(16).padStart(64,'0')};})}));
   const started=performance.now();
   last=await retrieveOptimized({query:'Mira retrieval scale benchmark',projectId:project,sources,tokenBudget:2500,maxResults:10,maxCandidatesPerSource:1000});
   times.push(performance.now()-started);
  }
  assert.equal(last.metrics.candidateCount,size);
  assert.equal(last.results.length,10);
  benchmark.push({records:size,ratio:size/100,p50Ms:percentile(times,.5),p95Ms:percentile(times,.95)});
 }
 assert.equal(benchmark[0].ratio,1);assert.equal(benchmark[1].ratio,10);assert.equal(benchmark[2].ratio,100);
 console.log('HFM_PHASE9_CANONICAL_FACADE_ADAPTER=PASS');
 console.log('HFM_PHASE9_FACEBOOK_PUBLIC_ARCHIVE_ADAPTER=PASS');
 console.log('HFM_PHASE9_FACEBOOK_GROUP_IMPORT_ADAPTER=PASS');
 console.log('HFM_PHASE9_MODEL_TOKENIZER_INJECTION=PASS');
 console.log('HFM_PHASE9_PROVIDER_SCOPE_AND_TRUST_BOUNDARY=PASS');
 console.log('HFM_PHASE9_SCALE_BENCHMARKS='+JSON.stringify(benchmark));
 console.log('HFM_PHASE9_SCALE_BENCHMARK_EXECUTION=PASS');
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
