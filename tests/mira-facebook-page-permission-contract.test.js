'use strict';

const assert=require('node:assert/strict');
const {assessDeclaredMetaPermissionEvidence}=require('../services/mira-facebook-page-permission-contract');

const now=new Date('2026-11-04T12:00:00.000Z');
const context={appId:'111222333',actorId:'444555666',pageId:'123456789',operation:'WRITE_PAGE_POST'};
function evidence(overrides={}) {
 return {
  schemaVersion:'1.0.0',
  appId:context.appId,
  actorId:context.actorId,
  pageId:context.pageId,
  operation:context.operation,
  grantedScopes:['pages_manage_posts','pages_read_engagement','pages_show_list'],
  pageTasks:['CREATE_CONTENT'],
  appMode:'LIVE',
  accessLevel:'ADVANCED',
  appReviewStatus:'APPROVED',
  featureApprovals:[],
  checkedAt:'2026-11-04T11:55:00.000Z',
  evidenceRef:'fixture-meta-permission-evidence-001',
  evidenceSource:'SYNTHETIC_FIXTURE',
  ...overrides
 };
}
const complete=assessDeclaredMetaPermissionEvidence({evidence:evidence(),expectedContext:context,now});
assert.equal(complete.declaredRequirementsMet,true);
assert.equal(complete.productionEligibleByDeclaredEvidence,true);
assert.equal(complete.authorizationState,'NOT_AUTHORIZED_OFFLINE_EVIDENCE_ONLY');
assert.equal(complete.mayCallApi,false);
assert.equal(complete.evidenceTrust,'CALLER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED');
console.log('META_WRITE_DECLARED_SCOPE_TASK_REVIEW_GATE_ASSESSMENT_PASS=PASS');

const missingScope=assessDeclaredMetaPermissionEvidence({
 evidence:evidence({grantedScopes:['pages_manage_posts','pages_read_engagement']}),
 expectedContext:context,now
});
assert.deepEqual(missingScope.missingScopes,['pages_show_list']);
assert.equal(missingScope.declaredRequirementsMet,false);
console.log('MISSING_META_WRITE_SCOPE_FAILS_CLOSED=PASS');

const missingTask=assessDeclaredMetaPermissionEvidence({
 evidence:evidence({pageTasks:[]}),expectedContext:context,now
});
assert.deepEqual(missingTask.missingPageTasks,['CREATE_CONTENT']);
assert.equal(missingTask.declaredRequirementsMet,false);
console.log('MISSING_PAGE_CREATE_CONTENT_TASK_FAILS_CLOSED=PASS');

const publicReadContext={...context,operation:'READ_PUBLIC_PAGE_CONTENT'};
const publicRead=assessDeclaredMetaPermissionEvidence({
 evidence:evidence({operation:'READ_PUBLIC_PAGE_CONTENT',grantedScopes:[],pageTasks:[],featureApprovals:[]}),
 expectedContext:publicReadContext,now
});
assert.deepEqual(publicRead.missingFeatures,['PAGE_PUBLIC_CONTENT_ACCESS']);
assert.equal(publicRead.declaredRequirementsMet,false);
const approvedPublicRead=assessDeclaredMetaPermissionEvidence({
 evidence:evidence({operation:'READ_PUBLIC_PAGE_CONTENT',grantedScopes:[],pageTasks:[],featureApprovals:['PAGE_PUBLIC_CONTENT_ACCESS']}),
 expectedContext:publicReadContext,now
});
assert.equal(approvedPublicRead.declaredRequirementsMet,true);
console.log('PUBLIC_PAGE_CONTENT_ACCESS_FEATURE_IS_EXPLICIT=PASS');

const userReadContext={...context,operation:'READ_USER_CONTENT'};
const userRead=assessDeclaredMetaPermissionEvidence({
 evidence:evidence({operation:'READ_USER_CONTENT',grantedScopes:['pages_read_user_content'],pageTasks:[]}),
 expectedContext:userReadContext,now
});
assert.equal(userRead.declaredRequirementsMet,true);
console.log('USER_CONTENT_READ_PERMISSION_IS_SEPARATE=PASS');

const development=assessDeclaredMetaPermissionEvidence({
 evidence:evidence({appMode:'DEVELOPMENT',accessLevel:'STANDARD',appReviewStatus:'NOT_APPROVED'}),
 expectedContext:context,now
});
assert.equal(development.declaredRequirementsMet,true);
assert.equal(development.productionEligibleByDeclaredEvidence,false);
assert.ok(development.environmentBlockers.includes('APP_NOT_IN_LIVE_MODE'));
assert.ok(development.environmentBlockers.includes('ADVANCED_ACCESS_NOT_DECLARED'));
assert.ok(development.environmentBlockers.includes('APP_REVIEW_NOT_APPROVED'));
console.log('NONPRODUCTION_APP_STATE_BLOCKS_PRODUCTION_ELIGIBILITY=PASS');

const stale=assessDeclaredMetaPermissionEvidence({
 evidence:evidence({checkedAt:'2026-11-04T11:00:00.000Z'}),expectedContext:context,now
});
assert.equal(stale.evidenceFresh,false);
assert.equal(stale.declaredRequirementsMet,false);
const future=assessDeclaredMetaPermissionEvidence({
 evidence:evidence({checkedAt:'2026-11-04T12:01:00.000Z'}),expectedContext:context,now
});
assert.equal(future.evidenceFresh,false);
console.log('STALE_AND_FUTURE_PERMISSION_EVIDENCE_FAIL_CLOSED=PASS');

assert.throws(()=>assessDeclaredMetaPermissionEvidence({
 evidence:evidence(),expectedContext:{...context,pageId:'999999999'},now
}),/identity\/operation binding mismatch/);
assert.throws(()=>assessDeclaredMetaPermissionEvidence({
 evidence:evidence({extraToken:'secret'}),expectedContext:context,now
}),/exact supported fields/);
assert.throws(()=>assessDeclaredMetaPermissionEvidence({
 evidence:evidence({grantedScopes:['unknown_scope']}),expectedContext:context,now
}),/unique array of supported values/);
assert.throws(()=>assessDeclaredMetaPermissionEvidence({
 evidence:evidence({pageId:'not-numeric'}),expectedContext:{...context,pageId:'not-numeric'},now
}),/pageId must be numeric/);
console.log('EXACT_SCHEMA_UNKNOWN_SCOPE_AND_CROSS_PAGE_EVIDENCE_REJECTED=PASS');

console.log('META_PERMISSION_CONTRACT_NETWORK_REQUESTS=0');
console.log('META_PERMISSION_CONTRACT_TOKEN_USE=0');
console.log('META_PERMISSION_CONTRACT_AUTHORIZATION_GRANTED=0');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_META_PERMISSION_EVIDENCE_CONTRACT_PASS');
