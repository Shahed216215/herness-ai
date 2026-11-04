'use strict';
const assert=require('node:assert/strict');
const {classifySource}=require('../scripts/mira-hfm-access-path-inventory');
const sample=[
 "const memory=loadMemory();",
 "const knowledge=loadKnowledge();",
 "const crm=listMessages(conversationId);",
 "const lessons=listLessons({});",
 "const experience=retrieveExperiences(text);",
 "const state=loadDriveState('knowledge');",
 "const raw=loadStore();",
 "// getKnowledge() is only a comment",
 "const unrelated=calculateHash(value);"
].join('\n');
const result=classifySource('fixture/memory-boundary.js',sample);
for(const category of ['DIRECT_STORE_READ','CRM_CONVERSATION_READ','WORK_LEARNING_OR_EXPERIENCE_READ','PROVIDER_OR_SNAPSHOT_READ']){
 assert.ok(result.matches.some(x=>x.category===category),category+' must be detected');
}
assert.equal(result.matches.some(x=>x.excerpt.includes('getKnowledge() is only a comment')),false);
assert.equal(result.matches.some(x=>x.excerpt.includes('calculateHash')),false);
assert.ok(result.matches.some(x=>x.category==='GENERIC_STORE_LOADER'&&x.excerpt.includes('loadStore')));
assert.equal(result.matches.some(x=>x.category==='CRM_CONVERSATION_READ'&&x.excerpt.includes('loadStore')),false);
console.log('DIRECT_STORE_AND_DERIVED_DOMAIN_ACCESS_DETECTED=PASS');
console.log('COMMENT_AND_UNRELATED_CALLS_EXCLUDED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_ACCESS_PATH_INVENTORY_TEST_PASS');
