'use strict';
const assert=require('node:assert/strict');
const {validateProjectAuthorityEvidence,digest,bodyOf}=require('../services/mira-memory-project-authority-contract');
const now=new Date('2026-11-04T12:00:00.000Z');
function make(overrides={}){
 const value={
  schemaVersion:'1.0.0',decision:'ALLOW',actorId:'actor-fixture-01',actorType:'HUMAN',
  projectId:'project-fixture-01',operation:'READ',resourceScope:'memory:memory-fixture-01',
  authorityRef:'host-authority-fixture-01',membershipRef:'membership-fixture-01',
  membershipRole:'OWNER',allowedOperations:['READ','LIST','WRITE'],registryRevision:'registry-rev-01',
  status:'ACTIVE',revocationStatus:'ACTIVE',approvedBy:'admin-authority-01',
  approvedAt:'2026-11-04T11:58:00.000Z',verifiedAt:'2026-11-04T11:59:30.000Z',
  expiresAt:'2026-11-04T12:10:00.000Z'
 };
 Object.assign(value,overrides);
 value.evidenceDigest=digest(value);
 return value;
}
const verifier=evidence=>evidence.authorityRef==='host-authority-fixture-01'&&evidence.registryRevision==='registry-rev-01';
const evidence=make();
const valid=validateProjectAuthorityEvidence({
 evidence,expectedActorId:'actor-fixture-01',expectedActorType:'HUMAN',
 expectedProjectId:'project-fixture-01',expectedOperation:'READ',
 expectedResourceScope:'memory:memory-fixture-01',verifyEvidence:verifier,now
});
assert.equal(valid.projectId,'project-fixture-01');
assert.equal(Object.isFrozen(valid),true);
assert.equal(Object.isFrozen(valid.allowedOperations),true);
console.log('PROJECT_AUTHORITY_EVIDENCE_VALID_AND_IMMUTABLE=PASS');
for(const patch of [
 {decision:'DENY'},{status:'SUSPENDED'},{revocationStatus:'REVOKED'},
{operation:'DELETE'},
 {allowedOperations:['LIST']},{membershipRole:'UNKNOWN'},{registryRevision:''}
]){
 const candidate=make(patch);
 assert.throws(()=>validateProjectAuthorityEvidence({evidence:candidate,verifyEvidence:verifier,now}));
}
console.log('PROJECT_AUTHORITY_DENY_REVOKE_AND_SUBSTITUTION_REJECTED=PASS');
assert.throws(()=>validateProjectAuthorityEvidence({evidence,expectedActorId:'actor-other',verifyEvidence:verifier,now}),/binding mismatch: actorId/);
assert.throws(()=>validateProjectAuthorityEvidence({evidence,expectedProjectId:'project-other',verifyEvidence:verifier,now}),/binding mismatch: projectId/);
assert.throws(()=>validateProjectAuthorityEvidence({evidence,expectedOperation:'WRITE',verifyEvidence:verifier,now}),/binding mismatch: operation/);
assert.throws(()=>validateProjectAuthorityEvidence({evidence,expectedResourceScope:'memory:other',verifyEvidence:verifier,now}),/binding mismatch: resourceScope/);
console.log('PROJECT_AUTHORITY_EXACT_REQUEST_BINDING_ENFORCED=PASS');
assert.throws(()=>validateProjectAuthorityEvidence({evidence:make({expiresAt:'2026-11-04T11:59:59.000Z'}),verifyEvidence:verifier,now}),/expired/);
assert.throws(()=>validateProjectAuthorityEvidence({evidence:make({expiresAt:'2026-11-04T11:59:00.000Z'}),verifyEvidence:verifier,now}),/temporally inconsistent/);
assert.throws(()=>validateProjectAuthorityEvidence({evidence:make({verifiedAt:'2026-11-04T12:01:00.000Z'}),verifyEvidence:verifier,now}),/future-dated/);
console.log('PROJECT_AUTHORITY_EXPIRY_AND_FUTURE_EVIDENCE_REJECTED=PASS');
assert.throws(()=>validateProjectAuthorityEvidence({evidence,verifyEvidence:undefined,now}),/verifier is required/);
assert.throws(()=>validateProjectAuthorityEvidence({evidence,verifyEvidence:()=>false,now}),/verification failed/);
console.log('PROJECT_AUTHORITY_MISSING_OR_FAILED_VERIFIER_REJECTED=PASS');
const tampered=make();tampered.evidenceDigest='0'.repeat(64);
assert.throws(()=>validateProjectAuthorityEvidence({evidence:tampered,verifyEvidence:verifier,now}),/digest mismatch/);
console.log('PROJECT_AUTHORITY_EVIDENCE_TAMPER_REJECTED=PASS');
assert.throws(()=>validateProjectAuthorityEvidence({evidence:make({extra:'unknown'}),verifyEvidence:verifier,now}),/exact supported fields/);
console.log('PROJECT_AUTHORITY_UNKNOWN_FIELD_REJECTED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PROJECT_AUTHORITY_EVIDENCE_CONTRACT_PASS');
