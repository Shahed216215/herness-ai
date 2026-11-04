'use strict';
const assert = require('node:assert/strict');
const { validateProjectMapping, validateProjectMappings, digest, bodyOf } = require('../services/mira-memory-project-mapping-contract');
const now = new Date('2026-11-04T12:00:00.000Z');
function make(overrides = {}) {
 const value = {
  schemaVersion:'1.0.0',mappingId:'mapping-fixture-001',domain:'knowledge',
  sourceSystem:'mira_legacy_knowledge',sourceFileDigest:'a'.repeat(64),sourceOrdinal:0,
  legacyId:'kb_legacy_001',memoryId:'canonical-memory-001',projectId:'project-fixture-01',parentConversationId:null,
  revision:1,sourceDigest:'b'.repeat(64),canonicalRecordDigest:'c'.repeat(64),
  classification:'PROJECT_PRIVATE',status:'APPROVED',approvalReference:'APPROVAL-FIXTURE-001',
  approvedBy:'human-approver-fixture',approvedAt:'2026-11-04T11:58:00.000Z',
  createdAt:'2026-11-04T11:57:00.000Z'
 };
 Object.assign(value,overrides);
 value.mappingDigest=digest(bodyOf(value));
 return value;
}
const verifier = evidence => evidence.approvalReference === 'APPROVAL-FIXTURE-001' && evidence.approvedBy === 'human-approver-fixture';
const mapping=make();
assert.equal(validateProjectMapping({mapping,expectedDomain:'knowledge',expectedProjectId:'project-fixture-01',expectedSourceFileDigest:'a'.repeat(64),verifyApproval:verifier,now}).mappingId,mapping.mappingId);
console.log('APPROVED_MAPPING_VALIDATION_PASS=PASS');
for(const patch of [
 {status:'PENDING_REVIEW'},{status:'REVOKED'},{projectId:'project-other'},
 {domain:'general_memory'},{sourceSystem:'untrusted_source_system'},{sourceFileDigest:'not-a-sha256'},
 {sourceDigest:'not-a-sha256'},{memoryId:'short'},{revision:2},
 {classification:'UNKNOWN'},{approvalReference:''},{approvedBy:''}
]) assert.throws(()=>validateProjectMapping({mapping:make(patch),expectedDomain:'knowledge',expectedProjectId:'project-fixture-01',expectedSourceFileDigest:'a'.repeat(64),verifyApproval:verifier,now}));
console.log('UNAPPROVED_AND_INVALID_MAPPING_REJECTED=PASS');
assert.throws(()=>validateProjectMapping({mapping:make(),verifyApproval:undefined,now}),/Trusted approval verifier/);
console.log('MISSING_TRUSTED_APPROVAL_VERIFIER_REJECTED=PASS');
assert.throws(()=>validateProjectMapping({mapping:make(),verifyApproval:()=>false,now}),/could not be independently verified/);
console.log('UNVERIFIED_APPROVAL_REJECTED=PASS');
const tamperedMapping=make();
tamperedMapping.mappingDigest='0'.repeat(64);
assert.throws(()=>validateProjectMapping({mapping:tamperedMapping,verifyApproval:verifier,now}),/digest mismatch/);
console.log('MAPPING_TAMPER_REJECTED=PASS');
assert.throws(()=>validateProjectMapping({mapping:make(),expectedProjectId:'project-other',verifyApproval:verifier,now}),/project scope mismatch/);
console.log('CROSS_PROJECT_MAPPING_REJECTED=PASS');
assert.throws(()=>validateProjectMapping({mapping:make(),expectedSourceFileDigest:'f'.repeat(64),verifyApproval:verifier,now}),/snapshot mismatch/);
console.log('STALE_SOURCE_SNAPSHOT_REJECTED=PASS');
assert.throws(()=>validateProjectMapping({mapping:make({approvedAt:'2026-11-04T12:01:00.000Z'}),verifyApproval:verifier,now}),/future/);
console.log('FUTURE_APPROVAL_REJECTED=PASS');
assert.throws(()=>validateProjectMapping({mapping:make({approvedAt:'2026-11-04T11:56:00.000Z'}),verifyApproval:verifier,now}),/cannot predate/);
console.log('APPROVAL_PRECEDING_CREATION_REJECTED=PASS');
assert.throws(()=>validateProjectMapping({mapping:make({approvedAt:'2026-02-30T12:00:00.000Z'}),verifyApproval:verifier,now}),/invalid calendar date/);
console.log('INVALID_CALENDAR_DATE_REJECTED=PASS');
assert.throws(()=>validateProjectMappings({mappings:[mapping,make({mappingId:'mapping-fixture-002',legacyId:'kb_legacy_002'})],expectedDomain:'knowledge',expectedProjectId:'project-fixture-01',expectedSourceFileDigest:'a'.repeat(64),verifyApproval:verifier,now}),/Duplicate canonical memoryId/);
console.log('DUPLICATE_CANONICAL_ID_REJECTED=PASS');
const second=make({mappingId:'mapping-fixture-002',legacyId:'kb_legacy_002',memoryId:'canonical-memory-002',sourceOrdinal:1});
assert.equal(validateProjectMappings({mappings:[mapping,second],expectedDomain:'knowledge',expectedProjectId:'project-fixture-01',expectedSourceFileDigest:'a'.repeat(64),verifyApproval:verifier,now}).length,2);
console.log('BATCH_MAPPING_VALIDATION_PASS=PASS');
const crm=make({domain:'crm_conversation_message',sourceSystem:'mira_crm_conversation',legacyId:'crm-message-fixture-01',sourceOrdinal:null,parentConversationId:'conversation-fixture-01'});
assert.equal(validateProjectMapping({mapping:crm,expectedDomain:'crm_conversation_message',expectedProjectId:'project-fixture-01',expectedSourceFileDigest:'a'.repeat(64),verifyApproval:verifier,now}).parentConversationId,'conversation-fixture-01');
console.log('CRM_PARENT_CONVERSATION_BINDING_PASS=PASS');
const general=make({domain:'general_memory',sourceSystem:'mira_legacy_memory',legacyId:'legacy-memory:'+'a'.repeat(64)+':0',sourceOrdinal:0});
assert.equal(validateProjectMapping({mapping:general,expectedDomain:'general_memory',expectedProjectId:'project-fixture-01',expectedSourceFileDigest:'a'.repeat(64),verifyApproval:verifier,now}).legacyId,general.legacyId);
console.log('GENERAL_MEMORY_SNAPSHOT_ORDINAL_LOCATOR_PASS=PASS');
assert.throws(()=>validateProjectMapping({mapping:make({domain:'work_learning',sourceSystem:'mira_work_learning'}),verifyApproval:verifier,now}),/Domain contract is not implemented/);
console.log('UNREVIEWED_DOMAIN_MAPPING_BLOCKED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PHASE3_PROJECT_MAPPING_CONTRACT_PASS');
