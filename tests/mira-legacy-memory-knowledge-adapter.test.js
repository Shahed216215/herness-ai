'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  adaptLegacyEntry, adaptLegacyEntries, filterAdaptedLegacyEntries,
  digest, serializeLegacyPayload, sourceLocator
} = require('../services/mira-legacy-memory-knowledge-adapter');

const sourceFileDigest = 'a'.repeat(64);
function makeCanonical(domain, legacyId, entry, memoryId = 'memory-0001', projectId = 'project-alpha', classification = 'PROJECT_PRIVATE') {
  const content = serializeLegacyPayload(domain, entry);
  return {
    schemaVersion: '1.0.0',
    memoryId,
    projectId,
    recordType: domain === 'knowledge' ? 'knowledge' : 'conversation_reference',
    content,
    source: {
      sourceType: 'legacy_import', sourceId: legacyId, sourceUrl: null,
      observedAt: '2026-11-04T00:00:00.000Z'
    },
    timestamps: {
      createdAt: '2026-11-04T00:00:00.000Z',
      updatedAt: '2026-11-04T00:00:00.000Z'
    },
    version: {
      revision: 1,
      contentHash: crypto.createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')
    },
    integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification, allowedProjectIds: [projectId] },
    lifecycle: 'PENDING_REVIEW'
  };
}
function mapping(domain, entry, sourceOrdinal = 0, memoryId = 'memory-0001', projectId = 'project-alpha', fileDigest = sourceFileDigest) {
  const legacyId = sourceLocator(domain, entry, fileDigest, sourceOrdinal);
  return {
    domain, projectId, legacyId, memoryId, revision: 1,
    sourceDigest: digest(entry), sourceFileDigest: fileDigest, sourceOrdinal,
    classification: 'PROJECT_PRIVATE', approvalReference: 'APPROVED-MAP-001',
    canonicalRecord: makeCanonical(domain, legacyId, entry, memoryId, projectId, 'PROJECT_PRIVATE')
  };
}

const general = {
  role: 'user', content: 'preserved content',
  time: '2026-11-04T00:00:00.000Z', sourceTag: 'legacy-import-extra-field'
};
const generalMapping = mapping('general_memory', general);
const adaptedGeneral = adaptLegacyEntry({
  domain: 'general_memory', entry: general, mapping: generalMapping,
  projectId: 'project-alpha', sourceFileDigest, sourceOrdinal: 0
});
assert.equal(adaptedGeneral.legacyId, 'legacy-memory:' + sourceFileDigest + ':0');
assert.deepEqual(JSON.parse(adaptedGeneral.canonicalRecord.content).record, general);
console.log('GENERAL_MEMORY_SNAPSHOT_SIDECAR_IDENTITY_PASS=PASS');
console.log('GENERAL_MEMORY_FULL_RECORD_PRESERVED=PASS');

assert.throws(() => adaptLegacyEntry({
  domain: 'general_memory', entry: general, mapping: generalMapping,
  projectId: 'project-alpha', sourceFileDigest: 'b'.repeat(64), sourceOrdinal: 0
}), /snapshot locator mismatch/);
console.log('CHANGED_SOURCE_SNAPSHOT_REJECTED=PASS');

assert.throws(() => adaptLegacyEntry({
  domain: 'general_memory', entry: general, mapping: generalMapping,
  projectId: '', sourceFileDigest, sourceOrdinal: 0
}), /projectId/);
console.log('MISSING_PROJECT_SCOPE_REJECTED=PASS');

const stale = { ...generalMapping, sourceDigest: '0'.repeat(64) };
assert.throws(() => adaptLegacyEntry({
  domain: 'general_memory', entry: general, mapping: stale,
  projectId: 'project-alpha', sourceFileDigest, sourceOrdinal: 0
}), /source digest mismatch/);
console.log('STALE_SOURCE_DIGEST_REJECTED=PASS');

assert.throws(() => adaptLegacyEntries({
  domain: 'general_memory', entries: [general], mappings: [],
  projectId: 'project-alpha', sourceFileDigest
}), /Explicit mapping missing/);
console.log('MISSING_GENERAL_MEMORY_MAPPING_FAILS_CLOSED=PASS');

const knowledge = {
  id: 'kb_legacy_01', title: 'Legacy', url: 'https://example.test',
  content: 'knowledge body', savedAt: '2026-11-04T00:00:00.000Z',
  metadata: { category: 'security' }
};
const knowledgeMapping = mapping('knowledge', knowledge);
const adaptedKnowledge = adaptLegacyEntry({
  domain: 'knowledge', entry: knowledge, mapping: knowledgeMapping,
  projectId: 'project-alpha', sourceFileDigest, sourceOrdinal: 0
});
assert.equal(adaptedKnowledge.legacyId, 'kb_legacy_01');
assert.deepEqual(JSON.parse(adaptedKnowledge.canonicalRecord.content).record, knowledge);
console.log('EXPLICIT_KNOWLEDGE_IDENTITY_MAPPING=PASS');
console.log('KNOWLEDGE_FULL_RECORD_PRESERVED=PASS');
assert.deepEqual(filterAdaptedLegacyEntries({
  adaptedEntries: [adaptedKnowledge], pendingConflicts: [], projectId: 'project-alpha'
}), []);
console.log('MIGRATION_PENDING_REVIEW_NOT_RETRIEVABLE=PASS');

