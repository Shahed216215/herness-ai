'use strict';
const assert = require('node:assert/strict');
const { digest, buildMigrationCandidate, validateCandidateSet, planSnapshot } = require('../services/mira-hfm-migration-manifest');
const { digest: legacyAdapterDigest } = require('../services/mira-legacy-memory-knowledge-adapter');

assert.equal(digest({ b: 2, a: 1 }), legacyAdapterDigest({ b: 2, a: 1 }));
console.log('LEGACY_ADAPTER_SOURCE_DIGEST_COMPATIBLE=PASS');

const sourceFileDigest = 'a'.repeat(64);
const base = {
  domain: 'knowledge',
  entry: { id: 'kb_legacy_01', title: 'Title', content: 'Exact content', savedAt: '2026-11-04T00:00:00.000Z' },
  sourceFileDigest,
  sourceOrdinal: 0
};
const mapping = {
  domain: 'knowledge', legacyId: 'kb_legacy_01', canonicalMemoryId: 'memory-canonical-0001',
  projectId: 'project-approved-01', revision: 1, sourceDigest: digest(base.entry),
  sourceFileDigest, sourceOrdinal: 0, classification: 'PROJECT_PRIVATE', approvalReference: 'ARCH-DECISION-REF-001'
};
const candidate = buildMigrationCandidate({ ...base, mapping });
assert.equal(candidate.status, 'READY_FOR_REVIEW');
assert.equal(candidate.writeAuthorized, false);
console.log('KNOWLEDGE_CANDIDATE_REQUIRES_REVIEW=PASS');

const noMap = buildMigrationCandidate({ ...base });
assert.equal(noMap.status, 'BLOCKED');
assert.ok(noMap.blockers.includes('EXPLICIT_MAPPING_MISSING'));
console.log('MISSING_MAPPING_FAILS_CLOSED=PASS');

// General Memory identity is bound to the source snapshot digest and array ordinal below.

const crmEntry = { messageId: 'crm-msg-001', conversationId: 'conv-001', content: 'hello' };
const crmMapping = {
  domain: 'crm_conversation_message', legacyId: crmEntry.messageId,
  canonicalMemoryId: 'memory-canonical-crm-001', projectId: 'project-approved-01',
  revision: 1, sourceDigest: digest(crmEntry), sourceFileDigest, sourceOrdinal: 1, classification: 'RESTRICTED',
  approvalReference: 'ARCH-DECISION-REF-002'
};
const crmNoParent = buildMigrationCandidate({
  domain: 'crm_conversation_message', entry: crmEntry, sourceFileDigest, sourceOrdinal: 1, mapping: crmMapping
});
assert.ok(crmNoParent.blockers.includes('CRM_APPROVED_CONVERSATION_PROJECT_MAPPING_REQUIRED'));
console.log('CRM_APPROVED_PROJECT_MAPPING_REQUIRED=PASS');

const crm = buildMigrationCandidate({
  domain: 'crm_conversation_message', entry: crmEntry, sourceFileDigest, sourceOrdinal: 1,
  mapping: crmMapping, parentConversation: { conversationId: 'conv-001', projectId: 'project-approved-01', mappingStatus: 'APPROVED', approvalReference: 'CRM-PROJECT-MAP-001' }
});
assert.equal(crm.status, 'READY_FOR_REVIEW');
console.log('CRM_EXPLICIT_PARENT_AND_PROJECT_MAPPING=PASS');

const wrongProject = buildMigrationCandidate({
  ...base, mapping: { ...mapping, projectId: '' }
});
assert.ok(wrongProject.blockers.includes('AUTHORITATIVE_PROJECT_ID_REQUIRED'));
console.log('MISSING_PROJECT_SCOPE_BLOCKED=PASS');

const wrongDigest = buildMigrationCandidate({
  ...base, mapping: { ...mapping, sourceDigest: '0'.repeat(64) }
});
assert.ok(wrongDigest.blockers.includes('SOURCE_DIGEST_MISMATCH'));
console.log('SOURCE_DIGEST_MISMATCH_BLOCKED=PASS');

const badClass = buildMigrationCandidate({
  ...base, mapping: { ...mapping, classification: 'UNKNOWN' }
});
assert.ok(badClass.blockers.includes('EXPLICIT_CLASSIFICATION_REQUIRED'));
console.log('UNKNOWN_CLASSIFICATION_BLOCKED=PASS');

const badRevision = buildMigrationCandidate({
  ...base, mapping: { ...mapping, revision: 2 }
});
assert.ok(badRevision.blockers.includes('INITIAL_REVISION_MUST_BE_1'));
console.log('FABRICATED_HISTORICAL_REVISION_BLOCKED=PASS');

assert.equal(validateCandidateSet([candidate]).ok, true);
console.log('SINGLE_REVIEW_CANDIDATE_ACCEPTED=PASS');

const duplicate = { ...candidate, canonicalMemoryId: candidate.canonicalMemoryId + '-2' };
assert.ok(validateCandidateSet([candidate, duplicate]).blockers.some(x => x.startsWith('DUPLICATE_LEGACY_ID:')));
console.log('DUPLICATE_LEGACY_ID_REJECTED=PASS');

const collision = { ...candidate, legacyId: 'kb_legacy_02' };
assert.ok(validateCandidateSet([candidate, collision]).blockers.some(x => x.startsWith('DUPLICATE_CANONICAL_MEMORY_ID:')));
console.log('CANONICAL_ID_COLLISION_REJECTED=PASS');

