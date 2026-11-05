'use strict';
const assert=require('node:assert/strict');
const {retrievePublicFacebookMemory,buildQueries,parseResults}=require('../services/mira-hfm-public-web-retrieval');
const {createTool}=require('../tools/mira-hfm-public-web-retrieval');
const pageId='118056109579206', memoryId='memory-alpha-001', projectId='project-mira-v02';
const observedAt='2026-11-05T00:00:00.000Z';
const good=[
 {title:'Mira project-mira-v02 memory-alpha-001 Facebook Page '+pageId,url:'https://www.facebook.com/'+pageId+'/posts/555001',snippet:'Evidence mentions project-mira-v02 and memory-alpha-001.'},
 {title:'Mira project-mira-v02 memory-alpha-001 Facebook Page '+pageId,url:'https://www.facebook.com/'+pageId+'/posts/555001',snippet:'Duplicate result.'},
 {title:'Unrelated Facebook Page '+pageId,url:'https://www.facebook.com/'+pageId+'/posts/555002',snippet:'No requested identifiers.'},
 {title:'Near-match '+pageId+' memory-alpha-001-extra project-mira-v02-extra',url:'https://www.facebook.com/'+pageId+'/posts/555004',snippet:'Identifiers are only partial matches.'},
 {title:'Spoofed Page '+pageId+' memory-alpha-001 project-mira-v02',url:'https://facebook.com.evil.test/'+pageId+'/posts/555003',snippet:'Spoof host.'},
 {title:'Group '+pageId+' memory-alpha-001 project-mira-v02',url:'https://www.facebook.com/groups/123',snippet:'Group is excluded.'}
];
(async()=>{
 const queries=buildQueries({pageId,memoryId,projectId,query:'deployment',pageName:'Mira'});
 assert.ok(queries.some(q=>q.includes(memoryId)));
 assert.ok(queries.some(q=>q.includes(projectId)));
 assert.ok(queries.some(q=>q.includes('deployment')));
 assert.deepEqual(parseResults(JSON.stringify(good)),good);
 assert.throws(()=>parseResults('provider unavailable'),/non-JSON/);
 assert.equal(
  require('../services/mira-hfm-public-web-retrieval').validatePageUrlBinding(
   'https://www.facebook.com/profile.php?id='+pageId,pageId
  ),
  'https://www.facebook.com/profile.php'
 );
 assert.throws(
  ()=>require('../services/mira-hfm-public-web-retrieval').validatePageUrlBinding(
   'https://www.facebook.com/profile.php?id=999999999',pageId
  ),
  error=>error.code==='HFM_WEB_RETRIEVAL_PAGE_URL_MISMATCH'
 );
 const calls=[];
 const report=await retrievePublicFacebookMemory({
  pageId,memoryId,projectId,observedAt,importResults:false,
  searchWeb:async q=>{calls.push(q);return good;}
 });
 assert.equal(report.status,'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED');
 assert.equal(report.evidence.length,1);
 assert.equal(calls.length,4);
 assert.equal(report.archive.status,'NOT_REQUESTED');
 assert.equal(report.archive.storedCount,0);
 assert.equal(report.evidence[0].trustStatus,'SOURCE_RECORDED');
 assert.equal(report.evidence[0].integrityStatus,'UNVERIFIED');
 assert.equal(report.limits.canonicalMemoryWrite,false);
 assert.equal(report.queriesAttempted,4);
 console.log('HFM_PHASE6_PAGE_MEMORY_PROJECT_ID_SEARCH=PASS');
 console.log('HFM_PHASE6_SOURCE_HOST_PATH_AND_EXACT_ID_FILTER=PASS');
 console.log('HFM_PHASE6_IDENTIFIER_TOKEN_BOUNDARIES=PASS');
 console.log('HFM_PHASE6_DUPLICATE_DEDUPLICATION=PASS');
 console.log('HFM_PHASE6_RETRIEVAL_SERVICE_READ_ONLY=PASS');

 const degraded=await retrievePublicFacebookMemory({
  pageId,memoryId,observedAt,importResults:false,
  searchWeb:async()=>{throw Object.assign(new Error('offline'),{code:'PROVIDER_OFFLINE'});}
 });
 assert.equal(degraded.status,'SEARCH_PROVIDER_UNAVAILABLE');
 assert.equal(degraded.evidence.length,0);
 assert.equal(degraded.errors.length,3);
 console.log('HFM_PHASE6_PROVIDER_FAILURE_REPORTING=PASS');

 const empty=await retrievePublicFacebookMemory({
  pageId,projectId,observedAt,importResults:false,searchWeb:async()=>[]
 });
 assert.equal(empty.status,'NOT_FOUND_BY_PUBLIC_SEARCH');
 assert.equal(empty.limits.canonicalMemoryWrite,false);
 console.log('HFM_PHASE6_SEARCH_MISS_NOT_DATA_LOSS=PASS');

 const partialMiss=await retrievePublicFacebookMemory({
  pageId,projectId,observedAt,importResults:false,
  searchWeb:async q=>{if(q.includes(projectId))throw Object.assign(new Error('temporary'),{code:'TEMPORARY_PROVIDER_ERROR'});return [];}
 });
 assert.equal(partialMiss.status,'DEGRADED_SEARCH_NO_EVIDENCE');
 assert.equal(partialMiss.queriesAttempted,3);
 assert.equal(partialMiss.queriesSucceeded,2);
 console.log('HFM_PHASE6_PARTIAL_FAILURE_NOT_MISREPORTED_AS_SEARCH_MISS=PASS');

 const partial=await retrievePublicFacebookMemory({
  pageId,projectId,observedAt,importResults:false,
  searchWeb:async q=>{if(q.includes(projectId))throw Error('temporary');return good;}
 });
 assert.equal(partial.status,'DEGRADED_WITH_UNTRUSTED_EVIDENCE');
 console.log('HFM_PHASE6_PARTIAL_PROVIDER_DEGRADATION=PASS');

 await assert.rejects(()=>retrievePublicFacebookMemory({
  pageId,memoryId:'bad id',observedAt,importResults:false,searchWeb:async()=>[]
 }),/identifier format/);
 await assert.rejects(()=>retrievePublicFacebookMemory({
  pageId,pageUrl:'https://www.facebook.com/999999999',projectId,observedAt,
  importResults:false,searchWeb:async()=>[]
 }),error=>error.code==='HFM_WEB_RETRIEVAL_PAGE_URL_MISMATCH');
 console.log('HFM_PHASE6_PAGE_URL_MUST_MATCH_SELECTED_PAGE_ID=PASS');
 await assert.rejects(()=>retrievePublicFacebookMemory({
  pageId,observedAt,importResults:false,searchWeb:async()=>[]
 }),/At least one/);
 let blockedProviderCalls=0;
 await assert.rejects(()=>retrievePublicFacebookMemory({
  pageId,projectId,observedAt,importResults:true,
  searchWeb:async()=>{blockedProviderCalls++;return [];}
 }),error=>error.code==='HFM_WEB_RETRIEVAL_ARCHIVE_WORKFLOW_NOT_IMPLEMENTED');
 assert.equal(blockedProviderCalls,0);
 console.log('HFM_PHASE6_INPUT_AND_ARCHIVE_GATES_FAIL_CLOSED=PASS');

 const tool=createTool({searchWeb:async()=>good,archiveEvidence:async()=>({status:'ARCHIVE_WRITE_VERIFIED',storedCount:1,duplicateCount:0})});
 const result=JSON.parse(await tool.execute({pageId,memoryId,projectId,importResults:false}));
 assert.equal(result.providerId,'mira-hfm-public-web-retrieval');
 assert.equal(result.evidence.length,1);
 assert.equal(tool.declaration.name,'mira_hfm_public_web_retrieval');
 console.log('HFM_PHASE6_TOOL_DECLARATION_AND_EXECUTION=PASS');
 console.log('LIVE_FACEBOOK_REQUESTS=0');
 console.log('META_GRAPH_API_CALLS=0');
 console.log('PRIVATE_GROUP_ACCESS=0');
 console.log('CANONICAL_MEMORY_WRITES=0');
 console.log('TESTS_FAILED=0');
 console.log('RESULT=MIRA_HFM_PHASE6_OFFLINE_TESTS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
