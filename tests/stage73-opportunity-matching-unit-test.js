const assert = require('assert');

const {
  matchOpportunity,
  DECISIONS
} = require('../services/mira-opportunity-matching-engine');

const { listOpportunities } = require('../opportunity-store');

console.log('\n=== STAGE 7.3 OPPORTUNITY MATCHING UNIT TEST ===');

const opportunities = listOpportunities();

assert(opportunities.length > 0, 'Expected at least one opportunity');

const opportunity = opportunities[0];

const result = matchOpportunity(opportunity.opportunityId);

assert.strictEqual(
  result.opportunityId,
  opportunity.opportunityId,
  'Opportunity identifier must be preserved'
);

assert.strictEqual(
  result.evidenceOnly,
  true,
  'Matching must be evidence-only'
);

assert.strictEqual(
  result.requirements.status,
  'matched',
  'First opportunity requirements should resolve through authoritative registry'
);

assert.strictEqual(
  result.capability.status,
  'matched',
  'First opportunity should have verified capability evidence'
);

assert.strictEqual(
  result.skills.status,
  'matched',
  'Research skill has verified profile evidence'
);

assert.strictEqual(
  result.experience.status,
  'insufficient_evidence',
  'No relevant Research experience evidence should be inferred'
);

assert.strictEqual(
  result.workload.status,
  'measured',
  'Workload must come from measured task-store state'
);

assert.strictEqual(
  result.decision,
  DECISIONS.INSUFFICIENT_EVIDENCE,
  'Opportunity must not become candidate without relevant experience evidence'
);

assert(
  Array.isArray(result.reasons),
  'Reasons must be an array'
);

assert(
  result.reasons.includes('experience_evidence_required'),
  'Missing relevant experience evidence must be explicitly reported'
);

console.log('PASS: opportunity identifier contract');
console.log('PASS: evidence-only matching contract');
console.log('PASS: authoritative capability match');
console.log('PASS: requirement resolution');
console.log('PASS: unverified skill cannot become verified');
console.log('PASS: relevant experience cannot be falsely inferred');
console.log('PASS: measured workload evidence');
console.log('PASS: insufficient-evidence decision gate');

console.log('\nSTAGE 7.3 UNIT TEST: PASS');
