'use strict';
const assert=require('node:assert/strict');
const {
 validateProjectOwnerRegistryEntry,digest
}=require('../services/mira-memory-project-owner-registry-contract');

const now=new Date('2026-11-04T12:00:00.000Z');
function makeEntry(overrides={}){
 const entry={
  schemaVersion:'1.0.0',
  authorityRecordId:'authority-project-alpha-001',
  projectId:'project-alpha',
  tenantId:'tenant-alpha',
  ownerActorId:'mira:issuer.test:user-001',
  memberships:[{
   membershipRef:'membership-owner-001',
   actorId:'mira:issuer.test:user-001',
   actorType:'HUMAN',
   role:'OWNER',
   allowedOperations:['READ','LIST','WRITE','VERIFY'],
   status:'ACTIVE',
   validFrom:'2026-11-04T10:00:00.000Z',
   validUntil:'2026-11-04T13:00:00.000Z'
  },{
   membershipRef:'membership-viewer-001',
   actorId:'mira:issuer.test:user-002',
   actorType:'HUMAN',
   role:'VIEWER',
   allowedOperations:['READ','LIST'],
   status:'ACTIVE',
   validFrom:'2026-11-04T10:00:00.000Z',
   validUntil:'2026-11-04T13:00:00.000Z'
  }],
  sourceProjectSnapshotDigest:'a'.repeat(64),
  approvalReference:'approval-project-alpha-001',
  approvedBy:'mira:issuer.test:admin-001',
  approvedAt:'2026-11-04T11:45:00.000Z',
  registryRevision:'registry-revision-001',
  status:'ACTIVE',
  createdAt:'2026-11-04T11:40:00.000Z',
  updatedAt:'2026-11-04T11:50:00.000Z'
 };
 Object.assign(entry,overrides);
 entry.recordDigest=digest(entry);
 return entry;
}
const entry=makeEntry();
const verify=proof=>proof.recordDigest===entry.recordDigest&&proof.projectId===entry.projectId&&proof.ownerActorId===entry.ownerActorId;
const valid=validateProjectOwnerRegistryEntry({
 entry,expectedProjectId:'project-alpha',expectedTenantId:'tenant-alpha',
 verifyRegistryRecord:verify,now
});
assert.equal(valid.ownerActorId,'mira:issuer.test:user-001');
assert.equal(Object.isFrozen(valid),true);
assert.equal(Object.isFrozen(valid.memberships),true);
assert.equal(Object.isFrozen(valid.memberships[0].allowedOperations),true);
console.log('PROJECT_OWNER_REGISTRY_VALID_AND_DEEPLY_IMMUTABLE=PASS');

assert.throws(()=>validateProjectOwnerRegistryEntry({
 entry,expectedProjectId:'project-beta',verifyRegistryRecord:verify,now
}),/project binding mismatch/);
assert.throws(()=>validateProjectOwnerRegistryEntry({
 entry,expectedTenantId:'tenant-beta',verifyRegistryRecord:verify,now
}),/tenant binding mismatch/);
assert.throws(()=>validateProjectOwnerRegistryEntry({
 entry,verifyRegistryRecord:undefined,now
}),/verifier is required/);
assert.throws(()=>validateProjectOwnerRegistryEntry({
 entry,verifyRegistryRecord:()=>false,now
}),/signature\/authority verification failed/);
console.log('PROJECT_OWNER_REGISTRY_SCOPE_AND_TRUST_VERIFIER_REQUIRED=PASS');

for(const patch of [
 {status:'UNKNOWN'},
 {ownerActorId:'mira:issuer.test:user-999'},
 {memberships:[]},
 {approvedAt:'2026-11-04T12:01:00.000Z'},
 {createdAt:'2026-11-04T12:01:00.000Z'},
 {updatedAt:'2026-11-04T11:30:00.000Z'},
 {sourceProjectSnapshotDigest:'bad'},
 {tenantId:''}
]){
 const candidate=makeEntry(patch);
 assert.throws(()=>validateProjectOwnerRegistryEntry({entry:candidate,verifyRegistryRecord:()=>true,now}));
}
console.log('PROJECT_OWNER_REGISTRY_INVALID_STATUS_OWNER_AND_TIMESTAMPS_REJECTED=PASS');

const noOwner=makeEntry({ownerActorId:'mira:issuer.test:user-002'});
assert.throws(()=>validateProjectOwnerRegistryEntry({entry:noOwner,verifyRegistryRecord:()=>true,now}),/active OWNER membership/);
const twoOwners=makeEntry({memberships:[
 ...entry.memberships,
 {...entry.memberships[1],membershipRef:'membership-owner-duplicate',role:'OWNER'}
]});
assert.throws(()=>validateProjectOwnerRegistryEntry({entry:twoOwners,verifyRegistryRecord:()=>true,now}),/Duplicate project membership|exactly one owner/);
const duplicateActor=makeEntry({memberships:[
 entry.memberships[0],
 {...entry.memberships[1],membershipRef:'membership-viewer-duplicate',actorId:entry.ownerActorId}
]});
assert.throws(()=>validateProjectOwnerRegistryEntry({entry:duplicateActor,verifyRegistryRecord:()=>true,now}),/Duplicate project membership/);
const duplicateRef=makeEntry({memberships:[
 entry.memberships[0],
 {...entry.memberships[1],membershipRef:entry.memberships[0].membershipRef}
]});
assert.throws(()=>validateProjectOwnerRegistryEntry({entry:duplicateRef,verifyRegistryRecord:()=>true,now}),/Duplicate project membership/);
console.log('PROJECT_OWNER_REGISTRY_OWNER_AND_MEMBERSHIP_UNIQUENESS_ENFORCED=PASS');

const revoked=makeEntry({status:'REVOKED'});
assert.equal(validateProjectOwnerRegistryEntry({entry:revoked,verifyRegistryRecord:()=>true,now}).status,'REVOKED');
const suspended=makeEntry({status:'SUSPENDED'});
assert.equal(validateProjectOwnerRegistryEntry({entry:suspended,verifyRegistryRecord:()=>true,now}).status,'SUSPENDED');
const tampered=makeEntry();
tampered.recordDigest='0'.repeat(64);
assert.throws(()=>validateProjectOwnerRegistryEntry({entry:tampered,verifyRegistryRecord:()=>true,now}),/record digest mismatch/);
assert.throws(()=>validateProjectOwnerRegistryEntry({entry:{...entry,unexpected:true},verifyRegistryRecord:verify,now}),/exact supported fields/);
console.log('PROJECT_OWNER_REGISTRY_REVOKE_SUSPEND_TAMPER_AND_UNKNOWN_FIELDS_HANDLED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PROJECT_OWNER_REGISTRY_CONTRACT_PASS');
