'use strict';
const crypto = require('node:crypto');
const DEFAULTS = Object.freeze({tokenBudget:1800,maxResults:12,maxCandidatesPerSource:100,maxQueryLength:2000,maxContentLength:20000,minScore:0.01});
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function requiredText(v,label,max){if(typeof v!=='string'||!v.trim()||v.length>max)fail('HFM_RETRIEVAL_INVALID_INPUT',label+' is required bounded text.');return v.trim();}
function tokenize(v){return [...new Set((String(v||'').toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)||[]))];}
function estimateTokens(v){return Math.max(1,Math.ceil(Buffer.byteLength(String(v||''),'utf8')/3)+4);}
function digest(v){return crypto.createHash('sha256').update(String(v),'utf8').digest('hex');}
function normalizedUrl(v){if(typeof v!=='string'||!v.trim())return '';try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password)return '';u.hash='';return u.toString().replace(/\/$/,'');}catch{return '';}}
function normalizeCandidate(raw,source,projectId){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.projectId!==projectId)return null;
 if(typeof raw.memoryId!=='string'||!ID_PATTERN.test(raw.memoryId))return null;
 const title=typeof raw.title==='string'?raw.title.slice(0,1000):'';
 const content=typeof raw.content==='string'?raw.content.slice(0,DEFAULTS.maxContentLength):'';
 const snippet=typeof raw.snippet==='string'?raw.snippet.slice(0,3000):'';
 if(!title&&!content&&!snippet)return null;
 const version=Number.isSafeInteger(raw.version)&&raw.version>0?raw.version:null;
 const trustState=raw.trustState==='VERIFIED'?'VERIFIED':'UNVERIFIED';
 const lifecycle=raw.lifecycle==='ACTIVE'?'ACTIVE':'REVIEW_REQUIRED';
 const sourceUrl=normalizedUrl(raw.sourceUrl);
 const recordDigest=typeof raw.recordDigest==='string'&&/^[a-f0-9]{64}$/i.test(raw.recordDigest)?raw.recordDigest.toLowerCase():digest([raw.memoryId,raw.projectId,version,title,content,snippet].join('\n'));
 return {memoryId:raw.memoryId,projectId,version,title,content,snippet,source:{providerId:source.id,providerType:source.type,sourceUrl,sourceRef:typeof raw.sourceRef==='string'?raw.sourceRef.slice(0,512):null},trustState,lifecycle,recordDigest,updatedAt:Number.isFinite(Date.parse(raw.updatedAt||''))?new Date(raw.updatedAt).toISOString():null};
}
function scoreCandidate(q,c,df,n){
 const title=new Set(tokenize(c.title)),body=new Set(tokenize(c.content+' '+c.snippet));let score=0;const matchedTerms=[];
 for(const term of q){const t=title.has(term),b=body.has(term);if(!t&&!b)continue;matchedTerms.push(term);const d=df.get(term)||0;score+=Math.log(1+(n-d+0.5)/(d+0.5))*((t?2.5:0)+(b?1:0));}
 return {score:Number((q.length?score/Math.sqrt(q.length):0).toFixed(6)),coverage:Number((q.length?matchedTerms.length/q.length:0).toFixed(4)),matchedTerms};
}
function resolveDuplicates(items){
 const groups=new Map();for(const x of items){const k=x.projectId+':'+x.memoryId;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x);}
 const kept=[],conflicts=[],duplicateCount={identity:0,digest:0,url:0};
 for(const [identity,list] of groups){const ds=new Set(list.map(x=>x.recordDigest)),vs=new Set(list.map(x=>x.version).filter(Number.isInteger));if(ds.size>1||vs.size>1){conflicts.push({identity,status:'CONFLICT',candidateDigests:[...ds].sort()});continue;}list.sort((a,b)=>Number(b.trustState==='VERIFIED')-Number(a.trustState==='VERIFIED'));kept.push(list[0]);duplicateCount.identity+=list.length-1;}
 const digests=new Set(),urls=new Set(),out=[];for(const x of kept){if(digests.has(x.recordDigest)){duplicateCount.digest++;continue;}const u=x.source.sourceUrl;if(u&&urls.has(u)){duplicateCount.url++;continue;}digests.add(x.recordDigest);if(u)urls.add(u);out.push(x);}
 return {candidates:out,conflicts,duplicateCount};
}
function safeErrorCode(e){return typeof e?.code==='string'&&/^[A-Z0-9_-]{1,64}$/.test(e.code)?e.code:'SOURCE_UNAVAILABLE';}
async function retrieveOptimized({query,projectId,sources,tokenBudget=DEFAULTS.tokenBudget,maxResults=DEFAULTS.maxResults,maxCandidatesPerSource=DEFAULTS.maxCandidatesPerSource,minScore=DEFAULTS.minScore,includeUnverified=true}={}){
 requiredText(query,'query',DEFAULTS.maxQueryLength);requiredText(projectId,'projectId',128);
 if(!Array.isArray(sources)||sources.length<1||sources.length>12)fail('HFM_RETRIEVAL_INVALID_SOURCES','Between 1 and 12 injected sources are required.');
 if(!Number.isInteger(tokenBudget)||tokenBudget<32||tokenBudget>100000||!Number.isInteger(maxResults)||maxResults<1||maxResults>100||!Number.isInteger(maxCandidatesPerSource)||maxCandidatesPerSource<1||maxCandidatesPerSource>1000)fail('HFM_RETRIEVAL_INVALID_BUDGET','Retrieval limits are outside supported bounds.');
 const q=tokenize(query);if(!q.length)fail('HFM_RETRIEVAL_EMPTY_QUERY','Query contains no searchable terms.');
 const sourceReports=[],collected=[];
 for(const source of sources){
  if(!source||typeof source.id!=='string'||!/^[A-Za-z0-9._:-]{2,128}$/.test(source.id)||typeof source.type!=='string'||typeof source.retrieve!=='function'){sourceReports.push({sourceId:'INVALID_SOURCE',status:'FAILED',errorCode:'INVALID_ADAPTER'});continue;}
  try{const response=await source.retrieve(query,{projectId,limit:maxCandidatesPerSource,readOnly:true});const rows=Array.isArray(response)?response:response?.records;if(!Array.isArray(rows))throw Object.assign(new Error('Invalid source response.'),{code:'INVALID_RESPONSE'});let accepted=0;
   for(const raw of rows.slice(0,maxCandidatesPerSource)){const item=normalizeCandidate(raw,source,projectId);if(!item||(!includeUnverified&&(item.trustState!=='VERIFIED'||item.lifecycle!=='ACTIVE')))continue;collected.push(item);accepted++;}
   sourceReports.push({sourceId:source.id,status:'OK',returned:rows.length,accepted});
  }catch(e){sourceReports.push({sourceId:source.id,status:'DEGRADED',errorCode:safeErrorCode(e)});}
 }
 const deduped=resolveDuplicates(collected),df=new Map();
 for(const x of deduped.candidates){const terms=new Set([...tokenize(x.title),...tokenize(x.content),...tokenize(x.snippet)]);for(const t of terms)df.set(t,(df.get(t)||0)+1);}
 const ranked=deduped.candidates.map(x=>({...x,relevance:scoreCandidate(q,x,df,deduped.candidates.length)})).filter(x=>x.relevance.score>=minScore).sort((a,b)=>b.relevance.score-a.relevance.score||Number(b.trustState==='VERIFIED')-Number(a.trustState==='VERIFIED')||(b.updatedAt||'').localeCompare(a.updatedAt||'')||a.memoryId.localeCompare(b.memoryId));
 const results=[];let used=0;
 for(const x of ranked){if(results.length>=maxResults)break;const item={memoryId:x.memoryId,projectId:x.projectId,version:x.version,title:x.title,content:x.content,snippet:x.snippet,source:x.source,trustState:x.trustState,lifecycle:x.lifecycle,recordDigest:x.recordDigest,updatedAt:x.updatedAt,relevance:x.relevance};const cost=estimateTokens(JSON.stringify(item));if(used+cost>tokenBudget)continue;results.push({...item,estimatedTokens:cost});used+=cost;}
 const ok=sourceReports.filter(x=>x.status==='OK').length,failed=sourceReports.length-ok;
 return Object.freeze({schemaVersion:'1.0.0',status:failed&&ok?'DEGRADED':failed?'FAILED':results.length?'OK':'EMPTY',queryDigest:digest(query),projectId,results,conflicts:deduped.conflicts,sourceReports,metrics:{sourceCount:sources.length,successfulSourceCount:ok,failedSourceCount:failed,candidateCount:collected.length,deduplicatedCount:deduped.candidates.length,duplicateCount:deduped.duplicateCount,conflictCount:deduped.conflicts.length,rankedCount:ranked.length,returnedCount:results.length,tokenBudget,estimatedTokensUsed:used,estimatedTokensRemaining:tokenBudget-used,tokenEstimator:'UTF8_BYTES_DIV_3_PLUS_4_HEURISTIC_NOT_MODEL_TOKENIZER'},policy:{readOnly:true,canonicalWrites:0,trustPromotion:0,sourceInstructionsExecutable:false,unverifiedEvidenceRemainsUntrusted:true,searchMissMeansDataLoss:false}});
}
function measureCapacity({observedRecords,baselineCapacity}){if(!Number.isSafeInteger(observedRecords)||observedRecords<0||!Number.isSafeInteger(baselineCapacity)||baselineCapacity<1)fail('HFM_CAPACITY_INVALID_MEASUREMENT','Capacity measurements must be non-negative integer counts.');const ratio=observedRecords/baselineCapacity;return Object.freeze({observedRecords,baselineCapacity,observedCapacityMultiple:Number(ratio.toFixed(4)),targetMultiple:100,targetStatus:ratio>=100?'MEASURED_TARGET_MET':'NOT_MET',performanceClaim:false,note:'Record-count ratio only; does not prove latency, throughput, durability, storage quota or 100x end-to-end capacity.'});}
module.exports={DEFAULTS,tokenize,estimateTokens,digest,normalizedUrl,scoreCandidate,resolveDuplicates,retrieveOptimized,measureCapacity};
