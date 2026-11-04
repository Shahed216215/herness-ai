'use strict';
const assert = require('node:assert/strict');
const { retrieveCanonicalRecords, retrieveCanonicalRecordsWithReport, prepareCanonicalWrite, digest } = require('../services/mira-memory-unified-facade');
const now = new Date('2026-11-04T12:00:00.000Z');
const requestContext = {
 actorId:'actor-fixture-01',actorType:'HUMAN',projectId:'project-alpha',
 purpose:'phase3-facade-test',requestId:'request-facade-01',authorityRef:'host-authz-facade-01',
 issuedAt:'2026-11-04T11:59:00.000Z',expiresAt:'2026-11-04T12:05:00.000Z'
};
const observedAuthorizationScopes=[];
function authorize(input) { observedAuthorizationScopes.push(input.resourceScope); return {
 decision:'ALLOW',replayStatus:'FRESH',actorId:input.actorId,actorType:input.actorType,projectId:input.projectId,purpose:input.purpose,
 requestId:input.requestId,operation:input.operation,resourceScope:input.resourceScope,
 authorityRef:input.authorityRef,issuedAt:'2026-11-04T11:59:30.000Z',expiresAt:'2026-11-04T12:04:00.000Z'
};}
function record(overrides={}) {
 const content=overrides.content || 'synthetic content';
 const value={
  schemaVersion:'1.0.0',memoryId:'memory-fixture-001',projectId:'project-alpha',
  recordType:'fact',content,
  source:{sourceType:'manual',sourceId:'fixture-source-001',sourceUrl:null,observedAt:'2026-11-04T11:00:00.000Z'},
  timestamps:{createdAt:'2026-11-04T11:00:00.000Z',updatedAt:'2026-11-04T11:30:00.000Z'},
  version:{revision:1,contentHash:require('node:crypto').createHash('sha256').update(JSON.stringify(content),'utf8').digest('hex')},
  integrity:{status:'VERIFIED',algorithm:'SHA-256'},trust:{status:'CONTENT_VERIFIED'},
  access:{classification:'PROJECT_PRIVATE',allowedProjectIds:['project-alpha']},lifecycle:'ACTIVE'
 };
 Object.assign(value,overrides);
 value.version={...value.version,contentHash:require('node:crypto').createHash('sha256').update(JSON.stringify(value.content),'utf8').digest('hex')};
 return value;
}
const active=record();
const pending=record({memoryId:'memory-fixture-002',lifecycle:'PENDING_REVIEW'});
const cross=record({memoryId:'memory-fixture-003',projectId:'project-beta',access:{classification:'PROJECT_PRIVATE',allowedProjectIds:['project-beta']}});
const quarantined=record({memoryId:'memory-fixture-004'});
const conflicts=[{projectId:'project-alpha',status:'QUARANTINED',originalMemoryIds:['memory-fixture-004']}];
const visible=retrieveCanonicalRecords({records:[active,pending,cross,quarantined],pendingConflicts:conflicts,projectId:'project-alpha',requestContext,authorizeRequest:authorize,now});
assert.deepEqual(visible.map(item=>item.memoryId),['memory-fixture-001']);
assert.equal(Object.isFrozen(visible[0]),true);
assert.equal(Object.isFrozen(visible[0].access),true);
assert.notEqual(visible[0],active);
const report=retrieveCanonicalRecordsWithReport({records:[active,pending,cross,quarantined],pendingConflicts:conflicts,projectId:'project-alpha',requestContext,authorizeRequest:authorize,now});
assert.deepEqual(report.records.map(item=>item.memoryId),['memory-fixture-001']);
assert.equal(report.excludedSummary.totalCandidates,4);
assert.equal(report.excludedSummary.eligibleCount,1);
assert.equal(report.excludedSummary.excludedCount,3);
assert.deepEqual(report.excludedSummary.excludedByReason,{
 LIFECYCLE_NOT_ACTIVE:1,
 PROJECT_SCOPE_MISMATCH:1,
 CONFLICT_QUARANTINED_OR_UNSELECTED_VERSION:1
});
assert.equal(report.provenance[0].recordDigest,digest(active));
assert.deepEqual(report.provenance[0].source,active.source);
assert.equal(report.eligibility[0].reasonCode,'AUTHORIZED_READ');
assert.equal(report.auditStatus,'NOT_EMITTED_REPORT_ONLY');
assert.equal(JSON.stringify(report).includes('memory-fixture-002'),false);
assert.equal(Object.isFrozen(report),true);
assert.equal(Object.isFrozen(report.excludedSummary.excludedByReason),true);
console.log('RETRIEVAL_PROVENANCE_AND_NONLEAKING_ELIGIBILITY_REPORT_PASS=PASS');
console.log('RETRIEVAL_SCOPE_TRUST_AND_QUARANTINE_FILTER_PASS=PASS');
console.log('RETRIEVAL_RESULTS_ARE_DETACHED_AND_DEEPLY_FROZEN=PASS');
assert.throws(()=>retrieveCanonicalRecords({records:[active],pendingConflicts:[],projectId:'project-beta',requestContext,authorizeRequest:authorize,now}),/project scope/);
console.log('RETRIEVAL_CROSS_PROJECT_CONTEXT_REJECTED=PASS');
assert.deepEqual(retrieveCanonicalRecords({records:[active],pendingConflicts:[],projectId:'project-alpha',requestContext,authorizeRequest:input=>({...authorize(input),decision:input.operation==='READ'?'DENY':'ALLOW'}),now}),[]);
console.log('RETRIEVAL_HOST_DENY_EXCLUDES_RECORDS=PASS');
assert.ok(observedAuthorizationScopes.includes('memory:memory-fixture-001:classification:PROJECT_PRIVATE'));
const restricted=record({memoryId:'memory-fixture-restricted',access:{classification:'RESTRICTED',allowedProjectIds:['project-alpha']}});
assert.deepEqual(retrieveCanonicalRecords({records:[restricted],pendingConflicts:[],projectId:'project-alpha',requestContext,authorizeRequest:input=>input.resourceScope.endsWith(':RESTRICTED')?{...authorize(input),decision:'DENY'}:authorize(input),now}),[]);
const wrongAllowedProject=record({memoryId:'memory-fixture-allowed-project-mismatch',access:{classification:'PROJECT_PRIVATE',allowedProjectIds:['project-beta']}});
assert.deepEqual(retrieveCanonicalRecords({records:[wrongAllowedProject],pendingConflicts:[],projectId:'project-alpha',requestContext,authorizeRequest:authorize,now}),[]);
console.log('RETRIEVAL_AUTHORIZATION_BINDS_CLASSIFICATION=PASS');
console.log('RETRIEVAL_ALLOWED_PROJECT_LIST_ENFORCED=PASS');

