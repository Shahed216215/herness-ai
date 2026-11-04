'use strict';

const crypto=require('node:crypto');

const CAPABILITY_STATES=new Set([
 'AVAILABLE','UNAVAILABLE','NOT_CONFIGURED','PERMISSION_DENIED','RATE_LIMITED','UNKNOWN'
]);
const FACEBOOK_HOSTS=new Set(['facebook.com','www.facebook.com','m.facebook.com']);
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function requiredText(value,label,max=512){
 if(typeof value!=='string'||!value.trim()||value.length>max) throw new Error(label+' is required and must be bounded text.');
 return value.trim();
}
function facebookPageId(value,label='pageId'){
 const id=requiredText(value,label,32);
 if(!/^\\d{1,32}$/.test(id)) throw new Error(label+' must be a numeric Facebook Page ID.');
 return id;
}
function isoTime(value,label){
 const parsed=Date.parse(value);
 if(!Number.isFinite(parsed)) throw new Error(label+' must be a valid timestamp.');
 return new Date(parsed).toISOString();
}
function sha256(value){return crypto.createHash('sha256').update(value,'utf8').digest('hex');}
function state(value,label){
 if(!CAPABILITY_STATES.has(value)) throw new Error(label+' has an unsupported capability state.');
 return value;
}

/**
 * Evaluates independently supplied capability evidence only.
 * It never authenticates, calls Meta/Facebook, or treats config presence as permission.
 */
function evaluateFacebookPageCapabilities({
 pageId,apiVersion,apiConfigured=false,apiSupported='UNKNOWN',
 readPermission='UNKNOWN',writePermission='UNKNOWN',
 permissionEvidence={},manualFallbackEnabled=true
}={}){
 if(typeof manualFallbackEnabled!=='boolean') throw new Error('manualFallbackEnabled must be boolean.');
 const safePageId=pageId===undefined||pageId===null?null:facebookPageId(pageId);
 const safeApiVersion=apiVersion===undefined||apiVersion===null?null:requiredText(apiVersion,'apiVersion',32);
 if(typeof apiConfigured!=='boolean') throw new Error('apiConfigured must be boolean.');
 const apiState=state(apiSupported,'apiSupported');
 const readState=state(readPermission,'readPermission');
 const writeState=state(writePermission,'writePermission');
 if(!object(permissionEvidence)) throw new Error('permissionEvidence must be an object.');
 const readEvidence=permissionEvidence.read;
 const writeEvidence=permissionEvidence.write;
 function resolve(operation,declared,evidence){
  if(!apiConfigured||!safePageId||!safeApiVersion) return 'NOT_CONFIGURED';
  if(apiState==='UNAVAILABLE') return 'UNAVAILABLE';
  if(apiState!=='AVAILABLE') return 'UNKNOWN';
  if(declared==='PERMISSION_DENIED') return 'PERMISSION_DENIED';
  if(declared==='RATE_LIMITED') return 'RATE_LIMITED';
  if(declared==='UNAVAILABLE') return 'UNAVAILABLE';
  if(declared!=='AVAILABLE') return 'UNKNOWN';
  if(!object(evidence)||evidence.verified!==true||evidence.pageId!==safePageId||
     evidence.operation!==operation||typeof evidence.evidenceRef!=='string'||
     !evidence.evidenceRef.trim()||typeof evidence.checkedAt!=='string') return 'UNKNOWN';
  const checked=Date.parse(evidence.checkedAt);
  if(!Number.isFinite(checked)||checked>Date.now()||Date.now()-checked>15*60*1000) return 'UNKNOWN';
  return 'AVAILABLE';
 }
 return Object.freeze({
  providerId:'facebook-page',
  pageId:safePageId,
  apiVersion:safeApiVersion,
  apiConfiguration:apiConfigured&&safePageId&&safeApiVersion?'CONFIGURED_ASSERTED':'NOT_CONFIGURED',
  apiSupport:apiState,
  read:Object.freeze({state:resolve('READ',readState,readEvidence),evidenceStatus:'CALLER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED'}),
  write:Object.freeze({state:resolve('WRITE',writeState,writeEvidence),evidenceStatus:'CALLER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED'}),
  manualFallback:Object.freeze({enabled:manualFallbackEnabled,state:manualFallbackEnabled?'AVAILABLE':'UNAVAILABLE'}),
  automaticCallsImplemented:false,
  status:'CAPABILITY_ASSESSMENT_ONLY'
 });
}

/** Create an exact, reviewable post draft; no Facebook publishing occurs. */
function createManualPostDraft({record,pageId,pageName,generatedAt=new Date().toISOString()}={}){
 if(!object(record)) throw new Error('A canonical Memory record is required.');
 const targetPageId=facebookPageId(pageId);
 const memoryId=requiredText(record.memoryId,'record.memoryId',128);
 const projectId=requiredText(record.projectId,'record.projectId',128);
 const content=requiredText(record.content,'record.content',100000);
 if(record.integrity?.status!=='VERIFIED'||record.lifecycle!=='ACTIVE') {
  throw new Error('Only ACTIVE integrity-verified records may produce a manual post draft.');
 }
 if(record.access?.classification!=='PUBLIC') {
  throw new Error('Only explicitly PUBLIC records may produce a Facebook Page post draft.');
 }
 const createdAt=isoTime(generatedAt,'generatedAt');
 const title=pageName===undefined?'Mira Memory':requiredText(pageName,'pageName',128);
 const payload={
  schemaVersion:'1.0.0',
  draftId:'fbpage-draft-'+sha256(targetPageId+'|'+memoryId+'|'+projectId+'|'+sha256(content)).slice(0,24),
  providerId:'facebook-page',pageId:targetPageId,pageName:title,projectId,memoryId,
  content,contentHash:sha256(content),createdAt,
  status:'PENDING_MANUAL_POST',
  warning:'Review visibility and remove restricted information before posting. This draft has not been published or verified.'
 };
 return Object.freeze(payload);
}

