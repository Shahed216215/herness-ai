'use strict';
const assert=require('node:assert/strict');
const {createCanonicalCandidate,adaptLegacyRecord,sourceDigestFor}=require('../services/mira-memory-domain-payload-adapter');
const {digest,bodyOf}=require('../services/mira-memory-project-mapping-contract');
const now=new Date('2026-11-04T12:00:00.000Z');
const capturedAt='2026-11-04T11:59:00.000Z';
const sourceFileDigest='a'.repeat(64);
const verifier=e=>e.approvalReference==='APPROVAL-FIXTURE'&&e.approvedBy==='human-fixture';
function fixture(domain,sourceEntry,extra={}){
 const parent=domain==='crm_conversation_message'?sourceEntry.conversationId:null;
 const mapping={
  schemaVersion:'1.0.0',mappingId:'mapping-'+domain,domain,
  sourceSystem:({
   general_memory:'mira_legacy_memory',knowledge:'mira_legacy_knowledge',
   crm_conversation_message:'mira_crm_conversation'
  })[domain],
  sourceFileDigest,sourceOrdinal:domain==='crm_conversation_message'?null:0,
  legacyId:domain==='general_memory'?'legacy-memory:'+sourceFileDigest+':0':
   domain==='knowledge'?sourceEntry.id:sourceEntry.messageId,
  memoryId:'canonical-'+domain,projectId:'project-fixture-01',
  parentConversationId:parent,clientId:domain==='crm_conversation_message'?sourceEntry.clientId:null,revision:1,
  sourceDigest:sourceDigestFor(domain,sourceEntry,parent),
  canonicalRecordDigest:'0'.repeat(64),classification:'PROJECT_PRIVATE',
  status:'APPROVED',approvalReference:'APPROVAL-FIXTURE',approvedBy:'human-fixture',
  approvedAt:'2026-11-04T11:58:00.000Z',createdAt:'2026-11-04T11:57:00.000Z',
  mappingDigest:''
 };
 Object.assign(mapping,extra);
 const candidate=createCanonicalCandidate({domain,sourceEntry,mapping,capturedAt});
 mapping.canonicalRecordDigest=digest(candidate);
 mapping.mappingDigest=digest(bodyOf(mapping));
 return {mapping,candidate};
}
const cases=[
 ['general_memory',{role:'assistant',content:'full general memory payload',time:'2026-11-04T10:00:00.000Z'}],
 ['knowledge',{id:'kb_fixture_001',title:'A knowledge title',url:'https://example.invalid/reference',content:'full knowledge payload',topic:'research',savedAt:'2026-11-04T10:30:00.000Z'}],
 ['crm_conversation_message',{messageId:'crm-message-001',conversationId:'conversation-001',clientId:'client-001',participant:'client',direction:'incoming',status:'received',content:'full CRM message',source:'manual',externalMessageId:null,createdAt:'2026-11-04T10:45:00.000Z',updatedAt:'2026-11-04T10:45:00.000Z'}]
];
for(const [domain,sourceEntry] of cases){
 const {mapping,candidate}=fixture(domain,sourceEntry);
 const result=adaptLegacyRecord({domain,sourceEntry,mapping,expectedProjectId:mapping.projectId,expectedSourceFileDigest:sourceFileDigest,capturedAt,verifyApproval:verifier,now});
 assert.equal(result.status,'READY_FOR_REVIEW_NOT_COMMITTED');
 assert.equal(result.committed,false);
 assert.equal(result.record.integrity.status,'UNVERIFIED');
 assert.equal(result.record.trust.status,'SOURCE_RECORDED');
 assert.equal(result.record.lifecycle,'PENDING_REVIEW');
 assert.equal(Object.isFrozen(result.record.source),true);
 assert.equal(Object.isFrozen(result.record.version),true);
 assert.equal(Object.isFrozen(result.record.access.allowedProjectIds),true);
 assert.throws(()=>{result.record.access.allowedProjectIds.push('project-other');},TypeError);
 assert.throws(()=>{result.record.source.sourceId='tampered';},TypeError);
 const envelope=JSON.parse(result.record.content);
 assert.equal(envelope.domain,domain);
 assert.deepEqual(envelope.payload,sourceEntry);
 assert.equal(result.canonicalRecordDigest,digest(candidate));
 console.log(domain.toUpperCase()+'_LOSSLESS_CANDIDATE_PASS=PASS');
}
const g=cases[0];
const scopeFixture=fixture(g[0],g[1]);
assert.throws(()=>adaptLegacyRecord({domain:g[0],sourceEntry:g[1],mapping:scopeFixture.mapping,expectedProjectId:'project-other',expectedSourceFileDigest:sourceFileDigest,capturedAt,verifyApproval:verifier,now}),/independently requested project/);
console.log('INDEPENDENT_PROJECT_SCOPE_ENFORCED=PASS');
assert.throws(()=>adaptLegacyRecord({domain:g[0],sourceEntry:g[1],mapping:scopeFixture.mapping,expectedProjectId:scopeFixture.mapping.projectId,capturedAt,verifyApproval:verifier,now}),/Expected source snapshot SHA-256 is required/);
console.log('MISSING_SOURCE_SNAPSHOT_REJECTED=PASS');
assert.throws(()=>adaptLegacyRecord({domain:g[0],sourceEntry:g[1],mapping:scopeFixture.mapping,expectedProjectId:scopeFixture.mapping.projectId,expectedSourceFileDigest:sourceFileDigest,capturedAt:'2026-11-04T12:01:00.000Z',verifyApproval:verifier,now}),/capture time is invalid or future-dated/);
console.log('FUTURE_CAPTURE_TIME_REJECTED=PASS');
const gm=fixture(g[0],g[1]).mapping;
assert.throws(()=>adaptLegacyRecord({domain:g[0],sourceEntry:{...g[1],content:'tampered'},mapping:gm,expectedProjectId:gm.projectId,expectedSourceFileDigest:sourceFileDigest,capturedAt,verifyApproval:verifier,now}),/Source digest mismatch/);
console.log('SOURCE_TAMPER_REJECTED=PASS');
const crm=cases[2];
const crmMap=fixture(crm[0],crm[1]).mapping;
assert.throws(()=>adaptLegacyRecord({domain:crm[0],sourceEntry:{...crm[1],conversationId:'other-conversation'},mapping:crmMap,expectedProjectId:crmMap.projectId,expectedSourceFileDigest:sourceFileDigest,capturedAt,verifyApproval:verifier,now}),/Source digest mismatch/);
console.log('CRM_PARENT_CONVERSATION_SUBSTITUTION_REJECTED=PASS');
assert.throws(()=>adaptLegacyRecord({domain:crm[0],sourceEntry:{...crm[1],clientId:'other-client'},mapping:crmMap,expectedProjectId:crmMap.projectId,expectedSourceFileDigest:sourceFileDigest,capturedAt,verifyApproval:verifier,now}),/Source digest mismatch/);
console.log('CRM_CLIENT_ID_SUBSTITUTION_REJECTED=PASS');
const wrongClientMapping={...crmMap,clientId:'other-client'};
wrongClientMapping.mappingDigest=digest(bodyOf(wrongClientMapping));
assert.throws(()=>adaptLegacyRecord({domain:crm[0],sourceEntry:crm[1],mapping:wrongClientMapping,expectedProjectId:wrongClientMapping.projectId,expectedSourceFileDigest:sourceFileDigest,capturedAt,verifyApproval:verifier,now}),/CRM message\/parent conversation\/client mapping mismatch/);
console.log('APPROVED_CRM_MAPPING_CLIENT_MISMATCH_REJECTED=PASS');
const kb=cases[1];
const kbMap=fixture(kb[0],kb[1]).mapping;
assert.throws(()=>adaptLegacyRecord({domain:kb[0],sourceEntry:{...kb[1],id:'kb-other'},mapping:kbMap,expectedProjectId:kbMap.projectId,expectedSourceFileDigest:sourceFileDigest,capturedAt,verifyApproval:verifier,now}),/Source digest mismatch/);
console.log('KNOWLEDGE_LEGACY_ID_SUBSTITUTION_REJECTED=PASS');
const pending=fixture(g[0],g[1]).mapping;
pending.status='PENDING_REVIEW';
pending.mappingDigest=digest(bodyOf(pending));
assert.throws(()=>adaptLegacyRecord({domain:g[0],sourceEntry:g[1],mapping:pending,expectedProjectId:pending.projectId,expectedSourceFileDigest:sourceFileDigest,capturedAt,verifyApproval:verifier,now}),/not approved/);
console.log('UNAPPROVED_MAPPING_REJECTED=PASS');
assert.throws(()=>createCanonicalCandidate({domain:'work_learning',sourceEntry:{},mapping:{},capturedAt}),/Domain\/source-system mapping mismatch|Domain adapter is not implemented/);
console.log('UNREVIEWED_DOMAIN_ADAPTER_BLOCKED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_DOMAIN_PAYLOAD_ADAPTER_PASS');