const newRecord=record();
const preparedCreate=prepareCanonicalWrite({incomingRecord:newRecord,existingRecords:[],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:null,idempotencyKey:'idem-create-001',now});
assert.equal(preparedCreate.status,'PREPARED_NOT_COMMITTED');
assert.equal(preparedCreate.committed,false);
assert.equal(preparedCreate.auditStatus,'NOT_EMITTED_PREPARE_ONLY');
assert.equal(preparedCreate.idempotencyStatus,'NOT_ATOMIC_PREPARE_ONLY');
assert.equal(preparedCreate.idempotencyPlan.key,'idem-create-001');
assert.equal(preparedCreate.idempotencyPlan.requiredAtomicity,'HOST_ATOMIC_UNIQUE_CLAIM');
assert.equal(preparedCreate.idempotencyPlan.status,'NOT_RESERVED_PREPARE_ONLY');
assert.equal(preparedCreate.idempotencyPlan.incomingRecordDigest,preparedCreate.incomingRecordDigest);
assert.equal(Object.isFrozen(preparedCreate.idempotencyPlan),true);
assert.equal(preparedCreate.auditPlan.operation,'CREATE');
assert.equal(preparedCreate.auditPlan.actorId,requestContext.actorId);
assert.equal(preparedCreate.auditPlan.projectId,requestContext.projectId);
assert.equal(preparedCreate.auditPlan.requestId,requestContext.requestId);
assert.equal(preparedCreate.auditPlan.eventRequiredBeforeCommit,true);
assert.equal(preparedCreate.auditPlan.outcome,'PREPARED_NOT_COMMITTED');
assert.equal(preparedCreate.auditPlan.previousRecordDigest,null);
assert.equal(preparedCreate.rollbackPlan.action,'NOOP_UNCOMMITTED_CREATE');
assert.equal(preparedCreate.rollbackPlan.status,'PLAN_ONLY_NOT_EXECUTED');
assert.equal(preparedCreate.rollbackPlan.deleteOriginals,false);
assert.equal(preparedCreate.rollbackPlan.requiresHumanApproval,true);
assert.equal(Object.isFrozen(preparedCreate.rollbackPlan),true);
assert.equal(Object.isFrozen(preparedCreate.auditPlan),true);
assert.notEqual(preparedCreate.incomingRecord,newRecord);
assert.equal(Object.isFrozen(preparedCreate.incomingRecord),true);
assert.equal(Object.isFrozen(preparedCreate.incomingRecord.source),true);
assert.equal(newRecord.content,'synthetic content');
assert.throws(()=>{preparedCreate.incomingRecord.content='tampered-after-prepare';},TypeError);
console.log('WRITE_CREATE_PREPARE_ONLY_PASS=PASS');
console.log('WRITE_CANDIDATE_DETACHED_AND_DEEPLY_FROZEN=PASS');
const previous=record();
const next=record({content:'updated synthetic content',version:{revision:2,contentHash:'0'.repeat(64)},timestamps:{createdAt:previous.timestamps.createdAt,updatedAt:'2026-11-04T11:45:00.000Z'}});
const updateAuthorizationCalls=[];
const preparedUpdate=prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:input=>{updateAuthorizationCalls.push(input);return authorize(input);},expectedRevision:1,idempotencyKey:'idem-update-001',now});
assert.equal(preparedUpdate.previousRecordDigest,digest(previous));
assert.equal(preparedUpdate.nextRevision,2);
assert.equal(preparedUpdate.auditPlan.operation,'UPDATE');
assert.equal(preparedUpdate.idempotencyPlan.operation,'UPDATE');
assert.equal(preparedUpdate.idempotencyPlan.key,'idem-update-001');
assert.equal(preparedUpdate.idempotencyPlan.requiredAtomicity,'HOST_ATOMIC_UNIQUE_CLAIM');
assert.equal(preparedUpdate.idempotencyStatus,'NOT_ATOMIC_PREPARE_ONLY');
assert.equal(preparedUpdate.auditPlan.previousRevision,1);
assert.equal(preparedUpdate.auditPlan.previousRecordDigest,digest(previous));
assert.equal(preparedUpdate.rollbackPlan.action,'APPEND_COMPENSATING_REVISION_FROM_VERIFIED_PRIOR');
assert.equal(preparedUpdate.rollbackPlan.priorRevision,1);
assert.equal(preparedUpdate.rollbackPlan.preparedRevision,2);
assert.equal(preparedUpdate.rollbackPlan.rollbackRevisionAfterCommit,3);
assert.equal(preparedUpdate.rollbackPlan.priorRecordDigest,digest(previous));
assert.equal(preparedUpdate.rollbackPlan.preserveOriginalRevision,true);
assert.equal(preparedUpdate.rollbackPlan.deleteOriginals,false);
assert.equal(preparedUpdate.rollbackPlan.status,'PLAN_ONLY_NOT_EXECUTED');
assert.equal(Object.isFrozen(preparedUpdate.rollbackPlan),true);
assert.equal(previous.version.revision,1);
assert.equal(previous.content,'synthetic content');
assert.equal(preparedUpdate.auditPlan.nextRevision,2);
assert.equal(preparedUpdate.auditPlan.eventRequiredBeforeCommit,true);
assert.equal(preparedUpdate.auditStatus,'NOT_EMITTED_PREPARE_ONLY');
console.log('WRITE_MONOTONIC_REVISION_PREPARE_PASS=PASS');
assert.deepEqual(updateAuthorizationCalls.map(x=>x.operation),['WRITE','READ']);
assert.equal(updateAuthorizationCalls[0].resourceScope,'memory:memory-fixture-001:classification:PROJECT_PRIVATE');
assert.equal(updateAuthorizationCalls[1].resourceScope,updateAuthorizationCalls[0].resourceScope);
const restrictedWrite=record({memoryId:'memory-fixture-restricted-write',access:{classification:'RESTRICTED',allowedProjectIds:['project-alpha']}});
assert.throws(()=>prepareCanonicalWrite({incomingRecord:restrictedWrite,existingRecords:[],pendingConflicts:[],requestContext,authorizeRequest:input=>input.resourceScope.endsWith(':RESTRICTED')?{...authorize(input),decision:'DENY'}:authorize(input),expectedRevision:null,idempotencyKey:'idem-restricted-write',now}),/denied by host policy/);
console.log('WRITE_READ_AND_WRITE_SHARE_CLASSIFICATION_BOUND_SCOPE=PASS');
console.log('WRITE_RESTRICTED_CLASSIFICATION_HOST_DENY_ENFORCED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:input=>({...authorize(input),decision:input.operation==='READ'?'DENY':'ALLOW'}),expectedRevision:1,idempotencyKey:'idem-update-read-denied-001',now}),/denied by host policy/);
console.log('WRITE_UPDATE_REQUIRES_READ_AND_WRITE_AUTHORITY=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:0,idempotencyKey:'idem-stale-001',now}),/Expected revision/);
console.log('WRITE_STALE_REVISION_REJECTED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-update-001',seenIdempotencyKeys:['idem-update-001'],now}),/Duplicate idempotency/);
console.log('WRITE_DUPLICATE_IDEMPOTENCY_REJECTED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'x'.repeat(257),now}),/idempotencyKey is required and must be bounded/);
console.log('WRITE_OVERSIZED_IDEMPOTENCY_KEY_REJECTED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-history-overflow',seenIdempotencyKeys:Array(10001).fill('fixture'),now}),/Idempotency history is malformed/);
console.log('WRITE_OVERSIZED_IDEMPOTENCY_HISTORY_REJECTED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[{projectId:'project-alpha',status:'UNDER_REVIEW',originalMemoryIds:[previous.memoryId]}],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-conflict-001',now}),/unresolved conflict/);
console.log('WRITE_UNRESOLVED_CONFLICT_REJECTED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[{projectId:'project-alpha',status:'UNDER_REVIEW'}],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-malformed-conflict-001',now}),/Conflict metadata is malformed/);
console.log('WRITE_MALFORMED_CONFLICT_STATE_REJECTED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[record({lifecycle:'ARCHIVED'})],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-archived-001',now}),/not eligible for update/);
console.log('WRITE_NONACTIVE_EXISTING_RECORD_REJECTED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:record({content:'changed createdAt',timestamps:{createdAt:'2026-11-04T11:01:00.000Z',updatedAt:'2026-11-04T11:45:00.000Z'},version:{revision:2,contentHash:'0'.repeat(64)}}),existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-createdat-001',now}),/creation timestamp is immutable/);
console.log('WRITE_CREATION_TIMESTAMP_IMMUTABLE=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:input=>({...authorize(input),decision:'DENY'}),expectedRevision:1,idempotencyKey:'idem-denied-001',now}),/denied by host policy/);
console.log('WRITE_HOST_POLICY_DENY_ENFORCED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:record({version:{revision:3,contentHash:'0'.repeat(64)}}),existingRecords:[],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:null,idempotencyKey:'idem-rev-001',now}),/revision=1/);
console.log('WRITE_NEW_RECORD_REVISION_ENFORCED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:record({integrity:{status:'UNVERIFIED',algorithm:'SHA-256'}}),existingRecords:[],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:null,idempotencyKey:'idem-unverified-001',now}),/integrity-verified ACTIVE/);
console.log('WRITE_UNVERIFIED_RECORD_REJECTED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:{...next,access:{classification:'RESTRICTED',allowedProjectIds:['project-alpha']}},existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-access-001',now}),/access changes require/);
console.log('WRITE_ACCESS_CHANGE_REQUIRES_GOVERNED_OPERATION=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PHASE3_SYNTHETIC_UNIFIED_FACADE_PASS');
