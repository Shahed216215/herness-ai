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
 if(typeof value!=='string') throw new Error(label+' must be RFC 3339.');
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!match) throw new Error(label+' must be RFC 3339.');
 const [,yearText,monthText,dayText,hourText,minuteText,secondText,zone]=match;
 const year=Number(yearText),month=Number(monthText),day=Number(dayText);
 const hour=Number(hourText),minute=Number(minuteText),second=Number(secondText);
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59){
  throw new Error(label+' has an invalid calendar date or clock time.');
 }
 if(zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4,6))>59)){
  throw new Error(label+' has an invalid UTC offset.');
 }
 const parsed=Date.parse(value);
 if(!Number.isFinite(parsed)) throw new Error(label+' is not parseable.');
 return parsed;
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
 const actorId='mira:'+encodeURIComponent(issuer)+':'+encodeURIComponent(subject);
 if(actorId.length>512) throw new Error('Canonical actorId exceeds the supported bound.');
 return deepFreeze({
  actorId,actorType:verifiedPrincipal.actorType,
  authenticationMethod:verifiedPrincipal.authenticationMethod,
  authenticationRef,authenticatedAt:new Date(authenticatedAt).toISOString(),
  expiresAt:new Date(expiresAt).toISOString()
 });
}
module.exports={normalizeTrustedActorIdentity,ACTOR_TYPES,AUTH_METHODS};
