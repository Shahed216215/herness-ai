'use strict';

const crypto = require('node:crypto');
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function text(v,label,max=512){if(typeof v!=='string'||!v.trim()||v.length>max)fail('HFM_ADAPTER_INVALID_INPUT',label+' must be bounded text.');return v.trim();}
function digest(value){return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value),'utf8').digest('hex');}
function exactToken(haystack,needle){return String(haystack||'').split(/[^A-Za-z0-9._:-]+/).filter(Boolean).includes(needle);}
function safeHttps(value){if(typeof value!=='string')return '';try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return '';u.hash='';return u.toString().replace(/\/$/,'');}catch{return '';}}
function contentText(record){
 const value=typeof record.content==='string'?record.content:
  typeof record.payload?.content==='string'?record.payload.content:
  typeof record.data?.content==='string'?record.data.content:'';
 return value.slice(0,20000);
}
function createCanonicalMemorySource({retrieveAuthorized}={}){
 if(typeof retrieveAuthorized!=='function')fail('HFM_ADAPTER_INVALID_INPUT','retrieveAuthorized must be the existing authorized HFM facade read.');
 return Object.freeze({id:'hfm-canonical-memory',type:'CANONICAL_MEMORY',async retrieve(query,{projectId,limit,readOnly}={}){
  if(readOnly!==true)fail('HFM_ADAPTER_READ_ONLY_REQUIRED','Canonical adapter only supports readOnly=true.');
  const report=await retrieveAuthorized({query,projectId,limit,readOnly:true});
  if(!report||!Array.isArray(report.records)||!Array.isArray(report.provenance)||!Array.isArray(report.eligibility))fail('HFM_ADAPTER_INVALID_FACADE_REPORT','Authorized HFM facade report is malformed.');
  const out=[];
  for(const record of report.records){
   if(!record||record.projectId!==projectId||!ID_PATTERN.test(record.memoryId||''))continue;
   const p=report.provenance.filter(x=>x&&x.memoryId===record.memoryId&&x.projectId===projectId);
   const e=report.eligibility.filter(x=>x&&x.memoryId===record.memoryId);
   if(p.length!==1||e.length!==1||e[0].status!=='ELIGIBLE'||e[0].reasonCode!=='AUTHORIZED_READ')continue;
   if(record.integrity?.status!=='VERIFIED'||record.lifecycle!=='ACTIVE')continue;
   const content=contentText(record),title=typeof record.title==='string'?record.title.slice(0,1000):'';
   if(!content&&!title)continue;
   const sourceUrl=safeHttps(record.source?.sourceUrl||record.source?.url||'');
   out.push({memoryId:record.memoryId,projectId,version:Number.isSafeInteger(record.version?.revision)?record.version.revision:null,title,content,snippet:'',sourceUrl,sourceRef:record.source?.sourceId||record.source?.sourceType||null,trustState:'VERIFIED',lifecycle:'ACTIVE',recordDigest:p[0].recordDigest,updatedAt:record.timestamps?.updatedAt||null});
   if(out.length>=limit)break;
  }
  return out;
 }});
}
function createFacebookResearchArchiveSource({lookup,pageId}={}){
 const safePageId=text(pageId,'pageId',64);
 if(typeof lookup!=='function')fail('HFM_ADAPTER_INVALID_INPUT','lookup must be the existing read-only research archive lookup.');
 return Object.freeze({id:'facebook-research-archive',type:'PUBLIC_WEB_ARCHIVE',async retrieve(query,{projectId,limit,readOnly}={}){
  if(readOnly!==true)fail('HFM_ADAPTER_READ_ONLY_REQUIRED','Public archive adapter only supports readOnly=true.');
  const project=text(projectId,'projectId',128);
  const report=await lookup({pageId:safePageId,query,limit:Math.min(limit,10)});
  if(!report||!Array.isArray(report.results)||report.pageId!==safePageId)fail('HFM_ADAPTER_INVALID_ARCHIVE_REPORT','Public archive lookup report is malformed or Page ID mismatched.');
  return report.results.filter(x=>{
   const haystack=[x.title,x.snippet,x.sourceUrl].join('\n');
   return exactToken(haystack,project);
  }).map(x=>{
   const archiveId=typeof x.archiveId==='string'?x.archiveId:typeof x.evidenceId==='string'?x.evidenceId:'';
   if(!ID_PATTERN.test(archiveId))return null;
   const sourceUrl=safeHttps(x.sourceUrl);
   if(!sourceUrl)return null;
   return {memoryId:archiveId,projectId:project,version:null,title:typeof x.title==='string'?x.title.slice(0,1000):'',content:'',snippet:typeof x.snippet==='string'?x.snippet.slice(0,3000):'',sourceUrl,sourceRef:x.evidenceId||archiveId,trustState:'UNVERIFIED',lifecycle:'REVIEW_REQUIRED',recordDigest:typeof x.recordDigest==='string'?x.recordDigest:digest([archiveId,project,sourceUrl,x.title,x.snippet]),updatedAt:x.observedAt||x.archivedAt||null};
  }).filter(Boolean);
 }});
}
function createFacebookGroupImportSource({retrieve,groupId}={}){
 const safeGroupId=text(groupId,'groupId',128);
 if(typeof retrieve!=='function')fail('HFM_ADAPTER_INVALID_INPUT','retrieve must be the existing authorized manual Group import service.');
 return Object.freeze({id:'facebook-group-manual-import',type:'MANUAL_GROUP_IMPORT',async retrieve(query,{projectId,limit,readOnly}={}){
  if(readOnly!==true)fail('HFM_ADAPTER_READ_ONLY_REQUIRED','Group import adapter only supports readOnly=true.');
  const project=text(projectId,'projectId',128);
  const report=await retrieve({projectId:project,groupId:safeGroupId,query,limit:Math.min(limit,100)});
  if(!report||report.projectId!==project||report.groupId!==safeGroupId||!Array.isArray(report.results))fail('HFM_ADAPTER_INVALID_GROUP_REPORT','Group import retrieval report scope or shape is invalid.');
  return report.results.map(x=>{
   if(!x||x.disposition==='DUPLICATE'||x.lifecycle!=='PENDING_REVIEW'||x.integrityStatus!=='UNVERIFIED'||x.trustStatus!=='SOURCE_RECORDED'||x.retrievableAsTrustedMemory!==false)return null;
   if(!ID_PATTERN.test(x.memoryId||''))return null;
   return {memoryId:x.memoryId,projectId:project,version:Number.isSafeInteger(x.revision)?x.revision:null,title:'',content:typeof x.content==='string'?x.content.slice(0,20000):'',snippet:'',sourceUrl:safeHttps(x.source?.sourceUrl||''),sourceRef:x.source?.sourceId||null,trustState:'UNVERIFIED',lifecycle:'REVIEW_REQUIRED',recordDigest:typeof x.recordDigest==='string'?x.recordDigest:digest(x),updatedAt:x.source?.observedAt||null};
  }).filter(Boolean);
 }});
}
function createModelTokenizerCounter({encode,modelId}={}){
 const id=text(modelId,'modelId',128);
 if(typeof encode!=='function')fail('HFM_TOKENIZER_UNAVAILABLE','A synchronous encode(text) function from the deployed model tokenizer is required.');
 const counter=value=>{
  const encoded=encode(String(value));
  const count=Array.isArray(encoded)||ArrayBuffer.isView(encoded)?encoded.length:
   Number.isSafeInteger(encoded)?encoded:null;
  if(!Number.isSafeInteger(count)||count<0)fail('HFM_TOKENIZER_INVALID_RESULT','Tokenizer must return token IDs or a non-negative integer count.');
  return Math.max(1,count);
 };
 Object.defineProperties(counter,{estimatorId:{value:'MODEL_TOKENIZER'},modelId:{value:id}});
 return counter;
}
module.exports={createCanonicalMemorySource,createFacebookResearchArchiveSource,createFacebookGroupImportSource,createModelTokenizerCounter,exactToken,safeHttps};
