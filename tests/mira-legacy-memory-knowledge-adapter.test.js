'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { adaptLegacyEntry, adaptLegacyEntries, filterAdaptedLegacyEntries, digest } = require('../services/mira-legacy-memory-knowledge-adapter');

function makeCanonical(legacyId, content, memoryId = 'memory-0001') {
  return {
    schemaVersion:'1.0.0', memoryId, projectId:'project-alpha', recordType:'knowledge', content,
    source:{sourceType:'legacy_import',sourceId:legacyId,sourceUrl:null,observedAt:'2026-11-04T00:00:00.000Z'},
    timestamps:{createdAt:'2026-11-04T00:00:00.000Z',updatedAt:'2026-11-04T00:00:00.000Z'},
    version:{revision:1,contentHash:crypto.createHash('sha256').update(JSON.stringify(content),'utf8').digest('hex')},
    integrity:{status:'VERIFIED',algorithm:'SHA-256'},trust:{status:'SOURCE_RECORDED'},
    access:{classification:'PROJECT_PRIVATE',allowedProjectIds:['project-alpha']},lifecycle:'ACTIVE'
  };
}
function mapping(domain, entry) {
  const id = domain === 'knowledge' ? entry.id : entry.messageId;
  return {domain,projectId:'project-alpha',legacyId:id,memoryId:'memory-0001',revision:1,sourceDigest:digest(entry),canonicalRecord:makeCanonical(id,entry.content)};
}
const entry={id:'kb_legacy_01',title:'Legacy',content:'preserved content',savedAt:'2026-11-04T00:00:00.000Z'};
const m=mapping('knowledge',entry);
const adapted=adaptLegacyEntry({domain:'knowledge',entry,mapping:m,projectId:'project-alpha'});
assert.equal(adapted.memoryId,'memory-0001');
console.log('EXPLICIT_KNOWLEDGE_IDENTITY_MAPPING=PASS');
assert.throws(()=>adaptLegacyEntry({domain:'knowledge',entry,mapping:{...m,sourceDigest:'0'.repeat(64)},projectId:'project-alpha'}),/source digest mismatch/);
console.log('STALE_SOURCE_DIGEST_REJECTED=PASS');
assert.throws(()=>adaptLegacyEntry({domain:'knowledge',entry,mapping:m,projectId:''}),/projectId/);
console.log('MISSING_PROJECT_SCOPE_REJECTED=PASS');
const oldMessage={role:'user',content:'preserved content',time:'2026-11-04T00:00:00.000Z'};
assert.throws(()=>adaptLegacyEntries({domain:'conversation_memory',entries:[oldMessage],mappings:[],projectId:'project-alpha'}),/no stable immutable identity/);
console.log('LEGACY_MESSAGE_WITHOUT_STABLE_ID_FAILS_CLOSED=PASS');
const message={messageId:'msg_immutable_01',role:'user',content:'preserved content',time:'2026-11-04T00:00:00.000Z'};
const mm=mapping('conversation_memory',message);
assert.equal(adaptLegacyEntries({domain:'conversation_memory',entries:[message],mappings:[mm],projectId:'project-alpha'})[0].legacyId,'msg_immutable_01');
console.log('EXPLICIT_CONVERSATION_MESSAGE_ID_MAPPING=PASS');
assert.throws(()=>adaptLegacyEntries({domain:'knowledge',entries:[entry],mappings:[m,m],projectId:'project-alpha'}),/duplicate legacy identity mapping/);
console.log('DUPLICATE_MAPPING_REJECTED=PASS');
assert.throws(()=>adaptLegacyEntry({domain:'knowledge',entry,mapping:{...m,projectId:'project-beta'},projectId:'project-alpha'}),/project scope mismatch/);
console.log('CROSS_PROJECT_MAPPING_REJECTED=PASS');
assert.deepEqual(filterAdaptedLegacyEntries({adaptedEntries:[adapted],pendingConflicts:[{projectId:'project-alpha',status:'QUARANTINED',originalMemoryIds:['memory-0001']}],projectId:'project-alpha'}),[]);
console.log('QUARANTINED_RECORD_EXCLUDED=PASS');
assert.equal(filterAdaptedLegacyEntries({adaptedEntries:[adapted],pendingConflicts:[{projectId:'project-beta',status:'QUARANTINED',originalMemoryIds:['memory-0001']}],projectId:'project-alpha'}).length,1);
console.log('CROSS_PROJECT_CONFLICT_ISOLATION=PASS');
assert.throws(()=>filterAdaptedLegacyEntries({adaptedEntries:[adapted],pendingConflicts:[],projectId:'project-beta'}),/Cross-project/);
console.log('ADAPTER_SCOPE_ENFORCED=PASS');
const tampered={...m,canonicalRecord:{...m.canonicalRecord,content:'tampered'}};
assert.throws(()=>adaptLegacyEntry({domain:'knowledge',entry,mapping:tampered,projectId:'project-alpha'}),/contentHash/);
console.log('CANONICAL_HASH_TAMPER_REJECTED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_LEGACY_MEMORY_KNOWLEDGE_ADAPTER_ISOLATED_PASS');
