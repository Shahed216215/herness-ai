'use strict';

const { CAPABILITIES, CAPABILITY_STATES } = require('./core');

function validateCapabilityObservation(observation, expected, nowValue) {
  const fail = (status, reason) => ({ valid: false, status, reason });
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return fail('UNKNOWN', 'OBSERVATION_INVALID');
  }
  const required = [
    'providerId', 'projectId', 'capability', 'state', 'checkedAt',
    'expiresAt', 'permissionScope', 'policyVersion', 'evidenceReference'
  ];
  if (required.some(key => !Object.prototype.hasOwnProperty.call(observation, key))) {
    return fail('UNKNOWN', 'OBSERVATION_FIELDS_MISSING');
  }
  if (typeof observation.providerId !== 'string' || !observation.providerId ||
      typeof observation.projectId !== 'string' || !observation.projectId ||
      !CAPABILITIES.includes(observation.capability) ||
      !CAPABILITY_STATES.has(observation.state) ||
      !Array.isArray(observation.permissionScope) ||
      !observation.permissionScope.includes(observation.capability) ||
      typeof observation.policyVersion !== 'string' || !observation.policyVersion ||
      typeof observation.evidenceReference !== 'string' || !observation.evidenceReference) {
    return fail('UNKNOWN', 'OBSERVATION_VALUE_INVALID');
  }
  if (!expected || observation.providerId !== expected.providerId ||
      observation.projectId !== expected.projectId ||
      observation.capability !== expected.capability) {
    return fail('PERMISSION_DENIED', 'OBSERVATION_SCOPE_MISMATCH');
  }
  const checkedAt = Date.parse(observation.checkedAt);
  const expiresAt = Date.parse(observation.expiresAt);
  const now = nowValue ? Date.parse(nowValue) : Date.now();
  if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt) ||
      !Number.isFinite(now) || expiresAt <= checkedAt) {
    return fail('UNKNOWN', 'OBSERVATION_TIME_INVALID');
  }
  if (checkedAt > now) return fail('UNKNOWN', 'OBSERVATION_FROM_FUTURE');
  if (expiresAt <= now) return fail('EXPIRED', 'CAPABILITY_OBSERVATION_EXPIRED');
  if (observation.state !== 'AVAILABLE') {
    return { valid: true, status: observation.state, reason: 'CAPABILITY_NOT_AVAILABLE' };
  }
  return { valid: true, status: 'AVAILABLE' };
}

function evaluateCapabilitySet(observations, requiredCapabilities, context, providerId) {
  const states = {};
  if (!Array.isArray(observations) || !context ||
      typeof context.projectId !== 'string' || !context.projectId ||
      typeof providerId !== 'string' || !providerId) {
    for (const capability of requiredCapabilities || []) states[capability] = 'UNKNOWN';
    return { valid: false, states, reason: 'CAPABILITY_OBSERVATIONS_UNAVAILABLE' };
  }
  let valid = true;
  for (const capability of requiredCapabilities || []) {
    const matches = observations.filter(item =>
      item && item.providerId === providerId &&
      item.projectId === context.projectId &&
      item.capability === capability
    );
    if (matches.length !== 1) {
      states[capability] = 'UNKNOWN';
      valid = false;
      continue;
    }
    const result = validateCapabilityObservation(matches[0], {
      providerId, projectId: context.projectId, capability
    }, context.now);
    states[capability] = result.valid ? result.status : result.status;
    if (!result.valid) valid = false;
  }
  return { valid, states };
}

module.exports = { validateCapabilityObservation, evaluateCapabilitySet };
