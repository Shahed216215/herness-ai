'use strict';
const assert=require('node:assert/strict');
const {normalizeTrustedActorIdentity}=require('../services/mira-memory-host-identity-contract');
const now=new Date('2026-11-04T12:00:00.000Z');
function principal(overrides={}){
 return {
  verified:true,issuer:'mira.users',subject:'user-fixture-01',actorType:'HUMAN',
  authenticationMethod:'USER_SESSION',authenticationRef:'session-ref-fixture-01',
  authenticatedAt:'2026-11-04T11:59:00.000Z',expiresAt:'2026-11-04T12:10:00.000Z',
  ...overrides
 };
}
const identity=normalizeTrustedActorIdentity({verifiedPrincipal:principal(),now});
assert.equal(identity.actorId,'mira.users/user-fixture-01');
assert.equal(identity.actorType,'HUMAN');
assert.equal(Object.isFrozen(identity),true);
console.log('TRUSTED_USER_SESSION_SUBJECT_NORMALIZED=PASS');
for(const candidate of [
 principal({verified:false}),
 principal({subject:''}),
 principal({actorType:'ROLE_ADMIN'}),
 principal({authenticationMethod:'BEARER_RAW_TOKEN'}),
 principal({expiresAt:'2026-11-04T11:59:59.000Z'}),
 principal({authenticatedAt:'2026-11-04T12:01:00.000Z'}),
 principal({token:'secret-must-not-enter-identity'})
]){
 assert.throws(()=>normalizeTrustedActorIdentity({verifiedPrincipal:candidate,now}));
}
console.log('UNVERIFIED_ROLE_ONLY_EXPIRED_AND_CREDENTIAL_BEARING_PRINCIPALS_DENIED=PASS');
const admin=normalizeTrustedActorIdentity({verifiedPrincipal:principal({
 issuer:'mira.admins',subject:'admin-subject-01',actorType:'HUMAN',
 authenticationMethod:'ADMIN_SUBJECT',authenticationRef:'admin-auth-ref-01'
}),now});
assert.equal(admin.actorId,'mira.admins/admin-subject-01');
const service=normalizeTrustedActorIdentity({verifiedPrincipal:principal({
 issuer:'mira.services',subject:'service-agent-01',actorType:'SERVICE',
 authenticationMethod:'SERVICE_CREDENTIAL',authenticationRef:'service-auth-ref-01'
}),now});
assert.equal(service.actorType,'SERVICE');
console.log('STABLE_ADMIN_AND_SERVICE_SUBJECTS_SUPPORTED=PASS');
assert.throws(()=>normalizeTrustedActorIdentity({verifiedPrincipal:{...principal(),role:'SYSTEM_ADMIN'},now}),/exact supported fields/);
assert.throws(()=>normalizeTrustedActorIdentity({verifiedPrincipal:null,now}),/required/);
console.log('CALLER_ROLE_AND_MISSING_PRINCIPAL_REJECTED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_HOST_IDENTITY_CONTRACT_PASS');
