'use strict';

const {
  validateProjectOwnerRegistryEntry
}=require('./mira-memory-project-owner-registry-contract');

function object(value) {
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function requiredText(value,label) {
  if(typeof value!=='string'||!value.trim()||value.length>256) throw new Error(label+' is required.');
}
function currentDate(now) {
  const value=typeof now==='function'?now():now;
  const date=value instanceof Date?new Date(value.getTime()):new Date(value);
  if(!Number.isFinite(date.getTime())) throw new Error('Current time is invalid.');
  return date;
}
function createProjectMappingOwnerApprovalVerifier({
  ownerRegistry,expectedTenantId,verifyRegistryRecord,
  now=()=>new Date(),evidenceLifetimeMs=120000
}) {
  if(!object(ownerRegistry)) throw new Error('An explicit project owner registry entry is required.');
  requiredText(expectedTenantId,'expectedTenantId');
  if(typeof verifyRegistryRecord!=='function') throw new Error('A trusted owner-registry verifier is required.');
  if(!Number.isInteger(evidenceLifetimeMs)||evidenceLifetimeMs<1000||evidenceLifetimeMs>300000) {
    throw new Error('Approval evidence lifetime must be 1-300 seconds.');
  }
  return mapping=>{
    if(!object(mapping)) throw new Error('A project mapping is required for owner approval verification.');
    requiredText(mapping.projectId,'mapping.projectId');
    requiredText(mapping.approvedBy,'mapping.approvedBy');
    requiredText(mapping.approvalReference,'mapping.approvalReference');
    if(typeof mapping.mappingDigest!=='string'||! /^[a-f0-9]{64}$/.test(mapping.mappingDigest)) {
      throw new Error('Mapping digest must be SHA-256 before owner approval verification.');
    }
    const verifiedAt=currentDate(now);
    const registry=validateProjectOwnerRegistryEntry({
      entry:ownerRegistry,expectedProjectId:mapping.projectId,
      expectedTenantId,verifyRegistryRecord,now:verifiedAt
    });
    if(registry.status!=='ACTIVE') throw new Error('Project owner registry is not ACTIVE.');
    const membership=registry.memberships.find(item=>item.actorId===mapping.approvedBy);
    if(!membership||membership.actorType!=='HUMAN'||membership.role!=='OWNER'||
       membership.status!=='ACTIVE'||!membership.allowedOperations.includes('APPROVE_MAPPING')) {
      throw new Error('Mapping approver is not an active project OWNER with APPROVE_MAPPING authority.');
    }
    const approvedAt=Date.parse(mapping.approvedAt);
    const validFrom=Date.parse(membership.validFrom);
    const validUntil=Date.parse(membership.validUntil);
    const nowMs=verifiedAt.getTime();
    if(!Number.isFinite(approvedAt)||approvedAt<validFrom||approvedAt>=validUntil||approvedAt>nowMs) {
      throw new Error('Mapping approval timestamp is outside the approver membership validity window.');
    }
    const expiresAt=new Date(Math.min(nowMs+evidenceLifetimeMs,validUntil)).toISOString();
    if(Date.parse(expiresAt)<=nowMs) throw new Error('Owner approval evidence cannot outlive membership validity.');
    return Object.freeze({
      decision:'APPROVED',
      approvalReference:mapping.approvalReference,
      mappingDigest:mapping.mappingDigest,
      projectId:mapping.projectId,
      approvedBy:mapping.approvedBy,
      approvedAt:mapping.approvedAt,
      registryRevision:registry.registryRevision,
      revocationStatus:'ACTIVE',
      verifiedAt:verifiedAt.toISOString(),
      expiresAt
    });
  };
}
module.exports={createProjectMappingOwnerApprovalVerifier};
