'use strict';
const assert=require('node:assert/strict');
const {validateProviderContract,assertProviderOperation}=require('../services/mira-memory-provider-contract');
const strong={
 schemaVersion:'1.0.0',providerId:'synthetic-local-fixture',providerType:'SYNTHETIC_LOCAL',
 capabilities:{
  readSnapshot:true,listByProject:true,stableSourceIds:true,projectIsolation:true,
  atomicConditionalWrite:true,immutableVersions:true,independentVerification:true,
  restore:true,encryptedAtRest:true,snapshotConsistency:'STRONG'
 }
};
const valid=validateProviderContract(strong);
assert.equal(valid.providerId,strong.providerId);
assert.equal(Object.isFrozen(valid.capabilities),true);
console.log('PROVIDER_CAPABILITY_CONTRACT_VALID=PASS');
for(const operation of ['READ_SNAPSHOT','LIST_BY_PROJECT','PREPARE_WRITE','COMMIT_WRITE','VERIFY_SNAPSHOT','RESTORE']){
 assert.equal(assertProviderOperation({contract:strong,operation,classification:'PUBLIC'}).supported,true);
}
console.log('STRONG_PROVIDER_OPERATIONS_PASS=PASS');
const driveLike={
 ...strong,providerId:'synthetic-drive-like',
 capabilities:{...strong.capabilities,atomicConditionalWrite:false,immutableVersions:false,snapshotConsistency:'BEST_EFFORT'}
};
assert.throws(()=>assertProviderOperation({contract:driveLike,operation:'COMMIT_WRITE',classification:'PUBLIC'}),/missing: atomicConditionalWrite, immutableVersions/);
console.log('NONATOMIC_PROVIDER_COMMIT_REJECTED=PASS');
assert.throws(()=>assertProviderOperation({contract:driveLike,operation:'READ_SNAPSHOT',classification:'PUBLIC'}),/STRONG snapshot consistency/);
console.log('WEAK_SNAPSHOT_CONSISTENCY_REJECTED=PASS');
assert.equal(assertProviderOperation({contract:driveLike,operation:'PREPARE_WRITE',classification:'PUBLIC'}).supported,true);
console.log('PREPARE_ONLY_WITHOUT_COMMIT_CAPABILITY_PASS=PASS');
const unencrypted={...strong,providerId:'synthetic-unencrypted',capabilities:{...strong.capabilities,encryptedAtRest:false}};
assert.throws(()=>assertProviderOperation({contract:unencrypted,operation:'READ_SNAPSHOT',classification:'PROJECT_PRIVATE'}),/missing: encryptedAtRest/);
console.log('NONPUBLIC_READ_REQUIRES_AT_REST_ENCRYPTION=PASS');
assert.throws(()=>assertProviderOperation({contract:unencrypted,operation:'COMMIT_WRITE',classification:'RESTRICTED'}),/missing: encryptedAtRest/);
console.log('RESTRICTED_COMMIT_REQUIRES_AT_REST_ENCRYPTION=PASS');
assert.equal(assertProviderOperation({contract:unencrypted,operation:'READ_SNAPSHOT',classification:'PUBLIC'}).supported,true);
console.log('PUBLIC_READ_MAY_USE_UNENCRYPTED_PROVIDER=PASS');
assert.equal(assertProviderOperation({contract:unencrypted,operation:'PREPARE_WRITE',classification:'RESTRICTED'}).supported,true);
console.log('NONPERSISTENT_PREPARE_DOES_NOT_REQUIRE_PROVIDER_ENCRYPTION=PASS');
assert.throws(()=>assertProviderOperation({contract:strong,operation:'READ_SNAPSHOT',classification:'TOP_SECRET'}),/classification is unsupported/);
console.log('UNKNOWN_DATA_CLASSIFICATION_REJECTED=PASS');
assert.throws(()=>validateProviderContract({...strong,extra:true}),/exact supported fields/);
console.log('UNKNOWN_PROVIDER_FIELD_REJECTED=PASS');
assert.throws(()=>validateProviderContract({...strong,capabilities:{...strong.capabilities,atomicConditionalWrite:true,immutableVersions:false}}),/Atomic writes require/);
console.log('ATOMIC_WRITE_WITHOUT_IMMUTABLE_VERSIONS_REJECTED=PASS');
assert.throws(()=>validateProviderContract({...strong,capabilities:{...strong.capabilities,independentVerification:true,stableSourceIds:false}}),/requires stable source IDs/);
console.log('INDEPENDENT_VERIFY_WITHOUT_STABLE_IDS_REJECTED=PASS');
assert.throws(()=>assertProviderOperation({contract:strong,operation:'DELETE',classification:'PUBLIC'}),/Unsupported provider operation/);
console.log('UNDECLARED_PROVIDER_OPERATION_REJECTED=PASS');
assert.throws(()=>assertProviderOperation({contract:strong,operation:'READ_SNAPSHOT'}),/classification is unsupported/);
console.log('MISSING_PROVIDER_DATA_CLASSIFICATION_REJECTED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PROVIDER_CAPABILITY_CONTRACT_PASS');
