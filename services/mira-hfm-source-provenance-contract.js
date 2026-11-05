'use strict';

const REQUIRED_FIELDS = Object.freeze([
  'storageSystemId',
  'storageInstanceId',
  'securityPrincipalId',
  'trustDomainId',
  'sourceSystemId',
  'snapshotIssuerId'
]);

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function validateProfile(profile, label) {
  if (!isPlainObject(profile) ||
      REQUIRED_FIELDS.some(field => typeof profile[field] !== 'string' ||
        !profile[field].trim() || profile[field].length > 256)) {
    fail(label + ' provenance profile is incomplete.', 'HFM_PROVENANCE_PROFILE_INVALID');
  }
  return Object.fromEntries(REQUIRED_FIELDS.map(field => [field, profile[field]]));
}

/**
 * Verifies provenance claims already authenticated by the source signature
 * and pinned independently in the source trust record. Distinct source IDs
 * or signing keys are deliberately insufficient.
 */
function verifyIndependentSourceProvenancePair({
  baselineEvidence, backupEvidence, provenancePolicy
}) {
  if (!isPlainObject(baselineEvidence) || !isPlainObject(backupEvidence) ||
      !isPlainObject(provenancePolicy) || provenancePolicy.contractVersion !== '1' ||
      !isPlainObject(provenancePolicy.sources)) {
    fail('An explicit, independently pinned source-provenance policy and two source attestations are required.',
      'HFM_PROVENANCE_POLICY_REQUIRED');
  }
  const baselineId = baselineEvidence.sourceId;
  const backupId = backupEvidence.sourceId;
  if (typeof baselineId !== 'string' || !baselineId.trim() ||
      typeof backupId !== 'string' || !backupId.trim() || baselineId === backupId) {
    fail('Baseline and backup source identities must be distinct.', 'HFM_PROVENANCE_SOURCE_ID_COLLISION');
  }
  const baselinePinned = validateProfile(provenancePolicy.sources[baselineId], 'Baseline');
  const backupPinned = validateProfile(provenancePolicy.sources[backupId], 'Backup');
  const baselineClaim = validateProfile(baselineEvidence.provenance, 'Baseline attestation');
  const backupClaim = validateProfile(backupEvidence.provenance, 'Backup attestation');

  for (const field of REQUIRED_FIELDS) {
    if (baselineClaim[field] !== baselinePinned[field] ||
        backupClaim[field] !== backupPinned[field]) {
      fail('Signed source provenance does not match the independently pinned policy: ' + field,
        'HFM_PROVENANCE_PIN_MISMATCH');
    }
    if (baselinePinned[field] === backupPinned[field]) {
      fail('Baseline and backup sources share a provenance boundary: ' + field,
        'HFM_PROVENANCE_NOT_INDEPENDENT');
    }
  }
  return Object.freeze({
    status: 'PROVENANCE_POLICY_MATCHED_INDEPENDENCE_CLAIMS_VERIFIED_NOT_INFRASTRUCTURE_CERTIFIED',
    policyVersion: provenancePolicy.policyVersion || 'unspecified',
    baselineSourceId: baselineId,
    backupSourceId: backupId,
    distinctDimensions: REQUIRED_FIELDS.slice(),
    productionInfrastructureIndependentlyCertified: false
  });
}

module.exports = { REQUIRED_FIELDS, verifyIndependentSourceProvenancePair };
