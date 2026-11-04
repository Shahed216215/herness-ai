'use strict';
const assert = require('node:assert/strict');
const { retrieveCanonicalRecords, prepareCanonicalWrite, digest } = require('../services/mira-memory-unified-facade');
const now = new Date('2026-11-04T12:00:00.000Z');
const requestContext = {
 actorId:'actor-fixture-01',actorType:'HUMAN',projectId:'project-alpha',
 purpose:'phase3-facade-test',requestId:'request-facade-01',authorityRef:'host-authz-facade-01',
 issuedAt:'2026-11-04T11:59:00.000Z',expiresAt:'2026-11-04T12:05:00.000Z'
};
function authorize(input) { return {
 decision:'ALLOW',actorId:input.actorId,actorType:input.actorType,projectId:input.projectId,purpose:input.purpose,
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
console.log('RETRIEVAL_SCOPE_TRUST_AND_QUARANTINE_FILTER_PASS=PASS');
assert.throws(()=>retrieveCanonicalRecords({records:[active],pendingConflicts:[],projectId:'project-beta',requestContext,authorizeRequest:authorize,now}),/project scope/);
console.log('RETRIEVAL_CROSS_PROJECT_CONTEXT_REJECTED=PASS');
assert.deepEqual(retrieveCanonicalRecords({records:[active],pendingConflicts:[],projectId:'project-alpha',requestContext,authorizeRequest:input=>({...authorize(input),decision:'DENY'}),now}),[]);
console.log('RETRIEVAL_HOST_DENY_EXCLUDES_RECORDS=PASS');

const newRecord=record();
const preparedCreate=prepareCanonicalWrite({incomingRecord:newRecord,existingRecords:[],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:null,idempotencyKey:'idem-create-001',now});
assert.equal(preparedCreate.status,'PREPARED_NOT_COMMITTED');
assert.equal(preparedCreate.committed,false);
console.log('WRITE_CREATE_PREPARE_ONLY_PASS=PASS');
const previous=record();
const next=record({content:'updated synthetic content',version:{revision:2,contentHash:'0'.repeat(64)},timestamps:{createdAt:previous.timestamps.createdAt,updatedAt:'2026-11-04T11:45:00.000Z'}});
const preparedUpdate=prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-update-001',now});
assert.equal(preparedUpdate.previousRecordDigest,digest(previous));
assert.equal(preparedUpdate.nextRevision,2);
console.log('WRITE_MONOTONIC_REVISION_PREPARE_PASS=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:0,idempotencyKey:'idem-stale-001',now}),/Expected revision/);
console.log('WRITE_STALE_REVISION_REJECTED=PASS');
assert.throws(()=>prepareCanonicalWrite({incomingRecord:next,existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-update-001',seenIdempotencyKeys:['idem-update-001'],now}),/Duplicate idempotency/);
console.log('WRITE_DUPLICATE_IDEMPOTENCY_REJECTED=PASS');
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
assert.throws(()=>prepareCanonicalWrite({incomingRecord:record({access:{classification:'RESTRICTED',allowedProjectIds:['project-alpha']}}),existingRecords:[previous],pendingConflicts:[],requestContext,authorizeRequest:authorize,expectedRevision:1,idempotencyKey:'idem-access-001',now}),/access changes require/);
console.log('WRITE_ACCESS_CHANGE_REQUIRES_GOVERNED_OPERATION=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PHASE3_SYNTHETIC_UNIFIED_FACADE_PASS');
