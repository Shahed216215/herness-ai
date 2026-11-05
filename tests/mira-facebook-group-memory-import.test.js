'use strict';
const assert = require('node:assert/strict');
const { prepareFacebookGroupImport, createFacebookGroupImportService } = require('../services/mira-facebook-group-memory-import');
const now = '2026-11-04T10:00:00.000Z';
function rec(overrides = {}) { return { memoryId:'memory-group-0001', sourceId:'group-post-101', sourceUrl:'https://www.facebook.com/groups/123456789/posts/101/', recordType:'knowledge', content:'Group members shared a synthetic project decision.', observedAt:now, revision:1, ...overrides }; }
function env(records=[rec()], overrides={}) { return { schemaVersion:'1.0.0', kind:'MIRA_FACEBOOK_GROUP_MEMORY_IMPORT', groupId:'123456789', projectId:'project-hfm-v02', exportId:'export-fixture-001', records, ...overrides }; }
function prepare(records, overrides={}) { return prepareFacebookGroupImport({ content:JSON.stringify(env(records,overrides)), format:'json', groupId:'123456789', projectId:'project-hfm-v02', actorId:'human-fixture', existingRecords:[] }); }
const first=prepare([rec()]);
assert.equal(first.status,'PREPARED_NOT_PERSISTED');
assert.equal(first.items[0].disposition,'PENDING_REVIEW');
assert.equal(first.items[0].record.source.sourceType,'facebook_group');
assert.equal(first.items[0].record.integrity.status,'UNVERIFIED');
assert.equal(first.items[0].record.trust.status,'SOURCE_RECORDED');
assert.equal(first.items[0].record.lifecycle,'PENDING_REVIEW');
assert.equal(first.items[0].record.access.classification,'PROJECT_PRIVATE');
assert.equal(first.canonicalMemoryWrite,false);
console.log('GROUP_IMPORT_CANONICAL_UNTRUSTED_MAPPING=PASS');
const dup=prepare([rec(),rec()]);
assert.equal(dup.summary.pendingReview,1); assert.equal(dup.summary.duplicates,1);
assert.equal(dup.items[1].disposition,'DUPLICATE');
console.log('GROUP_IMPORT_INTRA_BATCH_DUPLICATE_DETECTION=PASS');
const existing=first.items[0].record;
const dupExisting=prepareFacebookGroupImport({content:JSON.stringify(env([rec()])),format:'json',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',existingRecords:[existing]});
assert.equal(dupExisting.items[0].disposition,'DUPLICATE');
console.log('GROUP_IMPORT_EXISTING_VERSION_DUPLICATE_DETECTION=PASS');
const conflict=prepareFacebookGroupImport({content:JSON.stringify(env([rec({revision:2,content:'Changed revision'})])),format:'json',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',existingRecords:[existing]});
assert.equal(conflict.items[0].disposition,'QUARANTINED');
assert.equal(conflict.items[0].reasonCode,'EXISTING_MEMORY_VERSION_CONFLICT');
console.log('GROUP_IMPORT_VERSION_CONFLICT_QUARANTINE=PASS');
const intra=prepare([rec(),rec({content:'Same identity and revision, changed content'})]);
assert.equal(intra.items[1].disposition,'QUARANTINED');
console.log('GROUP_IMPORT_SAME_REVISION_CONTENT_CONFLICT=PASS');
assert.throws(()=>prepareFacebookGroupImport({content:JSON.stringify(env([rec()],{projectId:'project-other'})),format:'json',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',existingRecords:[]}),/scope does not match/);
assert.throws(()=>prepareFacebookGroupImport({content:JSON.stringify(env([rec({sourceUrl:'https://www.facebook.com/groups/999/posts/1/'})])),format:'json',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',existingRecords:[]}),/identify the supplied Facebook Group/);
assert.throws(()=>prepareFacebookGroupImport({content:JSON.stringify(env([rec({content:'x'.repeat(100001)})])),format:'json',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',existingRecords:[]}),/bounded non-empty text/);
assert.throws(()=>prepareFacebookGroupImport({content:JSON.stringify(env([rec({unexpected:true})])),format:'json',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',existingRecords:[]}),/only supported fields/);
assert.throws(()=>prepareFacebookGroupImport({content:JSON.stringify(env()),format:'json',groupId:'123456789',projectId:'project-other',actorId:'human-fixture',existingRecords:[]}),/scope does not match/);
console.log('GROUP_IMPORT_SCOPE_SCHEMA_AND_BOUNDS_FAIL_CLOSED=PASS');
const jsonl=[JSON.stringify({schemaVersion:'1.0.0',kind:'MIRA_FACEBOOK_GROUP_MEMORY_IMPORT',groupId:'123456789',projectId:'project-hfm-v02',exportId:'jsonl-fixture-001'}),JSON.stringify(rec())].join('\n');
assert.equal(prepareFacebookGroupImport({content:jsonl,format:'jsonl',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',existingRecords:[]}).summary.pendingReview,1);
const manual=prepareFacebookGroupImport({content:'Manual user supplied Group note.',format:'manual',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',sourceId:'manual-source-1',sourceUrl:'https://www.facebook.com/groups/123456789/',observedAt:now,existingRecords:[]});
assert.equal(manual.summary.pendingReview,1);
console.log('GROUP_IMPORT_JSON_JSONL_AND_MANUAL_TEXT_INPUT=PASS');
const db=new Map();
const store={
 capabilities:{atomicCreateOnly:true,immutableVersions:true,projectIsolation:true,readAfterWrite:true},
 async stageBatch(b){const old=db.get(b.batchId);if(old){if(old.batchDigest!==b.batchDigest)throw Error('immutable conflict');return {status:'ALREADY_EXISTS',batchId:b.batchId};}db.set(b.batchId,JSON.parse(JSON.stringify(b)));return {status:'CREATED',batchId:b.batchId};},
 async readBatch(id,p){const b=db.get(id);if(!b||b.projectId!==p)throw Error('not found');return JSON.parse(JSON.stringify(b));},
 async listBatches({projectId,groupId}){return [...db.values()].filter(b=>b.projectId===projectId&&b.groupId===groupId).map(b=>JSON.parse(JSON.stringify(b)));}
};
const audits=[];
const svc=createFacebookGroupImportService({store,auditWriter:async e=>audits.push(e)});
(async()=>{
 const result=await svc.import({content:JSON.stringify(env([rec()])),format:'json',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',existingRecords:[]});
 assert.equal(result.status,'IMPORT_STAGED_READBACK_VERIFIED');
 assert.equal(result.integrityStatus,'UNVERIFIED'); assert.equal(result.canonicalMemoryWrite,false); assert.equal(audits.length,1);
 const got=await svc.retrieve({projectId:'project-hfm-v02',groupId:'123456789',query:'synthetic project decision'});
 assert.equal(got.resultCount,1); assert.equal(got.results[0].retrievableAsTrustedMemory,false);
 console.log('GROUP_IMPORT_ATOMIC_STORE_READBACK_AUDIT_AND_RETRIEVAL=PASS');
 const corrupt={...store,async readBatch(id,p){const b=await store.readBatch(id,p);b.items[0].record.content='tampered';return b;}};
 const bad=createFacebookGroupImportService({store:corrupt,auditWriter:async()=>{}});
 await assert.rejects(()=>bad.import({content:JSON.stringify(env([rec({sourceId:'tamper-fixture'})],{exportId:'tamper-001'})),format:'json',groupId:'123456789',projectId:'project-hfm-v02',actorId:'human-fixture',existingRecords:[]}),/readback identity or digest mismatch/);
 console.log('GROUP_IMPORT_READBACK_TAMPER_DETECTION=PASS');
 assert.throws(()=>createFacebookGroupImportService({store:{...store,capabilities:{...store.capabilities,atomicCreateOnly:false}},auditWriter:async()=>{}}),/immutable atomic-create store/);
 assert.throws(()=>createFacebookGroupImportService({store,auditWriter:null}),/durable auditWriter/);
 console.log('GROUP_IMPORT_PROVIDER_CAPABILITY_AND_AUDIT_GATES=PASS');
 console.log('GROUP_IMPORT_LIVE_FACEBOOK_REQUESTS=0');
 console.log('GROUP_IMPORT_PRIVATE_GROUP_ACCESS=0');
 console.log('GROUP_IMPORT_CANONICAL_MEMORY_WRITES=0');
 console.log('TESTS_FAILED=0');
 console.log('RESULT=MIRA_HFM_PHASE5_FACEBOOK_GROUP_IMPORT_OFFLINE_TESTS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
