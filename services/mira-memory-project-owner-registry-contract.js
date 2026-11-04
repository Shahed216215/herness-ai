'use strict';

// Read-only validator for a future authoritative project-owner sidecar registry.
// It does not create assignments, authenticate principals or persist registry state.
const crypto=require('node:crypto');
const ACTOR_TYPES=new Set(['HUMAN','SERVICE','AGENT','SYSTEM']);
const ROLES=new Set(['OWNER','EDITOR','VIEWER','SERVICE','ADMIN']);
const OPERATIONS=new Set(['READ','WRITE','LIST','VERIFY','PLAN_MIGRATION','APPROVE_MAPPING']);
const ENTRY_STATUSES=new Set(['ACTIVE','SUSPENDED','REVOKED']);
const ENTRY_KEYS=[
 'schemaVersion','authorityRecordId','projectId','tenantId','ownerActorId','memberships',
 'sourceProjectSnapshotDigest','approvalReference','approvedBy','approvedAt',
 'registryRevision','status','createdAt','updatedAt','recordDigest'
];
const MEMBERSHIP_KEYS=[
 'membershipRef','actorId','actorType','role','allowedOperations','status','validFrom','validUntil'
];
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function text(value,label,max=256){
 if(typeof value!=='string'||!value.trim()||value.length>max) throw new Error(label+' is required bounded text.');
 return value.trim();
}
function timestamp(value,label){
 if(typeof value!=='string') throw new Error(label+' must be RFC 3339.');
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!m) throw new Error(label+' must be RFC 3339.');
 const [,y,mo,d,h,mi,s,zone]=m;
 const year=+y,month=+mo,day=+d,hour=+h,minute=+mi,second=+s;
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59) throw new Error(label+' has invalid calendar/clock values.');
 if(zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4,6))>59)) throw new Error(label+' has invalid UTC offset.');
 const result=Date.parse(value);
 if(!Number.isFinite(result)) throw new Error(label+' is not parseable.');
 return result;
}
function bodyOf(entry){
 const body={};
 for(const key of ENTRY_KEYS) if(key!=='recordDigest') body[key]=entry[key];
 return body;
}
function digest(entry){
 return crypto.createHash('sha256').update(JSON.stringify(bodyOf(entry)),'utf8').digest('hex');
}
function deepFreeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
 }
 return value;
}
function validateProjectOwnerRegistryEntry({
 entry,expectedProjectId,expectedTenantId,verifyRegistryRecord,now=new Date()
}){
 if(!object(entry)||Object.keys(entry).length!==ENTRY_KEYS.length||ENTRY_KEYS.some(key=>!Object.prototype.hasOwnProperty.call(entry,key))){
  throw new Error('Project owner registry entry must contain the exact supported fields.');
 }
 if(entry.schemaVersion!=='1.0.0') throw new Error('Unsupported project owner registry schemaVersion.');
 text(entry.authorityRecordId,'authorityRecordId');
 text(entry.projectId,'projectId',128);
 text(entry.tenantId,'tenantId',128);
 text(entry.ownerActorId,'ownerActorId',512);
 text(entry.approvalReference,'approvalReference');
 text(entry.approvedBy,'approvedBy');
 text(entry.registryRevision,'registryRevision');
 if(!/^[a-f0-9]{64}$/.test(entry.sourceProjectSnapshotDigest||'')) throw new Error('sourceProjectSnapshotDigest must be SHA-256.');
 if(!ENTRY_STATUSES.has(entry.status)) throw new Error('Unsupported project owner registry status.');
 const approvedAt=timestamp(entry.approvedAt,'approvedAt');
 const createdAt=timestamp(entry.createdAt,'createdAt');
 const updatedAt=timestamp(entry.updatedAt,'updatedAt');
 const nowMs=now instanceof Date?now.getTime():Date.parse(now);
 if(!Number.isFinite(nowMs)||createdAt>nowMs||approvedAt>nowMs||approvedAt<createdAt||updatedAt<createdAt){
  throw new Error('Registry entry timestamps are future-dated or inconsistent.');
 }
 if(expectedProjectId!==undefined&&entry.projectId!==expectedProjectId) throw new Error('Project owner registry project binding mismatch.');
 if(expectedTenantId!==undefined&&entry.tenantId!==expectedTenantId) throw new Error('Project owner registry tenant binding mismatch.');
 if(!Array.isArray(entry.memberships)||entry.memberships.length<1||entry.memberships.length>1000){
  throw new Error('Project owner registry memberships must be a bounded non-empty array.');
 }
 const actors=new Set(),refs=new Set();
 let ownerMembership=null;
 for(const membership of entry.memberships){
  if(!object(membership)||Object.keys(membership).length!==MEMBERSHIP_KEYS.length||MEMBERSHIP_KEYS.some(key=>!Object.prototype.hasOwnProperty.call(membership,key))){
   throw new Error('Project membership must contain the exact supported fields.');
  }
  text(membership.membershipRef,'membershipRef');
  text(membership.actorId,'membership.actorId',512);
  if(!ACTOR_TYPES.has(membership.actorType)) throw new Error('Unsupported membership actorType.');
  if(!ROLES.has(membership.role)) throw new Error('Unsupported membership role.');
  if(!['ACTIVE','SUSPENDED','REVOKED'].includes(membership.status)) throw new Error('Unsupported membership status.');
  if(!Array.isArray(membership.allowedOperations)||membership.allowedOperations.length<1||
     membership.allowedOperations.some(op=>!OPERATIONS.has(op))||
     new Set(membership.allowedOperations).size!==membership.allowedOperations.length){
   throw new Error('Membership allowedOperations must be a unique supported non-empty list.');
  }
  const validFrom=timestamp(membership.validFrom,'membership.validFrom');
  const validUntil=timestamp(membership.validUntil,'membership.validUntil');
  if(validUntil<=validFrom) throw new Error('Membership validity window is invalid.');
  if(actors.has(membership.actorId)||refs.has(membership.membershipRef)) throw new Error('Duplicate project membership actor or reference.');
  actors.add(membership.actorId);refs.add(membership.membershipRef);
  if(membership.role==='OWNER'){
   if(ownerMembership) throw new Error('Project registry must have exactly one owner membership.');
   ownerMembership=membership;
  }
  if(entry.status==='ACTIVE'&&membership.status==='ACTIVE'&&(validFrom>nowMs||validUntil<=nowMs)){
   throw new Error('Active project membership is not currently valid.');
  }
 }
 if(!ownerMembership||ownerMembership.actorId!==entry.ownerActorId||ownerMembership.status!=='ACTIVE'){
  throw new Error('Registry ownerActorId must bind one active OWNER membership.');
 }
 if(entry.status==='ACTIVE'&&(!entry.memberships.some(m=>m.status==='ACTIVE'&&m.actorId===entry.ownerActorId))){
  throw new Error('Active registry entry requires active owner membership.');
 }
 if(!/^[a-f0-9]{64}$/.test(entry.recordDigest||'')||entry.recordDigest!==digest(entry)){
  throw new Error('Project owner registry record digest mismatch.');
 }
 if(typeof verifyRegistryRecord!=='function') throw new Error('Trusted project owner registry verifier is required.');
 if(verifyRegistryRecord(Object.freeze({
  authorityRecordId:entry.authorityRecordId,projectId:entry.projectId,tenantId:entry.tenantId,
  ownerActorId:entry.ownerActorId,sourceProjectSnapshotDigest:entry.sourceProjectSnapshotDigest,
  approvalReference:entry.approvalReference,approvedBy:entry.approvedBy,approvedAt:entry.approvedAt,
  registryRevision:entry.registryRevision,status:entry.status,recordDigest:entry.recordDigest
 }))!==true) throw new Error('Project owner registry signature/authority verification failed.');
 return deepFreeze({...entry,memberships:entry.memberships.map(m=>({...m,allowedOperations:[...m.allowedOperations]}))});
}
module.exports={validateProjectOwnerRegistryEntry,digest,bodyOf,ENTRY_KEYS,MEMBERSHIP_KEYS,OPERATIONS,ROLES};
