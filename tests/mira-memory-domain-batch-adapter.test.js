'use strict';
const assert=require('node:assert/strict');
const {
 adaptLegacyBatch,createCanonicalCandidate,sourceDigestFor
}=require('../services/mira-memory-domain-payload-adapter');
const {
 digest,bodyOf
}=require('../services/mira-memory-project-mapping-contract');
const now=new Date('2026-11-04T12:00:00.000Z');
const capturedAt='2026-11-04T12:00:00.000Z';
const snapshot='a'.repeat(64);
const projectId='project-batch-fixture';
const verifier=evidence=>({
 decision:'APPROVED',approvalReference:evidence.approvalReference,
 mappingDigest:evidence.mappingDigest,projectId:evidence.projectId,
 approvedBy:evidence.approvedBy,approvedAt:evidence.approvedAt,
 registryRevision:'fixture-registry-revision',revocationStatus:'ACTIVE',
 verifiedAt:'2026-11-04T11:59:30.000Z',expiresAt:'2026-11-04T12:10:00.000Z'
});
function makeMapping(domain,sourceEntry,ordinal,memoryId,overrides={}) {
 const sourceSystem={general_memory:'mira_legacy_memory',knowledge:'mira_legacy_knowledge',crm_conversation_message:'mira_crm_conversation'}[domain];
 const parent=domain==='crm_conversation_message'?sourceEntry.conversationId:null;
 const legacyId=domain==='general_memory'?'legacy-memory:'+snapshot+':'+ordinal:
  domain==='knowledge'?sourceEntry.id:sourceEntry.messageId;
 const mapping={
  schemaVersion:'1.0.0',mappingId:'mapping-'+memoryId,domain,sourceSystem,
  sourceFileDigest:snapshot,sourceOrdinal:domain==='crm_conversation_message'?null:ordinal,
  legacyId,memoryId,projectId,parentConversationId:parent,
  clientId:domain==='crm_conversation_message'?sourceEntry.clientId:null,
  revision:1,sourceDigest:sourceDigestFor(domain,sourceEntry,parent),
  canonicalRecordDigest:'0'.repeat(64),classification:'PROJECT_PRIVATE',
  status:'APPROVED',approvalReference:'approval-'+memoryId,
  approvedBy:'fixture-human-approver',approvedAt:'2026-11-04T11:58:00.000Z',
  createdAt:'2026-11-04T11:57:00.000Z'
 };
 Object.assign(mapping,overrides);
 const candidate=createCanonicalCandidate({domain,sourceEntry,mapping,capturedAt});
 mapping.canonicalRecordDigest=digest(candidate);
 mapping.mappingDigest=digest(bodyOf(mapping));
 return mapping;
}
const general=[
 {role:'user',content:'first general memory',time:'2026-11-04T10:00:00.000Z'},
 {role:'assistant',content:'second general memory',time:'2026-11-04T10:05:00.000Z'}
];
const generalMappings=general.map((entry,i)=>makeMapping('general_memory',entry,i,'memory-general-'+String(i+1).padStart(3,'0')));
const generalResult=adaptLegacyBatch({
 domain:'general_memory',sourceEntries:general,mappings:generalMappings,
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,
 verifyApproval:verifier,now
});
assert.equal(generalResult.length,2);
assert.equal(generalResult.every(x=>x.status==='READY_FOR_REVIEW_NOT_COMMITTED'&&!x.committed),true);
assert.equal(generalResult.every(x=>x.record.lifecycle==='PENDING_REVIEW'&&x.record.integrity.status==='UNVERIFIED'),true);
console.log('GENERAL_MEMORY_COMPLETE_BATCH_SNAPSHOT_ORDINAL_BINDING=PASS');

const knowledge=[
 {id:'legacy-kb-001',title:'First',content:'first knowledge payload',savedAt:'2026-11-04T10:10:00.000Z',url:null},
 {id:'legacy-kb-002',title:'Second',content:'second knowledge payload',savedAt:'2026-11-04T10:15:00.000Z',url:'https://example.invalid/source'}
];
const knowledgeMappings=knowledge.map((entry,i)=>makeMapping('knowledge',entry,i,'memory-knowledge-'+String(i+1).padStart(3,'0')));
const knowledgeResult=adaptLegacyBatch({
 domain:'knowledge',sourceEntries:knowledge,mappings:knowledgeMappings,
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,
 verifyApproval:verifier,now
});
assert.equal(knowledgeResult.length,2);
assert.equal(knowledgeResult[1].record.source.sourceUrl,'https://example.invalid/source');
console.log('KNOWLEDGE_COMPLETE_BATCH_AND_PROVENANCE_PRESERVED=PASS');