/** Validate only public Page post URL shapes. This function performs no fetch. */
function parsePublicPagePostUrl(value,{expectedPageId}={}){
 requiredText(value,'postUrl',2048);
 const pageId=facebookPageId(expectedPageId,'expectedPageId');
 let url;
 try{url=new URL(value);}catch{throw new Error('Facebook post URL is invalid.');}
 if(url.protocol!=='https:'||!FACEBOOK_HOSTS.has(url.hostname.toLowerCase())||
    url.username||url.password||url.hash||(url.port&&url.port!=='443')) throw new Error('Only standard-port HTTPS public Facebook URLs are accepted.');
 let resolvedPageId=null,postId=null;
 const parts=url.pathname.split('/').filter(Boolean);
 if(parts.length===3&&parts[1]==='posts'){
  resolvedPageId=parts[0];postId=parts[2];
 }else if(url.pathname==='/permalink.php'){
  resolvedPageId=url.searchParams.get('id');postId=url.searchParams.get('story_fbid');
 }else{
  throw new Error('URL is not a supported Facebook Page post permalink.');
 }
 if(resolvedPageId!==pageId||!postId||!/^[A-Za-z0-9._-]{1,160}$/.test(postId)){
  throw new Error('Facebook Page ID or post identity does not match the expected Page.');
 }
 return Object.freeze({pageId,postId,canonicalUrl:url.toString(),sourceType:'facebook_page',status:'SOURCE_URL_VALIDATED_NOT_FETCHED'});
}

/** Manual import is untrusted evidence until independent readback and integrity verification. */
function prepareManualPostImport({postUrl,expectedPageId,content,observedAt=new Date().toISOString()}={}){
 const locator=parsePublicPagePostUrl(postUrl,{expectedPageId});
 const safeContent=requiredText(content,'content',100000);
 const capturedAt=isoTime(observedAt,'observedAt');
 return Object.freeze({
  schemaVersion:'1.0.0',providerId:'facebook-page',
  source:{sourceType:'facebook_page',sourceId:locator.postId,sourceUrl:locator.canonicalUrl,
   pageId:locator.pageId,observedAt:capturedAt},
  content:safeContent,contentHash:sha256(safeContent),
  integrity:{status:'UNVERIFIED',algorithm:'SHA-256'},
  trust:{status:'SOURCE_RECORDED'},
  verificationStatus:'MANUAL_IMPORT_PENDING_INDEPENDENT_READBACK',
  lifecycle:'PENDING_REVIEW',
  warning:'URL shape was validated locally only. Post existence, visibility, ownership and content were not fetched or independently verified.'
 });
}

/** Manual visual comparison cannot assert VERIFIED; only a trusted independent verifier may do that. */
function compareManualReadback({preparedImport,readbackContent,readbackPageId}={}){
 if(!object(preparedImport)||preparedImport.providerId!=='facebook-page') throw new Error('A prepared Facebook Page import is required.');
 const pageId=requiredText(readbackPageId,'readbackPageId',128);
 const content=requiredText(readbackContent,'readbackContent',100000);
 const matches=pageId===preparedImport.source.pageId&&sha256(content)===preparedImport.contentHash;
 return Object.freeze({
  matches,
  status:matches?'MANUAL_READBACK_MATCHED_PENDING_INDEPENDENT_VERIFICATION':'CONFLICT_REQUIRES_QUARANTINE',
  integrityStatus:'UNVERIFIED',
  trustStatus:'SOURCE_RECORDED',
  mayEnterTrustedMemory:false
 });
}

function getAutomaticOperationDisposition({capabilities,operation}={}){
 if(!object(capabilities)||capabilities.providerId!=='facebook-page') throw new Error('Facebook Page capability report is required.');
 if(!['READ','WRITE'].includes(operation)) throw new Error('Only READ or WRITE is supported.');
 const capability=capabilities[operation.toLowerCase()];
 if(!object(capability)||!CAPABILITY_STATES.has(capability.state)) throw new Error('Capability state is invalid.');
 return Object.freeze({
  operation,state:capability.state,
  status:'NOT_IMPLEMENTED_NO_LIVE_API_CALL',
  allowed:false,
  reason:'Phase 4 currently provides offline capability assessment and manual fallback only. Automatic Meta API transport requires a separately approved authenticated integration.'
 });
}
module.exports={
 evaluateFacebookPageCapabilities,createManualPostDraft,parsePublicPagePostUrl,
 prepareManualPostImport,compareManualReadback,getAutomaticOperationDisposition
};
