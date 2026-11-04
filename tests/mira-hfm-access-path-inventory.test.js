'use strict';
const assert=require('node:assert/strict');
const {classifySource,scan}=require('../scripts/mira-hfm-access-path-inventory');
const sample=[
 "const memory=loadMemory();",
 "const knowledge=loadKnowledge();",
 "const crm=listMessages(conversationId);",
 "const lessons=listLessons({});",
 "const experience=retrieveExperiences(text);",
 "const workKnowledge=getConsolidatedKnowledge();",
 "const state=loadDriveState('knowledge');",
 "const raw=loadStore();",
 "// getKnowledge() is only a comment",
 "const unrelated=calculateHash(value);"
].join('\n');
const result=classifySource('fixture/memory-boundary.js',sample);
for(const category of ['DIRECT_STORE_READ','CRM_CONVERSATION_READ','WORK_LEARNING_OR_EXPERIENCE_READ','WORK_KNOWLEDGE_READ','PROVIDER_OR_SNAPSHOT_READ']){
 assert.ok(result.matches.some(x=>x.category===category),category+' must be detected');
}
assert.equal(result.matches.some(x=>x.excerpt.includes('getKnowledge() is only a comment')),false);
assert.equal(result.matches.some(x=>x.excerpt.includes('calculateHash')),false);
assert.ok(result.matches.some(x=>x.category==='GENERIC_STORE_LOADER'&&x.excerpt.includes('loadStore')));
assert.equal(result.matches.some(x=>x.category==='CRM_CONVERSATION_READ'&&x.excerpt.includes('loadStore')),false);
console.log('DIRECT_STORE_AND_DERIVED_DOMAIN_ACCESS_DETECTED=PASS');
console.log('COMMENT_AND_UNRELATED_CALLS_EXCLUDED=PASS');
const aliasSample=[
 "const { getMemory: readMemory } = require('../memory');",
 "const data = readMemory();",
 "import { listMessages as fetchMessages } from '../services/conversation-store.js';",
 "const messages = fetchMessages();",
 "const { getKnowledge } = require('../knowledge');",
 "const normal = getKnowledge();"
].join('\\n');
const aliasResult=classifySource('fixture/aliased-memory-boundary.js',aliasSample);
assert.equal(aliasResult.matches.filter(x=>x.category==='ALIASED_DOMAIN_READ').length,2);
assert.ok(aliasResult.matches.some(x=>x.excerpt.includes('getMemory as readMemory')));
assert.ok(aliasResult.matches.some(x=>x.excerpt.includes('listMessages as fetchMessages')));
assert.equal(aliasResult.matches.some(x=>x.category==='ALIASED_DOMAIN_READ'&&x.excerpt.includes('getKnowledge as getKnowledge')),false);
console.log('COMMONJS_AND_ESM_ALIASED_READS_DETECTED=PASS');
const namespaceSample=[
 "const memoryNamespace = require('../memory');",
 "const memory = memoryNamespace.getMemory();",
 "import * as conversationNamespace from '../conversation-store.js';",
 "const messages = conversationNamespace.listMessages();",
 "const learningNamespace = await import('../learning-store.js');",
 "const lessons = learningNamespace.listLessons();",
 "const unrelated = otherNamespace.getMemory();"
].join('\n');
const namespaceResult=classifySource('fixture/namespace-memory-boundary.js',namespaceSample);
assert.equal(namespaceResult.matches.filter(x=>x.category==='NAMESPACE_DOMAIN_READ').length,3);
assert.ok(namespaceResult.matches.some(x=>x.excerpt.includes('memoryNamespace.getMemory')));
assert.ok(namespaceResult.matches.some(x=>x.excerpt.includes('conversationNamespace.listMessages')));
assert.ok(namespaceResult.matches.some(x=>x.excerpt.includes('learningNamespace.listLessons')));
console.log('COMMONJS_ESM_AND_DYNAMIC_NAMESPACE_READS_DETECTED=PASS');
const directFileSample=[
 "const rawMemory = fs.readFileSync('data/memory.json', 'utf8');",
 "await fs.promises.readFile('knowledge.json', 'utf8');",
 "const stream = fs.createReadStream('data/conversations.json');",
 "const unrelated = fs.readFileSync('users.json', 'utf8');"
].join('\n');
const directFileResult=classifySource('fixture/direct-memory-file-io.js',directFileSample);
assert.equal(directFileResult.matches.filter(x=>x.category==='DIRECT_MEMORY_FILE_IO').length,3);
assert.equal(directFileResult.matches.some(x=>x.category==='DIRECT_MEMORY_FILE_IO'&&x.excerpt.includes('users.json')),false);
console.log('DIRECT_CANONICAL_MEMORY_FILE_READS_DETECTED=PASS');
const indirectPathSample=[
 "const MEMORY_FILE = storagePath('memory.json');",
 "const raw = fs.readFileSync(MEMORY_FILE, 'utf8');",
 "const unrelated = fs.readFileSync('users.json', 'utf8');"
].join('\n');
const indirectPathResult=classifySource('fixture/indirect-memory-file-io.js',indirectPathSample);
assert.equal(indirectPathResult.matches.filter(x=>x.category==='CANONICAL_STORE_FILE_BACKED_READ').length,1);
assert.ok(indirectPathResult.matches.some(x=>x.category==='CANONICAL_STORE_FILE_BACKED_READ'&&x.line===2));
console.log('CANONICAL_STORE_PATH_CONSTANT_READ_LINKED=PASS');
const repositoryInventory=scan(process.cwd());
const categoryCounts={PUBLIC_OR_INTERNAL_RETRIEVAL:0,DIRECT_STORE_READ:0,DIRECT_MEMORY_FILE_IO:0,GENERIC_STORE_LOADER:0,PROVIDER_OR_SNAPSHOT_READ:0,CRM_CONVERSATION_READ:0,WORK_LEARNING_OR_EXPERIENCE_READ:0,WORK_KNOWLEDGE_READ:0,ALIASED_DOMAIN_READ:0,NAMESPACE_DOMAIN_READ:0,CANONICAL_STORE_FILE_BACKED_READ:0};
for(const item of repositoryInventory) categoryCounts[item.category]=(categoryCounts[item.category]||0)+1;
assert.deepEqual(categoryCounts,{
 PUBLIC_OR_INTERNAL_RETRIEVAL:27,
 DIRECT_STORE_READ:27,
 DIRECT_MEMORY_FILE_IO:0,
 GENERIC_STORE_LOADER:91,
 PROVIDER_OR_SNAPSHOT_READ:36,
 CRM_CONVERSATION_READ:27,
 WORK_LEARNING_OR_EXPERIENCE_READ:28,
 WORK_KNOWLEDGE_READ:6,
 ALIASED_DOMAIN_READ:0,
 NAMESPACE_DOMAIN_READ:27,
 CANONICAL_STORE_FILE_BACKED_READ:3
},'repository access-path inventory drifted; review all new/removed candidates before updating baseline');
assert.equal(repositoryInventory.length,272,'repository lexical candidate total changed; semantic review required');
console.log('REPOSITORY_ACCESS_PATH_BASELINE_PINNED=PASS');
console.log('REPOSITORY_ACCESS_PATH_CANDIDATE_COUNT=272');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_ACCESS_PATH_INVENTORY_TEST_PASS');
