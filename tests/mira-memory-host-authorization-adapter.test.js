'use strict';
const assert=require('node:assert/strict');
const {createHostAuthorizationAdapter}=require('../services/mira-memory-host-authorization-adapter');
const {digest}=require('../services/mira-memory-project-authority-contract');
const {authorizeMemoryRequest}=require('../services/mira-memory-request-authorization');
const now=new Date('2026-11-04T12:00:00.000Z');
const context={
 actorId:'actor-fixture-01',actorType:'HUMAN',projectId:'project-fixture-01',
 purpose:'host-adapter-test',requestId:'request-host-adapter-01',
 authorityRef:'host-authority-fixture-01',issuedAt:'2026-11-04T11:59:00.000Z',
 expiresAt:'2026-11-04T12:05:00.000Z'
};
function authorityEvidence(overrides={}){
 const value={
  schemaVersion:'1.0.0',decision:'ALLOW',actorId:context.actorId,actorType:context.actorType,
  projectId:context.projectId,operation:'READ',resourceScope:'memory:memory-fixture-01',
  authorityRef:context.authorityRef,membershipRef:'membership-fixture-01',membershipRole:'OWNER',
  allowedOperations:['READ','LIST'],registryRevision:'registry-rev-01',status:'ACTIVE',
  revocationStatus:'ACTIVE',approvedBy:'admin-authority-01',approvedAt:'2026-11-04T11:58:00.000Z',
  verifiedAt:'2026-11-04T11:59:30.000Z',expiresAt:'2026-11-04T12:04:00.000Z'
 };
 Object.assign(value,overrides);value.evidenceDigest=digest(value);return value;
}
const consumed=new Set();
const adapter=createHostAuthorizationAdapter({
 getProjectAuthorityEvidence:()=>authorityEvidence(),
 verifyProjectAuthorityEvidence:e=>e.registryRevision==='registry-rev-01',
 consumeReplayRequest:input=>{
  const key=input.authorityRef+'|'+input.requestId;
  if(consumed.has(key)) return false;
  consumed.add(key);return true;
 },
 now:()=>now
});
const input={...context,operation:'READ',resourceScope:'memory:memory-fixture-01'};
const decision=adapter(input);
assert.equal(decision.decision,'ALLOW');
assert.equal(decision.replayStatus,'FRESH');
assert.equal(decision.expiresAt,'2026-11-04T12:04:00.000Z');
const helperContext={...context,requestId:'request-host-adapter-flow-01'};
assert.equal(authorizeMemoryRequest({requestContext:helperContext,operation:'READ',resourceScope:input.resourceScope,authorizeRequest:adapter,now}).authorized,true);
console.log('HOST_ADAPTER_PROJECT_AUTHORITY_AND_REPLAY_PASS=PASS');
const replayContext={...context,requestId:'request-host-adapter-replay-01'};
const replayInput={...replayContext,operation:'READ',resourceScope:input.resourceScope};
assert.equal(adapter(replayInput).replayStatus,'FRESH');
assert.throws(()=>authorizeMemoryRequest({requestContext:replayContext,operation:'READ',resourceScope:input.resourceScope,authorizeRequest:adapter,now}),/denied by host policy/);
console.log('HOST_ADAPTER_REPLAY_DENIED_ON_SECOND_USE=PASS');
const wrongOwner=createHostAuthorizationAdapter({
 getProjectAuthorityEvidence:()=>authorityEvidence({actorId:'actor-other'}),
 verifyProjectAuthorityEvidence:()=>true,consumeReplayRequest:()=>true,now:()=>now
});
assert.throws(()=>wrongOwner(input),/binding mismatch: actorId/);
console.log('HOST_ADAPTER_NON_OWNER_REJECTED=PASS');
const insufficient=createHostAuthorizationAdapter({
 getProjectAuthorityEvidence:()=>authorityEvidence({allowedOperations:['LIST']}),
 verifyProjectAuthorityEvidence:()=>true,consumeReplayRequest:()=>true,now:()=>now
});
assert.throws(()=>insufficient(input),/not included in approved membership permissions/);
console.log('HOST_ADAPTER_UNAPPROVED_OPERATION_REJECTED=PASS');
const wrongAuthority=createHostAuthorizationAdapter({
 getProjectAuthorityEvidence:()=>authorityEvidence({authorityRef:'different-ref'}),
 verifyProjectAuthorityEvidence:()=>true,consumeReplayRequest:()=>true,now:()=>now
});
assert.throws(()=>wrongAuthority(input),/reference mismatch/);
console.log('HOST_ADAPTER_AUTHORITY_REFERENCE_SUBSTITUTION_REJECTED=PASS');
assert.throws(()=>createHostAuthorizationAdapter({}),/callbacks are required/);
console.log('HOST_ADAPTER_MISSING_DEPENDENCIES_REJECTED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_HOST_AUTHORIZATION_ADAPTER_PASS');