assert.ok(validateCandidateSet([candidate, { ...candidate, writeAuthorized: true }]).blockers.length > 0);
console.log('WRITE_AUTHORIZATION_CANNOT_BE_ENABLED=PASS');

assert.throws(() => buildMigrationCandidate({ ...base, sourceOrdinal: -1, mapping }));
console.log('INVALID_SOURCE_ORDINAL_REJECTED=PASS');


const rawSnapshot = JSON.stringify([base.entry]);
const planned = planSnapshot({ domain: 'knowledge', sourceText: rawSnapshot, mappings: [mapping] });
assert.equal(planned.status, 'READY_FOR_REVIEW');
assert.equal(planned.writeAuthorized, false);
assert.equal(planned.sourceFileDigest, require('node:crypto').createHash('sha256').update(rawSnapshot, 'utf8').digest('hex'));
console.log('EXACT_SOURCE_SNAPSHOT_DIGEST_BOUND=PASS');

const changedSnapshot = JSON.stringify([{ ...base.entry, content: 'changed' }]);
const changedPlan = planSnapshot({ domain: 'knowledge', sourceText: changedSnapshot, mappings: [mapping] });
assert.equal(changedPlan.status, 'BLOCKED');
assert.ok(changedPlan.blockers.some(x => x.includes('SOURCE_DIGEST_MISMATCH')));
console.log('SOURCE_SNAPSHOT_CHANGE_INVALIDATES_MAPPING=PASS');
const appendedSnapshot = JSON.stringify([base.entry, { id: 'kb-unrelated', title: 'Unrelated', content: 'other' }]);
const appendedPlan = planSnapshot({ domain: 'knowledge', sourceText: appendedSnapshot, mappings: [mapping] });
assert.equal(appendedPlan.status, 'BLOCKED');
assert.ok(appendedPlan.blockers.some(x => x.includes('SOURCE_SNAPSHOT_LOCATOR_MISMATCH')));
console.log('UNRELATED_SNAPSHOT_CHANGE_INVALIDATES_MANIFEST=PASS');

assert.throws(() => planSnapshot({ domain: 'knowledge', sourceText: '{bad json', mappings: [] }), /valid JSON/);
console.log('INVALID_SOURCE_SNAPSHOT_REJECTED=PASS');

const duplicatedMappings = planSnapshot({
  domain: 'knowledge', sourceText: rawSnapshot, mappings: [mapping, mapping]
});
assert.equal(duplicatedMappings.status, 'BLOCKED');
assert.ok(duplicatedMappings.blockers.some(x => x.startsWith('DUPLICATE_MAPPING:')));
console.log('DUPLICATE_SNAPSHOT_MAPPING_REJECTED=PASS');

const generalEntry = { role: 'user', content: 'no id', time: '2026-11-04T00:00:00Z' };
const generalRaw = JSON.stringify([generalEntry]);
const generalSourceFileDigest = require('node:crypto').createHash('sha256').update(generalRaw, 'utf8').digest('hex');
const generalLegacyId = 'legacy-memory:' + generalSourceFileDigest + ':0';
const generalMapping = {
  domain: 'general_memory', legacyId: generalLegacyId,
  canonicalMemoryId: 'memory-canonical-general-001', projectId: 'project-approved-01',
  revision: 1, sourceDigest: digest(generalEntry), sourceFileDigest: generalSourceFileDigest, sourceOrdinal: 0, classification: 'PROJECT_PRIVATE',
  approvalReference: 'ARCH-DECISION-REF-GENERAL'
};
const generalPlan = planSnapshot({ domain: 'general_memory', sourceText: generalRaw, mappings: [generalMapping] });
assert.equal(generalPlan.status, 'READY_FOR_REVIEW');
assert.equal(generalPlan.candidates[0].identityLocator, 'SOURCE_FILE_DIGEST_AND_ORDINAL');
assert.equal(generalPlan.writeAuthorized, false);
console.log('GENERAL_MEMORY_SNAPSHOT_SIDECAR_IDENTITY_READY_FOR_REVIEW=PASS');

const generalMissing = planSnapshot({ domain: 'general_memory', sourceText: generalRaw, mappings: [] });
assert.equal(generalMissing.status, 'BLOCKED');
console.log('GENERAL_MEMORY_MISSING_SIDECAR_MAPPING_BLOCKED=PASS');

const crmRaw = JSON.stringify([{ messageId: 'crm-msg-001', conversationId: 'conv-001', content: 'hello' }]);
const crmPlan = planSnapshot({
  domain: 'crm_conversation_message', sourceText: crmRaw, mappings: [crmMapping],
  parentConversations: { 'conv-001': { conversationId: 'conv-001', projectId: 'project-approved-01', mappingStatus: 'APPROVED', approvalReference: 'CRM-PROJECT-MAP-001' } }
});
assert.equal(crmPlan.status, 'READY_FOR_REVIEW');
console.log('CRM_SNAPSHOT_PARENT_MAPPING_VERIFIED=PASS');

const extraMapping = { ...mapping, legacyId: 'kb_unused_01' };
const unusedPlan = planSnapshot({ domain: 'knowledge', sourceText: rawSnapshot, mappings: [mapping, extraMapping] });
assert.equal(unusedPlan.status, 'BLOCKED');
assert.ok(unusedPlan.blockers.some(x => x.startsWith('UNUSED_MAPPING:')));
console.log('UNUSED_MAPPING_REJECTED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_DRY_RUN_MANIFEST_PLANNER_ISOLATED_PASS');
