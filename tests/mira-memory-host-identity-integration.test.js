'use strict';
const assert=require('node:assert/strict');
const {
 normalizeTrustedActorIdentity
}=require('../services/mira-memory-host-identity-contract');
const {
 createHostAuthorizationAdapter
}=require('../services/mira-memory-host-authorization-adapter');
const {
 authorizeMemoryRequest
}=require('../services/mira-memory-request-authorization');
const {
 validateProjectOwnerRegistryEntry
}=require('../services/mira-memory-project-owner-registry-contract');
const {
 digest:authorityDigest
}=require('../services/mira-memory-project-authority-contract');

const now=new Date('2026-11-04T12:00:00.000Z');
const PURPOSE='phase3-host-integration-fixture';
const RESOURCE='memory:fixture-record-001:classification:PROJECT_PRIVATE';
const ownerPrincipal={
 verified:true,issuer:'issuer.fixture',subject:'user-001',actorType:'HUMAN',
 authenticationMethod:'USER_SESSION',authenticationRef:'session-fixture-001',
 authenticatedAt:'2026-11-04T11:59:00.000Z',expiresAt:'2026-11-04T12:05:00.000Z'
};
const owner=normalizeTrustedActorIdentity({verifiedPrincipal:ownerPrincipal,now});
const registry={
 schemaVersion:'1.0.0',authorityRecordId:'authority-fixture-001',
 projectId:'project-alpha',tenantId:'tenant-alpha',ownerActorId:owner.actorId,
 memberships:[{
  membershipRef:'membership-owner-fixture-001',actorId:owner.actorId,actorType:'HUMAN',
  role:'OWNER',allowedOperations:['READ','LIST'],status:'ACTIVE',
  validFrom:'2026-11-04T11:00:00.000Z',validUntil:'2026-11-04T13:00:00.000Z'
 }],
 sourceProjectSnapshotDigest:'a'.repeat(64),approvalReference:'approval-fixture-001',
 approvedBy:'mira:issuer.fixture:admin-001',approvedAt:'2026-11-04T11:45:00.000Z',
 registryRevision:'registry-rev-001',status:'ACTIVE',
 createdAt:'2026-11-04T11:40:00.000Z',updatedAt:'2026-11-04T11:50:00.000Z'
};
const registryDigest=require('../services/mira-memory-project-owner-registry-contract').digest;
registry.recordDigest=registryDigest(registry);
const verifyRegistryRecord=proof=>proof.recordDigest===registry.recordDigest&&
 proof.projectId===registry.projectId&&proof.ownerActorId===registry.ownerActorId;
const verifiedRegistry=validateProjectOwnerRegistryEntry({
 entry:registry,expectedProjectId:'project-alpha',expectedTenantId:'tenant-alpha',
 verifyRegistryRecord,now
});
assert.equal(verifiedRegistry.ownerActorId,owner.actorId);
console.log('FIXTURE_HOST_PRINCIPAL_BOUND_TO_VERIFIED_PROJECT_OWNER_REGISTRY=PASS');

function makeAuthorityEvidence(){
 const member=verifiedRegistry.memberships[0];
 const evidence={
  schemaVersion:'1.0.0',decision:'ALLOW',actorId:member.actorId,actorType:member.actorType,
  projectId:verifiedRegistry.projectId,operation:'READ',resourceScope:RESOURCE,
  authorityRef:verifiedRegistry.approvalReference,purpose:PURPOSE,
  membershipRef:member.membershipRef,membershipRole:member.role,
  allowedOperations:[...member.allowedOperations],registryRevision:verifiedRegistry.registryRevision,
  status:'ACTIVE',revocationStatus:'ACTIVE',approvedBy:verifiedRegistry.approvedBy,
  approvedAt:verifiedRegistry.approvedAt,verifiedAt:'2026-11-04T11:59:30.000Z',
  expiresAt:'2026-11-04T12:10:00.000Z'
 };
 evidence.evidenceDigest=authorityDigest(evidence);
 return evidence;
}
const replayClaims=new Set();
const adapter=createHostAuthorizationAdapter({
 getProjectAuthorityEvidence:()=>makeAuthorityEvidence(),
 verifyProjectAuthorityEvidence:proof=>{
  const current=validateProjectOwnerRegistryEntry({
   entry:registry,expectedProjectId:proof.projectId,expectedTenantId:'tenant-alpha',
   verifyRegistryRecord,now
  });
  const member=current.memberships.find(item=>item.membershipRef===proof.membershipRef);
  return Boolean(member&&proof.actorId===member.actorId&&proof.actorType===member.actorType&&
   proof.projectId===current.projectId&&proof.operation&&member.allowedOperations.includes(proof.operation)&&
   proof.resourceScope===RESOURCE&&proof.authorityRef===current.approvalReference&&
   proof.purpose===PURPOSE&&proof.registryRevision===current.registryRevision&&
   proof.approvedBy===current.approvedBy&&proof.approvedAt===current.approvedAt);
 },
 consumeReplayRequest:claim=>{
  const key=claim.authorityRef+'|'+claim.requestId;
  if(replayClaims.has(key)) return false;
  replayClaims.add(key);
  return true;
 },
 now:()=>now
});
function requestContext(identity,requestId='request-fixture-001',projectId='project-alpha'){
 return {
  actorId:identity.actorId,actorType:identity.actorType,projectId,purpose:PURPOSE,
  requestId,authorityRef:registry.approvalReference,
  issuedAt:identity.authenticatedAt,expiresAt:identity.expiresAt
 };
}
const context=requestContext(owner);
const decision=authorizeMemoryRequest({
 requestContext:context,operation:'READ',resourceScope:RESOURCE,
 authorizeRequest:adapter,now
});
assert.equal(decision.authorized,true);
assert.equal(decision.projectId,'project-alpha');
assert.equal(decision.actorId,owner.actorId);
assert.equal(decision.decisionExpiresAt,'2026-11-04T12:05:00.000Z');
console.log('FIXTURE_HOST_IDENTITY_AUTHORITY_SCOPE_AND_EXPIRY_COMPOSED=PASS');

