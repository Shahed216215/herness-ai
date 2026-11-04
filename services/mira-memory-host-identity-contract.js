'use strict';

// Normalizes a principal produced by trusted authentication middleware.
// This module does not authenticate sessions, validate tokens or read request input.
const ACTOR_TYPES=new Set(['HUMAN','SERVICE','AGENT','SYSTEM']);
const AUTH_METHODS=new Set(['USER_SESSION','ADMIN_SUBJECT','MAPPED_BEARER','SERVICE_CREDENTIAL','AGENT_CREDENTIAL']);
const KEYS=['verified','issuer','subject','actorType','authenticationMethod','authenticationRef','authenticatedAt','expiresAt'];
function text(value,label,max=256){
 if(typeof value!=='string'||!value.trim()||value.length>max) throw new Error(label+' is required bounded text.');
 return value.trim();
}
function timestamp(value,label){
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||!/(Z|[+-]\d{2}:\d{2})$/.test(value)){
  throw new Error(label+' must be an offset-aware timestamp.');
 }
 return Date.parse(value);
}
function deepFreeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
 }
 return value;
}
function normalizeTrustedActorIdentity({verifiedPrincipal,now=new Date()}={}){
 if(!verifiedPrincipal||typeof verifiedPrincipal!=='object'||Array.isArray(verifiedPrincipal)){
  throw new Error('Trusted verified principal is required.');
 }
 if(Object.keys(verifiedPrincipal).length!==KEYS.length||KEYS.some(key=>!Object.prototype.hasOwnProperty.call(verifiedPrincipal,key))){
  throw new Error('Trusted principal must contain the exact supported fields; credentials and caller fields are forbidden.');
 }
 if(verifiedPrincipal.verified!==true) throw new Error('Authentication middleware has not verified this principal.');
 const issuer=text(verifiedPrincipal.issuer,'issuer');
 const subject=text(verifiedPrincipal.subject,'subject');
 if(!ACTOR_TYPES.has(verifiedPrincipal.actorType)) throw new Error('Unsupported actorType.');
 if(!AUTH_METHODS.has(verifiedPrincipal.authenticationMethod)) throw new Error('Unsupported authenticationMethod.');
 const authenticationRef=text(verifiedPrincipal.authenticationRef,'authenticationRef',512);
 const authenticatedAt=timestamp(verifiedPrincipal.authenticatedAt,'authenticatedAt');
 const expiresAt=timestamp(verifiedPrincipal.expiresAt,'expiresAt');
 const nowMs=now instanceof Date?now.getTime():Date.parse(now);
 if(!Number.isFinite(nowMs)||authenticatedAt>nowMs||expiresAt<=nowMs||expiresAt<=authenticatedAt){
  throw new Error('Authentication principal is future-dated, expired or temporally inconsistent.');
 }
 const actorId=issuer+'/'+subject;
 if(actorId.length>512) throw new Error('Canonical actorId exceeds the supported bound.');
 return deepFreeze({
  actorId,actorType:verifiedPrincipal.actorType,
  authenticationMethod:verifiedPrincipal.authenticationMethod,
  authenticationRef,authenticatedAt:new Date(authenticatedAt).toISOString(),
  expiresAt:new Date(expiresAt).toISOString()
 });
}
module.exports={normalizeTrustedActorIdentity,ACTOR_TYPES,AUTH_METHODS};
