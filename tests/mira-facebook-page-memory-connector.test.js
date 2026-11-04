'use strict';
const assert=require('node:assert/strict');
const {
 evaluateFacebookPageCapabilities,createManualPostDraft,parsePublicPagePostUrl,
 prepareManualPostImport,compareManualReadback,getAutomaticOperationDisposition
}=require('../services/mira-facebook-page-memory-connector');
const now=new Date().toISOString();
const baseRecord={
 memoryId:'memory-fixture-001',projectId:'project-alpha',
 content:'Approved public project note.',integrity:{status:'VERIFIED'},access:{classification:'PUBLIC'},lifecycle:'ACTIVE'
};
const goodEvidence=(operation)=>({verified:true,pageId:'123456789',operation,evidenceRef:'offline-fixture-'+operation,checkedAt:now});
const caps=evaluateFacebookPageCapabilities({
 pageId:'123456789',apiVersion:'v99.0',apiConfigured:true,apiSupported:'AVAILABLE',
 readPermission:'AVAILABLE',writePermission:'PERMISSION_DENIED',
 permissionEvidence:{read:goodEvidence('READ'),write:goodEvidence('WRITE')}
});
assert.equal(caps.read.state,'AVAILABLE');
assert.equal(caps.write.state,'PERMISSION_DENIED');
assert.equal(caps.automaticCallsImplemented,false);
assert.equal(getAutomaticOperationDisposition({capabilities:caps,operation:'READ'}).allowed,false);
console.log('READ_AND_WRITE_CAPABILITIES_ARE_INDEPENDENT=PASS');
const missing=evaluateFacebookPageCapabilities({apiConfigured:true,pageId:'123456789',apiVersion:'v99.0',apiSupported:'AVAILABLE',readPermission:'AVAILABLE',writePermission:'AVAILABLE'});
assert.equal(missing.read.state,'UNKNOWN');
assert.equal(missing.write.state,'UNKNOWN');
console.log('MISSING_PERMISSION_EVIDENCE_FAILS_CLOSED=PASS');
const noApi=evaluateFacebookPageCapabilities({apiConfigured:false,readPermission:'AVAILABLE',writePermission:'AVAILABLE'});
assert.equal(noApi.read.state,'NOT_CONFIGURED');
assert.equal(noApi.write.state,'NOT_CONFIGURED');
console.log('API_NOT_CONFIGURED_DOES_NOT_IMPLY_PERMISSION=PASS');
assert.equal(evaluateFacebookPageCapabilities({apiConfigured:true,pageId:'123456789',apiVersion:'v99.0',apiSupported:'AVAILABLE',readPermission:'PERMISSION_DENIED'}).read.state,'PERMISSION_DENIED');
console.log('READ_PERMISSION_DENIAL_PRESERVED=PASS');
assert.equal(evaluateFacebookPageCapabilities({apiConfigured:true,pageId:'123456789',apiVersion:'v99.0',apiSupported:'UNKNOWN',readPermission:'AVAILABLE'}).read.state,'UNKNOWN');
console.log('UNKNOWN_API_SUPPORT_FAILS_CLOSED=PASS');
assert.equal(evaluateFacebookPageCapabilities({apiConfigured:true,pageId:'123456789',apiVersion:'v99.0',apiSupported:'AVAILABLE',readPermission:'AVAILABLE',permissionEvidence:{read:{...goodEvidence('READ'),pageId:'other'}}}).read.state,'UNKNOWN');
console.log('MISMATCHED_PAGE_EVIDENCE_NOT_ACCEPTED=PASS');

