'use strict';
const assert = require('node:assert/strict');
const { validateRequestContext, authorizeMemoryRequest } = require('../services/mira-memory-request-authorization');
const now = new Date('2026-11-04T12:00:00.000Z');
const ctx = {
 actorId:'actor-fixture-01',actorType:'HUMAN',projectId:'project-fixture-01',
 purpose:'isolated-contract-test',requestId:'request-fixture-01',authorityRef:'host-authz-fixture-01',
 issuedAt:'2026-11-04T11:59:00.000Z',expiresAt:'2026-11-04T12:05:00.000Z'
};
function allow(input){return {
 decision:'ALLOW',actorId:input.actorId,projectId:input.projectId,purpose:input.purpose,
 requestId:input.requestId,operation:input.operation,resourceScope:input.resourceScope,
 authorityRef:input.authorityRef,issuedAt:'2026-11-04T11:59:30.000Z',expiresAt:'2026-11-04T12:04:00.000Z'
};}
assert.equal(validateRequestContext(ctx).actorId,ctx.actorId);
console.log('REQUEST_CONTEXT_VALID=PASS');
const authorized=authorizeMemoryRequest({requestContext:ctx,operation:'READ',resourceScope:'memory:project-fixture-01',authorizeRequest:allow,now});
assert.equal(authorized.authorized,true);
assert.equal(authorized.projectId,ctx.projectId);
console.log('HOST_AUTHORIZATION_BINDING_PASS=PASS');
for(const patch of [
 {actorId:''},{actorType:'ROOT'},{projectId:''},{purpose:''},{requestId:''},{authorityRef:''},
 {issuedAt:'2026-11-04'},{issuedAt:'2026-02-30T11:59:00.000Z'},{expiresAt:'2026-11-04T11:59:00.000Z'}
]) assert.throws(()=>validateRequestContext({...ctx,...patch}));
console.log('MISSING_INVALID_AND_NONPOSITIVE_CONTEXT_REJECTED=PASS');
assert.throws(()=>validateRequestContext({...ctx,extra:'untrusted'}),/exact supported fields/);
console.log('UNKNOWN_CONTEXT_FIELD_REJECTED=PASS');
assert.throws(()=>authorizeMemoryRequest({requestContext:{...ctx,expiresAt:'2026-11-04T11:59:59.000Z'},operation:'READ',resourceScope:'memory:x',authorizeRequest:allow,now}),/expired/);
console.log('EXPIRED_CONTEXT_REJECTED=PASS');
assert.throws(()=>authorizeMemoryRequest({requestContext:{...ctx,issuedAt:'2026-11-04T12:01:00.000Z'},operation:'READ',resourceScope:'memory:x',authorizeRequest:allow,now}),/not yet valid/);
console.log('FUTURE_CONTEXT_REJECTED=PASS');
assert.throws(()=>authorizeMemoryRequest({requestContext:ctx,operation:'DELETE',resourceScope:'memory:x',authorizeRequest:allow,now}),/Unsupported memory operation/);
console.log('UNSUPPORTED_OPERATION_REJECTED=PASS');
assert.throws(()=>authorizeMemoryRequest({requestContext:ctx,operation:'READ',resourceScope:'memory:x',now}),/Trusted host authorizeRequest callback is required/);
console.log('MISSING_HOST_AUTHORIZER_REJECTED=PASS');
assert.throws(()=>authorizeMemoryRequest({requestContext:ctx,operation:'READ',resourceScope:'memory:x',authorizeRequest:()=>({decision:'ALLOW'}),now}),/invalid shape/);
console.log('MALFORMED_HOST_DECISION_REJECTED=PASS');
for(const patch of [
 {actorId:'attacker'},{projectId:'other-project'},{operation:'WRITE'},{resourceScope:'memory:other'}
]) assert.throws(()=>authorizeMemoryRequest({requestContext:ctx,operation:'READ',resourceScope:'memory:x',authorizeRequest:input=>({...allow(input),...patch}),now}));
console.log('ACTOR_PROJECT_OPERATION_RESOURCE_SUBSTITUTION_REJECTED=PASS');
assert.throws(()=>authorizeMemoryRequest({requestContext:ctx,operation:'READ',resourceScope:'memory:x',authorizeRequest:input=>({...allow(input),expiresAt:'2026-11-04T12:06:00.000Z'}),now}),/outlives request context/);
console.log('AUTHORIZATION_OVERLIFETIME_REJECTED=PASS');
assert.throws(()=>authorizeMemoryRequest({requestContext:ctx,operation:'READ',resourceScope:'memory:x',authorizeRequest:input=>({...allow(input),issuedAt:'2026-11-04T11:58:00.000Z'}),now}),/future-dated|outlives request context/);
console.log('PRE_CONTEXT_AUTHORIZATION_DECISION_REJECTED=PASS');
assert.throws(()=>authorizeMemoryRequest({requestContext:ctx,operation:'READ',resourceScope:'memory:x',authorizeRequest:input=>({...allow(input),decision:'DENY'}),now}),/denied by host policy/);
console.log('HOST_POLICY_DENY_ENFORCED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PHASE3_REQUEST_AUTHORIZATION_CONTRACT_PASS');
