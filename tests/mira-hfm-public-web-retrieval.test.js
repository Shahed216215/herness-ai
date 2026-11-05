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
 const calls=[],archived=[];
 const report=await retrievePublicFacebookMemory({
  pageId,memoryId,projectId,observedAt,importResults:true,
  searchWeb:async q=>{calls.push(q);return good;},
  archiveEvidence:async x=>{archived.push(x);return {status:'ARCHIVE_WRITE_VERIFIED',storedCount:x.evidence.length,duplicateCount:0,canonicalMemoryWrite:false};}
 });
 assert.equal(report.status,'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED');
 assert.equal(report.evidence.length,1);
 assert.equal(calls.length,4);
 assert.equal(archived.length,1);
 assert.equal(archived[0].evidence.length,1);
 assert.equal(report.archive.status,'ARCHIVE_WRITE_VERIFIED');
 assert.equal(report.evidence[0].trustStatus,'SOURCE_RECORDED');
 assert.equal(report.evidence[0].integrityStatus,'UNVERIFIED');
 assert.equal(report.limits.canonicalMemoryWrite,false);
 console.log('HFM_PHASE6_PAGE_MEMORY_PROJECT_ID_SEARCH=PASS');
 console.log('HFM_PHASE6_SOURCE_HOST_PATH_AND_EXACT_ID_FILTER=PASS');
 console.log('HFM_PHASE6_DUPLICATE_DEDUPLICATION=PASS');
 console.log('HFM_PHASE6_UNTRUSTED_ARCHIVE_IMPORT=PASS');

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
  pageId,observedAt,importResults:false,searchWeb:async()=>[]
 }),/At least one/);
 await assert.rejects(()=>retrievePublicFacebookMemory({
  pageId,projectId,observedAt,importResults:true,searchWeb:async()=>[]
 }),/archive writer is required/);
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
