'use strict';

const assert = require('assert');

const schema = require('../repeat-work-detection-schema');
const engine = require('../services/mira-repeat-work-detection-engine');

assert.strictEqual(schema.similarityStatus(0.90), 'high');
assert.strictEqual(schema.similarityStatus(0.60), 'medium');
assert.strictEqual(schema.similarityStatus(0.20), 'low');
assert.strictEqual(schema.similarityStatus(0), 'none');

assert(engine.tokenize('React Node.js API development').includes('react'));
assert(engine.tokenSimilarity(
  'React Node API development',
  'React Node API development'
) === 1);

assert(engine.calculateSimilarity(
  {
    title: 'React Node API developer',
    skills: ['React', 'Node'],
    domain: 'web'
  },
  {
    id: 'past-1',
    title: 'React Node API development',
    skills: ['React', 'Node'],
    domain: 'web'
  }
) > 0.80);

const result = engine.detectRepeatWork({
  id: 'opportunity-113-test',
  title: 'React Node API developer',
  description: 'Build a web API with React and Node',
  skills: ['React', 'Node'],
  domain: 'web'
});

assert(result);
assert.strictEqual(result.schemaVersion, 1);
assert.strictEqual(result.opportunityId, 'opportunity-113-test');
assert(['REPEAT_WORK', 'RELATED_WORK', 'NEW_WORK'].includes(result.decision));
assert(result.similarityScore >= 0 && result.similarityScore <= 1);
assert(Array.isArray(result.relevantExperienceIds));
assert(Array.isArray(result.evidence));
assert(result.strategy && typeof result.strategy === 'object');

console.log('STAGE113_REPEAT_WORK_UNIT: PASS');
