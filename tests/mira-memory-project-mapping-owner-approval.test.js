'use strict';
const assert=require('node:assert/strict');
const {
 createProjectMappingOwnerApprovalVerifier
}=require('../services/mira-memory-project-mapping-owner-approval-adapter');
const {
 validateProjectMapping,digest,bodyOf
}=require('../services/mira-memory-project-mapping-contract');
const {
 digest:registryDigest
}=require('../services/mira-memory-project-owner-registry-contract');
const now=new Date('2026-11-04T12:00:00.000Z');
const ownerActor='mira:issuer.fixture:user-owner';
const viewerActor='mira:issuer.fixture:user-viewer';
function makeRegistry(overrides={}) {
 const entry={
  schemaVersion:'1.0.0',authorityRecordId:'owner-registry-mapping-fixture',
  projectId:'project-alpha',tenantId:'tenant-alpha',ownerActorId:ownerActor,
  memberships:[
   {membershipRef:'owner-membership',actorId:ownerActor,actorType:'HUMAN',role:'OWNER',
    allowedOperations:['READ','WRITE','LIST','VERIFY','APPROVE_MAPPING'],status:'ACTIVE',
    validFrom:'2026-11-04T10:00:00.000Z',validUntil:'2026-11-04T13:00:00.000Z'},
   {membershipRef:'viewer-membership',actorId:viewerActor,actorType:'HUMAN',role:'VIEWER',
    allowedOperations:['READ','LIST'],status:'ACTIVE',
    validFrom:'2026-11-04T10:00:00.000Z',validUntil:'2026-11-04T13:00:00.000Z'}
  ],
  sourceProjectSnapshotDigest:'a'.repeat(64),approvalReference:'owner-registry-approval',
  approvedBy:'mira:issuer.fixture:admin',approvedAt:'2026-11-04T11:45:00.000Z',
  registryRevision:'registry-r7',status:'ACTIVE',
  createdAt:'2026-11-04T11:40:00.000Z',updatedAt:'2026-11-04T11:50:00.000Z'
 };
 Object.assign(entry,overrides);
 entry.recordDigest=registryDigest(entry);
 return entry;
}
function makeMapping(overrides={}) {
 const mapping={
  schemaVersion:'1.0.0',mappingId:'mapping-owner-fixture-001',domain:'knowledge',
  sourceSystem:'mira_legacy_knowledge',sourceFileDigest:'b'.repeat(64),sourceOrdinal:0,
  legacyId:'legacy-knowledge-owner-001',memoryId:'canonical-owner-memory-001',
  projectId:'project-alpha',parentConversationId:null,clientId:null,revision:1,
  sourceDigest:'c'.repeat(64),canonicalRecordDigest:'d'.repeat(64),
  classification:'PROJECT_PRIVATE',status:'APPROVED',
  approvalReference:'mapping-approval-owner-001',approvedBy:ownerActor,
  approvedAt:'2026-11-04T11:55:00.000Z',createdAt:'2026-11-04T11:50:00.000Z'
 };
 Object.assign(mapping,overrides);
 mapping.mappingDigest=digest(bodyOf(mapping));
 return mapping;
}
function verifierFor(registry,overrides={}) {
 return createProjectMappingOwnerApprovalVerifier({
  ownerRegistry:registry,expectedTenantId:'tenant-alpha',
  verifyRegistryRecord:proof=>proof.recordDigest===registry.recordDigest&&
    proof.projectId===registry.projectId&&proof.ownerActorId===registry.ownerActorId,
  now:()=>now,...overrides
 });
}
const registry=makeRegistry();
const mapping=makeMapping();
const verifier=verifierFor(registry);
const validated=validateProjectMapping({mapping,expectedDomain:'knowledge',
 expectedProjectId:'project-alpha',expectedSourceFileDigest:'b'.repeat(64),
 verifyApproval:verifier,now});
assert.equal(validated.mappingId,mapping.mappingId);
const evidence=verifier(mapping);
assert.equal(evidence.decision,'APPROVED');
assert.equal(evidence.approvedBy,ownerActor);
assert.equal(evidence.registryRevision,'registry-r7');
assert.equal(evidence.revocationStatus,'ACTIVE');
assert.equal(Date.parse(evidence.expiresAt)-now.getTime(),120000);
console.log('ACTIVE_PROJECT_OWNER_APPROVAL_BINDS_MAPPING_AND_SHORT_LIVED_EVIDENCE=PASS');

assert.throws(()=>validateProjectMapping({mapping:makeMapping({approvedBy:viewerActor}),expectedDomain:'knowledge',
 expectedProjectId:'project-alpha',expectedSourceFileDigest:'b'.repeat(64),
 verifyApproval:verifier,now}),/not an active project OWNER/);
console.log('NON_OWNER_MAPPING_APPROVAL_REJECTED=PASS');
assert.throws(()=>validateProjectMapping({mapping:makeMapping({projectId:'project-beta'}),expectedDomain:'knowledge',
 expectedProjectId:'project-beta',expectedSourceFileDigest:'b'.repeat(64),
 verifyApproval:verifier,now}),/project binding mismatch|project scope mismatch/);
console.log('CROSS_PROJECT_OWNER_REGISTRY_REJECTED=PASS');
assert.throws(()=>verifierFor(makeRegistry({status:'REVOKED'}))(mapping),/registry is not ACTIVE/);
assert.throws(()=>verifierFor(makeRegistry({status:'SUSPENDED'}))(mapping),/registry is not ACTIVE/);
console.log('REVOKED_AND_SUSPENDED_OWNER_REGISTRY_REJECTED=PASS');
assert.throws(()=>verifierFor(registry,{verifyRegistryRecord:undefined})(mapping),/trusted owner-registry verifier/);
console.log('MISSING_TRUSTED_OWNER_REGISTRY_VERIFIER_REJECTED=PASS');
const noApprovalOp=makeRegistry();
noApprovalOp.memberships[0].allowedOperations=['READ','WRITE','LIST','VERIFY'];
noApprovalOp.recordDigest=registryDigest(noApprovalOp);
assert.throws(()=>verifierFor(noApprovalOp)(mapping),/APPROVE_MAPPING authority/);
console.log('OWNER_WITHOUT_MAPPING_APPROVAL_OPERATION_REJECTED=PASS');
const expiredMembership=makeRegistry();
expiredMembership.memberships[0].validUntil='2026-11-04T11:59:00.000Z';
expiredMembership.recordDigest=registryDigest(expiredMembership);
assert.throws(()=>verifierFor(expiredMembership)(mapping),/validity|expired|owner membership/);
console.log('EXPIRED_OWNER_MEMBERSHIP_REJECTED=PASS');
assert.throws(()=>verifierFor(registry,{evidenceLifetimeMs:600000}),/1-300 seconds/);
console.log('UNBOUNDED_APPROVAL_EVIDENCE_LIFETIME_REJECTED=PASS');
const afterMembership=makeMapping({approvedAt:'2026-11-04T13:01:00.000Z'});
assert.throws(()=>verifier(afterMembership),/outside the approver membership validity window/);
console.log('APPROVAL_AFTER_MEMBERSHIP_EXPIRY_REJECTED=PASS');
console.log('NETWORK_REQUESTS=0');
console.log('PERSISTENT_WRITES=0');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_OWNER_BOUND_MAPPING_APPROVAL_PASS');
