'use strict';

// Read-only validator for trusted host project-membership/ownership evidence.
// It does not authenticate actors, create memberships, or access a registry.
const crypto=require('node:crypto');
const ACTOR_TYPES=new Set(['HUMAN','SERVICE','AGENT','SYSTEM']);
const OPERATIONS=new Set(['READ','WRITE','LIST','VERIFY','PLAN_MIGRATION']);
const MEMBERSHIP_ROLES=new Set(['OWNER','EDITOR','VIEWER','SERVICE','ADMIN']);
const KEYS=[
 'schemaVersion','decision','actorId','actorType','projectId','operation','resourceScope',
 'authorityRef','membershipRef','membershipRole','allowedOperations','registryRevision',
 'status','revocationStatus','approvedBy','approvedAt','verifiedAt','expiresAt','evidenceDigest'
];
function isObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function exactKeys(value){
 return isObject(value)&&Object.keys(value).length===KEYS.length&&KEYS.every(key=>Object.prototype.hasOwnProperty.call(value,key));
}
function text(value,label,max=256){
 if(typeof value!=='string'||!value.trim()||value.length>max) throw new Error(label+' is required and must be bounded text.');
}
function timestamp(value,label){
 if(typeof value!=='string') throw new Error(label+' must be RFC 3339.');
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!m) throw new Error(label+' must be RFC 3339.');
 const [,y,mo,d,h,mi,s,zone]=m;
 const year=+y,month=+mo,day=+d,hour=+h,minute=+mi,second=+s;
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>60) throw new Error(label+' has an invalid calendar date.');
 if(zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4,6))>59)) throw new Error(label+' has an invalid UTC offset.');
 if(!Number.isFinite(Date.parse(value))) throw new Error(label+' is not parseable.');
}
function bodyOf(evidence){
 const body={};
 for(const key of KEYS) if(key!=='evidenceDigest') body[key]=evidence[key];
 return body;
}
function digest(evidence){
 return crypto.createHash('sha256').update(JSON.stringify(bodyOf(evidence)),'utf8').digest('hex');
}
function deepFreeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
 }
 return value;
}
function validateProjectAuthorityEvidence({
 evidence,expectedActorId,expectedActorType,expectedProjectId,expectedOperation,
 expectedResourceScope,verifyEvidence,now=new Date()
}){
 if(!exactKeys(evidence)) throw new Error('Project authority evidence must contain the exact supported fields.');
 if(evidence.schemaVersion!=='1.0.0') throw new Error('Unsupported project authority schemaVersion.');
 text(evidence.actorId,'actorId',256);
 if(!ACTOR_TYPES.has(evidence.actorType)) throw new Error('Unsupported actorType.');
 text(evidence.projectId,'projectId',128);
 if(!OPERATIONS.has(evidence.operation)) throw new Error('Unsupported project authority operation.');
 text(evidence.resourceScope,'resourceScope',512);
 text(evidence.authorityRef,'authorityRef');
 text(evidence.membershipRef,'membershipRef');
 if(!MEMBERSHIP_ROLES.has(evidence.membershipRole)) throw new Error('Unsupported membershipRole.');
 if(!Array.isArray(evidence.allowedOperations)||!evidence.allowedOperations.length||
    evidence.allowedOperations.some(op=>!OPERATIONS.has(op))||
    new Set(evidence.allowedOperations).size!==evidence.allowedOperations.length){
  throw new Error('allowedOperations must be a unique non-empty list of supported operations.');
 }
 text(evidence.registryRevision,'registryRevision');
 text(evidence.approvedBy,'approvedBy');
 if(evidence.decision!=='ALLOW'||evidence.status!=='ACTIVE'||evidence.revocationStatus!=='ACTIVE'){
  throw new Error('Project authority is denied, inactive or revoked.');
 }
 if(!evidence.allowedOperations.includes(evidence.operation)) throw new Error('Operation is not included in approved membership permissions.');
 timestamp(evidence.approvedAt,'approvedAt');
 timestamp(evidence.verifiedAt,'verifiedAt');
 timestamp(evidence.expiresAt,'expiresAt');
 const nowMs=now instanceof Date?now.getTime():Date.parse(now);
 if(!Number.isFinite(nowMs)) throw new Error('Current time is invalid.');
 if(Date.parse(evidence.approvedAt)>Date.parse(evidence.verifiedAt)||
    Date.parse(evidence.verifiedAt)>nowMs||
    Date.parse(evidence.expiresAt)<=nowMs||
    Date.parse(evidence.expiresAt)<=Date.parse(evidence.verifiedAt)){
  throw new Error('Project authority evidence is expired, future-dated or temporally inconsistent.');
 }
 for(const [key,expected] of [
  ['actorId',expectedActorId],['actorType',expectedActorType],['projectId',expectedProjectId],
  ['operation',expectedOperation],['resourceScope',expectedResourceScope]
 ]){
  if(expected!==undefined&&evidence[key]!==expected) throw new Error('Project authority binding mismatch: '+key+'.');
 }
 if(!/^[a-f0-9]{64}$/.test(evidence.evidenceDigest||'')||evidence.evidenceDigest!==digest(evidence)){
  throw new Error('Project authority evidence digest mismatch.');
 }
 if(typeof verifyEvidence!=='function') throw new Error('Trusted project authority evidence verifier is required.');
 if(verifyEvidence(Object.freeze({
  authorityRef:evidence.authorityRef,membershipRef:evidence.membershipRef,
  actorId:evidence.actorId,actorType:evidence.actorType,projectId:evidence.projectId,
  operation:evidence.operation,resourceScope:evidence.resourceScope,
  registryRevision:evidence.registryRevision,evidenceDigest:evidence.evidenceDigest,
  approvedBy:evidence.approvedBy,approvedAt:evidence.approvedAt,
  verifiedAt:evidence.verifiedAt,expiresAt:evidence.expiresAt
 }))!==true) throw new Error('Project authority evidence signature/registry verification failed.');
 return deepFreeze({...evidence,allowedOperations:[...evidence.allowedOperations]});
}
module.exports={validateProjectAuthorityEvidence,digest,bodyOf,OPERATIONS,MEMBERSHIP_ROLES};
