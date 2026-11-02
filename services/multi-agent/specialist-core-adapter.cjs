'use strict';

const {
  PERMISSIONS,
  getPermissions
} = require('../../permissions');
const capabilityProfile = require('../../capability-profile');
const {
  authorizeAndAuditWork
} = require('../mira-autonomous-work-authorization');

const SPECIALIST_PROFILE = Object.freeze({
  researcher: Object.freeze({
    capabilityKey: 'structured research',
    skillKey: 'research',
    runtimeCapability: 'research'
  }),
  coder: Object.freeze({
    capabilityKey: 'code review',
    skillKey: 'coding',
    runtimeCapability: 'code_review'
  }),
  data: Object.freeze({
    capabilityKey: 'data analysis',
    skillKey: 'data',
    runtimeCapability: 'data_analysis'
  }),
  writer: Object.freeze({
    capabilityKey: 'document drafting',
    skillKey: 'writing',
    runtimeCapability: 'document_drafting'
  }),
  excel: Object.freeze({
    capabilityKey: 'spreadsheet analysis',
    skillKey: 'excel',
    runtimeCapability: 'spreadsheet_analysis'
  }),
  automation: Object.freeze({
    capabilityKey: 'workflow planning',
    skillKey: 'automation',
    runtimeCapability: 'workflow_planning'
  })
});

function normalize(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/\s+/g, ' ');
}

function getCapabilityList() {
  const result = capabilityProfile.listCapabilities({
    status: 'active'
  });
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.capabilities)) {
    return result.capabilities;
  }
  throw new Error('CAPABILITY_PROFILE_INVALID');
}

function unwrapSkill(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.skill && typeof result.skill === 'object') {
    return result.skill;
  }
  if (result.status === 'skill_not_found' ||
      result.status === 'not_found') {
    return null;
  }
  return result;
}

function requireTrustedAdmin(identity) {
  if (!identity || identity.role !== 'admin' ||
      !Array.isArray(identity.permissions) ||
      !identity.permissions.includes(PERMISSIONS.SYSTEM_ADMIN)) {
    throw new Error('PERMISSION_DENIED');
  }

  const expected = getPermissions('admin');
  if (!expected.includes(PERMISSIONS.SYSTEM_ADMIN)) {
    throw new Error('TRUSTED_PERMISSION_CONFIG_INVALID');
  }
}

function verifySpecialistCapability(specialist) {
  const mapping = SPECIALIST_PROFILE[specialist];
  if (!mapping) throw new Error('UNKNOWN_SPECIALIST');

  const capabilities = getCapabilityList();
  const capability = capabilities.find(item =>
    normalize(item.key) === normalize(mapping.capabilityKey) ||
    normalize(item.name) === normalize(mapping.capabilityKey)
  );

  if (!capability) {
    throw new Error('CAPABILITY_NOT_REGISTERED');
  }
  if (capability.status !== 'active' ||
      capability.verification !== 'verified') {
    throw new Error('CAPABILITY_NOT_VERIFIED');
  }

  const links = Array.isArray(capability.skills)
    ? capability.skills.map(normalize)
    : [];
  if (!links.includes(normalize(mapping.skillKey))) {
    throw new Error('CAPABILITY_SKILL_MISMATCH');
  }

  const skill = unwrapSkill(
    capabilityProfile.getSkill(mapping.skillKey)
  );
  if (!skill) throw new Error('SKILL_NOT_REGISTERED');
  if (skill.status !== 'active' ||
      skill.verification !== 'verified') {
    throw new Error('SKILL_NOT_VERIFIED');
  }

  return mapping;
}

async function authorizeSpecialistRequest({
  identity,
  request,
  specialist
} = {}) {
  requireTrustedAdmin(identity);

  if (!request || typeof request !== 'object' ||
      typeof request.requestId !== 'string' ||
      !request.requestId.trim() ||
      typeof request.task !== 'string' ||
      !request.task.trim()) {
    throw new Error('INVALID_REQUEST');
  }

  const mapping = verifySpecialistCapability(specialist);

  // Specialists can only propose plans/drafts. No execution privilege
  // or approval is inferred from caller input.
  const authorization = await authorizeAndAuditWork({
    actorRole: identity.role,
    operation: 'proposal_create',
    permissionGranted: true,
    plan: {
      task: request.task,
      risk: 'low'
    },
    resource: 'specialist',
    resourceId: request.requestId
  });

  const policyResult = authorization && authorization.result;
  if (!policyResult || policyResult.allowed !== true) {
    throw new Error(
      policyResult && policyResult.category
        ? 'POLICY_DENIED:' + policyResult.category
        : 'POLICY_DENIED'
    );
  }

  return Object.freeze({
    allowed: true,
    capabilities: Object.freeze([mapping.runtimeCapability]),
    grantId: String(authorization.audit?.id ||
      authorization.audit?.auditEntry?.id || ''),
    approvedBy: 'trusted-mira-core-policy'
  });
}

module.exports = {
  SPECIALIST_PROFILE,
  authorizeSpecialistRequest,
  verifySpecialistCapability,
  requireTrustedAdmin
};