const activeKnowledge = {
  ...adaptedKnowledge,
  canonicalRecord: {
    ...adaptedKnowledge.canonicalRecord,
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    lifecycle: 'ACTIVE'
  }
};

const crm = {
  messageId: 'crm-msg-001', conversationId: 'conv-001',
  clientId: 'client-001', participant: 'client', content: 'hello',
  createdAt: '2026-11-04T00:00:00.000Z'
};
const crmMapping = mapping('crm_conversation_message', crm);
assert.throws(() => adaptLegacyEntry({
  domain: 'crm_conversation_message', entry: crm, mapping: crmMapping,
  projectId: 'project-alpha', sourceFileDigest, sourceOrdinal: 0
}), /parent conversation identity is not verified/);
console.log('CRM_APPROVED_PROJECT_MAPPING_REQUIRED=PASS');
const adaptedCrm = adaptLegacyEntry({
  domain: 'crm_conversation_message', entry: crm, mapping: crmMapping,
  projectId: 'project-alpha', sourceFileDigest, sourceOrdinal: 0,
  parentConversation: { conversationId: 'conv-001', projectId: 'project-alpha', mappingStatus: 'APPROVED', approvalReference: 'CRM-PROJECT-MAP-001' }
});
assert.equal(adaptedCrm.legacyId, 'crm-msg-001');
console.log('CRM_EXPLICIT_PARENT_MAPPING_PASS=PASS');

assert.throws(() => adaptLegacyEntries({
  domain: 'knowledge', entries: [knowledge], mappings: [knowledgeMapping, knowledgeMapping],
  projectId: 'project-alpha', sourceFileDigest
}), /duplicate legacy identity mapping/);
console.log('DUPLICATE_MAPPING_REJECTED=PASS');

assert.throws(() => adaptLegacyEntry({
  domain: 'knowledge', entry: knowledge,
  mapping: { ...knowledgeMapping, projectId: 'project-beta' },
  projectId: 'project-alpha', sourceFileDigest, sourceOrdinal: 0
}), /project scope mismatch/);
console.log('CROSS_PROJECT_MAPPING_REJECTED=PASS');

assert.deepEqual(filterAdaptedLegacyEntries({
  adaptedEntries: [activeKnowledge],
  pendingConflicts: [{
    projectId: 'project-alpha', status: 'QUARANTINED',
    originalMemoryIds: ['memory-0001']
  }],
  projectId: 'project-alpha'
}), []);
console.log('QUARANTINED_RECORD_EXCLUDED=PASS');

assert.equal(filterAdaptedLegacyEntries({
  adaptedEntries: [activeKnowledge],
  pendingConflicts: [{
    projectId: 'project-beta', status: 'QUARANTINED',
    originalMemoryIds: ['memory-0001']
  }],
  projectId: 'project-alpha'
}).length, 1);
console.log('CROSS_PROJECT_CONFLICT_ISOLATION=PASS');

assert.throws(() => filterAdaptedLegacyEntries({
  adaptedEntries: [activeKnowledge], pendingConflicts: [], projectId: 'project-beta'
}), /Cross-project/);
console.log('ADAPTER_SCOPE_ENFORCED=PASS');

const tampered = {
  ...knowledgeMapping,
  canonicalRecord: { ...knowledgeMapping.canonicalRecord, content: 'tampered' }
};
assert.throws(() => adaptLegacyEntry({
  domain: 'knowledge', entry: knowledge, mapping: tampered,
  projectId: 'project-alpha', sourceFileDigest, sourceOrdinal: 0
}), /contentHash/);
console.log('CANONICAL_HASH_TAMPER_REJECTED=PASS');

const second = mapping('knowledge', { ...knowledge, id: 'kb_legacy_02' }, 1, 'memory-0002');
assert.throws(() => adaptLegacyEntries({
  domain: 'knowledge', entries: [knowledge, { ...knowledge, id: 'kb_legacy_02' }],
  mappings: [knowledgeMapping, { ...second, sourceOrdinal: 0 }],
  projectId: 'project-alpha', sourceFileDigest
}), /snapshot locator mismatch|sourceDigest mismatch/);
console.log('ORDINAL_AND_SOURCE_BINDING_ENFORCED=PASS');

console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_LEGACY_MEMORY_KNOWLEDGE_ADAPTER_SNAPSHOT_BOUND_PASS');