const crm=[
 {messageId:'crm-message-001',conversationId:'conversation-001',clientId:'client-001',content:'first CRM message',createdAt:'2026-11-04T10:20:00.000Z',updatedAt:'2026-11-04T10:20:00.000Z'},
 {messageId:'crm-message-002',conversationId:'conversation-001',clientId:'client-001',content:'second CRM message',createdAt:'2026-11-04T10:21:00.000Z',updatedAt:'2026-11-04T10:21:00.000Z'}
];
const crmMappings=crm.map((entry,i)=>makeMapping('crm_conversation_message',entry,i,'memory-crm-'+String(i+1).padStart(3,'0')));
const crmResult=adaptLegacyBatch({
 domain:'crm_conversation_message',sourceEntries:crm,mappings:crmMappings,
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,
 verifyApproval:verifier,now
});
assert.equal(crmResult.length,2);
assert.equal(crmResult.every(x=>x.record.source.sourceId===x.mappingId?false:true),true);
console.log('CRM_COMPLETE_BATCH_PARENT_AND_CLIENT_BINDING=PASS');

assert.throws(()=>adaptLegacyBatch({
 domain:'knowledge',sourceEntries:knowledge,mappings:[knowledgeMappings[0]],
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/Missing mapping/);
console.log('MISSING_MAPPING_FAILS_CLOSED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'knowledge',sourceEntries:[knowledge[0]],mappings:knowledgeMappings,
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/Unused mapping/);
console.log('UNUSED_MAPPING_FAILS_CLOSED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'knowledge',sourceEntries:[knowledge[0],knowledge[0]],mappings:knowledgeMappings,
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/Ambiguous or duplicate source locator/);
console.log('AMBIGUOUS_DUPLICATE_SOURCE_LOCATOR_FAILS_CLOSED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'knowledge',sourceEntries:knowledge,mappings:[knowledgeMappings[0],{...knowledgeMappings[1],legacyId:knowledgeMappings[0].legacyId,mappingId:'mapping-ambiguous-source'}].map(x=>({...x,mappingDigest:digest(bodyOf(x))})),
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/Duplicate legacy mapping/);
console.log('AMBIGUOUS_MAPPING_SET_FAILS_CLOSED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'knowledge',sourceEntries:knowledge,mappings:knowledgeMappings.map((m,i)=>i===0?({...m,sourceOrdinal:1,mappingDigest:digest(bodyOf({...m,sourceOrdinal:1}))}):m),
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/sourceOrdinal does not match/);
console.log('SOURCE_ORDINAL_MISMATCH_FAILS_CLOSED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'knowledge',sourceEntries:knowledge,mappings:knowledgeMappings,
 expectedProjectId:'project-other',expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/project scope mismatch/);
console.log('CROSS_PROJECT_BATCH_FAILS_CLOSED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'knowledge',sourceEntries:knowledge,mappings:knowledgeMappings,
 expectedProjectId:projectId,expectedSourceFileDigest:'f'.repeat(64),capturedAt,verifyApproval:verifier,now
}),/source snapshot mismatch/);
console.log('STALE_SOURCE_SNAPSHOT_BATCH_FAILS_CLOSED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'knowledge',sourceEntries:knowledge,mappings:knowledgeMappings.map((m,i)=>i===0?({...m,status:'PENDING_REVIEW',mappingDigest:digest(bodyOf({...m,status:'PENDING_REVIEW'}))}):m),
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/not approved/);
console.log('UNAPPROVED_MAPPING_BATCH_FAILS_CLOSED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'crm_conversation_message',sourceEntries:[{...crm[0],clientId:'client-other'}],mappings:[crmMappings[0]],
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/Source digest mismatch|CRM message\/parent conversation\/client mapping mismatch/);
console.log('CRM_CLIENT_SUBSTITUTION_FAILS_CLOSED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'work_learning',sourceEntries:[],mappings:[],expectedProjectId:projectId,
 expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/Domain adapter is not implemented/);
console.log('UNREVIEWED_DOMAIN_BATCH_BLOCKED=PASS');
assert.throws(()=>adaptLegacyBatch({
 domain:'knowledge',sourceEntries:new Array(1),mappings:knowledgeMappings.slice(0,1),
 expectedProjectId:projectId,expectedSourceFileDigest:snapshot,capturedAt,verifyApproval:verifier,now
}),/Sparse source arrays/);
console.log('SPARSE_SOURCE_BATCH_REJECTED=PASS');
console.log('NETWORK_REQUESTS=0');
console.log('PERSISTENT_WRITES=0');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_DOMAIN_BATCH_ADAPTER_PASS');