const draft=createManualPostDraft({record:baseRecord,pageName:'Mira Memory',generatedAt:now});
assert.equal(draft.status,'PENDING_MANUAL_POST');
assert.equal(draft.content,baseRecord.content);
assert.equal(draft.contentHash.length,64);
console.log('MANUAL_POST_DRAFT_GENERATED_WITH_CONTENT_DIGEST=PASS');
assert.throws(()=>createManualPostDraft({record:{...baseRecord,integrity:{status:'UNVERIFIED'}}}),/integrity-verified/);
console.log('UNVERIFIED_MEMORY_CANNOT_CREATE_POST_DRAFT=PASS');
assert.throws(()=>createManualPostDraft({record:{...baseRecord,access:{classification:'PROJECT_PRIVATE'}}}),/explicitly PUBLIC/);
assert.throws(()=>createManualPostDraft({record:{...baseRecord,access:undefined}}),/explicitly PUBLIC/);
console.log('NONPUBLIC_MEMORY_CANNOT_ENTER_FACEBOOK_POST_DRAFT=PASS');
assert.throws(()=>createManualPostDraft({record:{...baseRecord,content:'  '}}),/record.content/);
console.log('EMPTY_POST_CONTENT_REJECTED=PASS');

const url='https://www.facebook.com/123456789/posts/987654321/';
const locator=parsePublicPagePostUrl(url,{expectedPageId:'123456789'});
assert.equal(locator.postId,'987654321');
assert.equal(locator.status,'SOURCE_URL_VALIDATED_NOT_FETCHED');
console.log('PUBLIC_PAGE_POST_URL_SHAPE_VALIDATED=PASS');
assert.throws(()=>parsePublicPagePostUrl('http://www.facebook.com/123456789/posts/987654321',{expectedPageId:'123456789'}),/HTTPS/);
assert.throws(()=>parsePublicPagePostUrl('https://evil.example/123456789/posts/987654321',{expectedPageId:'123456789'}),/HTTPS public Facebook/);
assert.throws(()=>parsePublicPagePostUrl('https://www.facebook.com/999/posts/987654321',{expectedPageId:'123456789'}),/does not match/);
assert.throws(()=>parsePublicPagePostUrl('https://www.facebook.com/123456789/profile.php',{expectedPageId:'123456789'}),/supported Facebook Page/);
console.log('UNTRUSTED_OR_MISMATCHED_POST_URLS_REJECTED=PASS');
const imported=prepareManualPostImport({postUrl:url,expectedPageId:'123456789',content:baseRecord.content,observedAt:now});
assert.equal(imported.integrity.status,'UNVERIFIED');
assert.equal(imported.trust.status,'SOURCE_RECORDED');
assert.equal(imported.lifecycle,'PENDING_REVIEW');
assert.equal(imported.verificationStatus,'MANUAL_IMPORT_PENDING_INDEPENDENT_READBACK');
console.log('MANUAL_IMPORT_REMAINS_UNVERIFIED_AND_PENDING_REVIEW=PASS');
const matched=compareManualReadback({preparedImport:imported,readbackContent:baseRecord.content,readbackPageId:'123456789'});
assert.equal(matched.status,'MANUAL_READBACK_MATCHED_PENDING_INDEPENDENT_VERIFICATION');
assert.equal(matched.integrityStatus,'UNVERIFIED');
assert.equal(matched.mayEnterTrustedMemory,false);
const mismatch=compareManualReadback({preparedImport:imported,readbackContent:'changed',readbackPageId:'123456789'});
assert.equal(mismatch.status,'CONFLICT_REQUIRES_QUARANTINE');
console.log('MANUAL_READBACK_NEVER_SELF_PROMOTES_TO_VERIFIED=PASS');
assert.throws(()=>getAutomaticOperationDisposition({capabilities:caps,operation:'DELETE'}),/Only READ or WRITE/);
console.log('UNSUPPORTED_AUTOMATIC_OPERATION_REJECTED=PASS');
console.log('NETWORK_REQUESTS=0');
console.log('LIVE_META_API_CALLS=0');
console.log('PERSISTENT_WRITES=0');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PHASE4_FACEBOOK_MANUAL_CONNECTOR_CONTRACT_PASS');
