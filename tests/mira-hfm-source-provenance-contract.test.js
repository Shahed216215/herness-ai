'use strict';
const assert = require('node:assert/strict');
const { verifyIndependentSourceProvenancePair } = require('../services/mira-hfm-source-provenance-contract');

const baseline = {
  sourceId: 'baseline-source',
  provenance: {
    storageSystemId: 'storage-a', storageInstanceId: 'instance-a',
    securityPrincipalId: 'principal-a', trustDomainId: 'trust-a',
    sourceSystemId: 'system-a', snapshotIssuerId: 'issuer-a'
  }
};
const backup = {
  sourceId: 'backup-source',
  provenance: {
    storageSystemId: 'storage-b', storageInstanceId: 'instance-b',
    securityPrincipalId: 'principal-b', trustDomainId: 'trust-b',
    sourceSystemId: 'system-b', snapshotIssuerId: 'issuer-b'
  }
};
const policy = () => ({
  contractVersion: '1', policyVersion: 'synthetic-policy-v1',
  sources: {
    [baseline.sourceId]: { ...baseline.provenance },
    [backup.sourceId]: { ...backup.provenance }
  }
});
function rejected(fn, code) { assert.throws(fn, error => error.code === code); }

const valid = verifyIndependentSourceProvenancePair({
  baselineEvidence: baseline, backupEvidence: backup, provenancePolicy: policy()
});
assert.equal(valid.status, 'PROVENANCE_POLICY_MATCHED_INDEPENDENCE_CLAIMS_VERIFIED_NOT_INFRASTRUCTURE_CERTIFIED');
assert.equal(valid.productionInfrastructureIndependentlyCertified, false);

for (const field of Object.keys(baseline.provenance)) {
  const p = policy();
  p.sources[backup.sourceId][field] = p.sources[baseline.sourceId][field];
  const sharedClaim = { ...backup, provenance: { ...backup.provenance, [field]: baseline.provenance[field] } };
  rejected(() => verifyIndependentSourceProvenancePair({
    baselineEvidence: baseline, backupEvidence: sharedClaim, provenancePolicy: p
  }), 'HFM_PROVENANCE_NOT_INDEPENDENT');
}

rejected(() => verifyIndependentSourceProvenancePair({
  baselineEvidence: baseline,
  backupEvidence: { ...backup, sourceId: baseline.sourceId },
  provenancePolicy: policy()
}), 'HFM_PROVENANCE_SOURCE_ID_COLLISION');

rejected(() => verifyIndependentSourceProvenancePair({
  baselineEvidence: baseline,
  backupEvidence: { ...backup, provenance: { ...backup.provenance, storageInstanceId: 'forged-instance' } },
  provenancePolicy: policy()
}), 'HFM_PROVENANCE_PIN_MISMATCH');

rejected(() => verifyIndependentSourceProvenancePair({
  baselineEvidence: baseline, backupEvidence: backup,
  provenancePolicy: { ...policy(), sources: { ...policy().sources, [backup.sourceId]: undefined } }
}), 'HFM_PROVENANCE_PROFILE_INVALID');

rejected(() => verifyIndependentSourceProvenancePair({
  baselineEvidence: baseline, backupEvidence: backup,
  provenancePolicy: { contractVersion: '2', sources: policy().sources }
}), 'HFM_PROVENANCE_POLICY_REQUIRED');

process.stdout.write('MIRA_HFM_PROVENANCE_FULLY_INDEPENDENT_PROFILE_PASS\n');
process.stdout.write('MIRA_HFM_PROVENANCE_SHARED_BOUNDARY_BLOCK_PASS\n');
process.stdout.write('MIRA_HFM_PROVENANCE_DUPLICATE_ID_BLOCK_PASS\n');
process.stdout.write('MIRA_HFM_PROVENANCE_FORGED_CLAIM_BLOCK_PASS\n');
process.stdout.write('MIRA_HFM_PROVENANCE_UNPINNED_POLICY_BLOCK_PASS\n');
process.stdout.write('MIRA_HFM_PROVENANCE_CONTRACT_COMPLETE\n');