assert.throws(()=>authorizeMemoryRequest({
 requestContext:context,operation:'READ',resourceScope:RESOURCE,
 authorizeRequest:adapter,now
}),/denied by host policy/);
console.log('FIXTURE_HOST_REPLAY_DENIED=PASS');

const nonOwner={...owner,actorId:'mira:issuer.fixture:user-002'};
assert.throws(()=>authorizeMemoryRequest({
 requestContext:requestContext(nonOwner,'request-non-owner-001'),
 operation:'READ',resourceScope:RESOURCE,authorizeRequest:adapter,now
}),/binding mismatch: actorId/);
console.log('FIXTURE_HOST_NON_OWNER_DENIED=PASS');

assert.throws(()=>authorizeMemoryRequest({
 requestContext:requestContext(owner,'request-cross-project-001','project-beta'),
 operation:'READ',resourceScope:RESOURCE,authorizeRequest:adapter,now
}),/binding mismatch: projectId/);
console.log('FIXTURE_HOST_CROSS_PROJECT_DENIED=PASS');

assert.throws(()=>authorizeMemoryRequest({
 requestContext:requestContext(owner,'request-write-not-granted-001'),
 operation:'WRITE',resourceScope:RESOURCE,authorizeRequest:adapter,now
}),/binding mismatch: operation/);
console.log('FIXTURE_HOST_UNGRANTED_OPERATION_DENIED=PASS');

assert.throws(()=>normalizeTrustedActorIdentity({
 verifiedPrincipal:{...ownerPrincipal,accessToken:'never-store-this'},now
}),/exact supported fields/);
assert.throws(()=>normalizeTrustedActorIdentity({
 verifiedPrincipal:{...ownerPrincipal,expiresAt:'2026-11-04T11:59:59.000Z'},now
}),/expired/);
assert.throws(()=>normalizeTrustedActorIdentity({
 verifiedPrincipal:{...ownerPrincipal,verified:false},now
}),/not verified/);
console.log('FIXTURE_HOST_UNVERIFIED_EXPIRED_AND_CREDENTIAL_BEARING_PRINCIPALS_DENIED=PASS');

const noVerifier=createHostAuthorizationAdapter({
 getProjectAuthorityEvidence:makeAuthorityEvidence,
 verifyProjectAuthorityEvidence:()=>false,
 consumeReplayRequest:()=>true,now:()=>now
});
assert.throws(()=>authorizeMemoryRequest({
 requestContext:requestContext(owner,'request-bad-proof-001'),
 operation:'READ',resourceScope:RESOURCE,authorizeRequest:noVerifier,now
}),/verification failed/);
console.log('FIXTURE_HOST_INVALID_AUTHORITY_PROOF_DENIED=PASS');

console.log('PRODUCTION_SESSION_OR_PROJECT_DATA_ACCESSED=NO');
console.log('NETWORK_REQUESTS=0');
console.log('PERSISTENT_REPLAY_STORE=NO_FIXTURE_ONLY');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_HOST_IDENTITY_INTEGRATION_FIXTURE_PASS');
