'use strict';

// Capability declaration validator only. It never calls or connects to a provider.
const CAPABILITY_KEYS = [
  'readSnapshot', 'listByProject', 'stableSourceIds', 'projectIsolation',
  'atomicConditionalWrite', 'immutableVersions', 'independentVerification',
  'restore', 'encryptedAtRest'
];
const SNAPSHOT_CONSISTENCY = new Set(['STRONG', 'BEST_EFFORT', 'NONE']);
const OPERATIONS = new Set(['READ_SNAPSHOT', 'LIST_BY_PROJECT', 'PREPARE_WRITE', 'COMMIT_WRITE', 'VERIFY_SNAPSHOT', 'RESTORE']);
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value,label,max=128) {
  if(typeof value!=='string'||!value.trim()||value.length>max) throw new Error(label+' is required.');
}
function validateProviderContract(contract) {
  if(!object(contract)||Object.keys(contract).length!==4||
     !['schemaVersion','providerId','providerType','capabilities'].every(k=>Object.prototype.hasOwnProperty.call(contract,k))) {
    throw new Error('Provider contract must contain the exact supported fields.');
  }
  if(contract.schemaVersion!=='1.0.0') throw new Error('Unsupported provider contract schemaVersion.');
  text(contract.providerId,'providerId');
  text(contract.providerType,'providerType');
  const c=contract.capabilities;
  if(!object(c)||Object.keys(c).length!==CAPABILITY_KEYS.length+1||
     [...CAPABILITY_KEYS,'snapshotConsistency'].some(k=>!Object.prototype.hasOwnProperty.call(c,k))) {
    throw new Error('Provider capabilities must contain the exact supported fields.');
  }
  for(const key of CAPABILITY_KEYS) if(typeof c[key]!=='boolean') throw new Error(key+' capability must be boolean.');
  if(!SNAPSHOT_CONSISTENCY.has(c.snapshotConsistency)) throw new Error('snapshotConsistency is unsupported.');
  if(c.readSnapshot===false&&c.snapshotConsistency!=='NONE') throw new Error('A provider without readSnapshot must declare NONE consistency.');
  if(c.atomicConditionalWrite&&(!c.immutableVersions||!c.projectIsolation)) {
    throw new Error('Atomic writes require immutable versions and project isolation.');
  }
  if(c.independentVerification&&!c.stableSourceIds) {
    throw new Error('Independent verification requires stable source IDs.');
  }
  return Object.freeze({
    schemaVersion:contract.schemaVersion,
    providerId:contract.providerId,
    providerType:contract.providerType,
    capabilities:Object.freeze({...c})
  });
}
function assertProviderOperation({contract,operation}) {
  const c=validateProviderContract(contract);
  if(!OPERATIONS.has(operation)) throw new Error('Unsupported provider operation.');
  const requirements={
    READ_SNAPSHOT:['readSnapshot','projectIsolation'],
    LIST_BY_PROJECT:['listByProject','stableSourceIds','projectIsolation'],
    PREPARE_WRITE:['projectIsolation','stableSourceIds'],
    COMMIT_WRITE:['atomicConditionalWrite','immutableVersions','projectIsolation','independentVerification'],
    VERIFY_SNAPSHOT:['readSnapshot','stableSourceIds','independentVerification'],
    RESTORE:['restore','immutableVersions','independentVerification','projectIsolation']
  }[operation];
  const missing=requirements.filter(key=>c.capabilities[key]!==true);
  if(missing.length) throw new Error('Provider operation '+operation+' is unsupported; missing: '+missing.join(', '));
  if(['READ_SNAPSHOT','LIST_BY_PROJECT','VERIFY_SNAPSHOT'].includes(operation)&&
     c.capabilities.snapshotConsistency!=='STRONG') {
    throw new Error('Provider operation '+operation+' requires STRONG snapshot consistency.');
  }
  return Object.freeze({providerId:c.providerId,operation,supported:true,capabilityEvidence:Object.freeze(requirements.slice())});
}
module.exports={validateProviderContract,assertProviderOperation,CAPABILITY_KEYS,OPERATIONS};
