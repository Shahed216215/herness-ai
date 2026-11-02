'use strict';

const assert = require('assert');

const schema =
  require('../deliverable-schema');

const builder =
  require('../services/deliverable-builder');

const orchestrator =
  require('../services/deliverable-orchestrator');

assert.throws(
  () => schema.createDeliverable({
    id: 'bad-format',
    workId: 'work',
    title: 'Bad',
    requiredFormat: 'EXE'
  }),
  /UNSUPPORTED_FORMAT/
);

assert.throws(
  () => orchestrator.prepareFromCompletedWork({
    id: 'no-format',
    title: 'Missing Format',
    status: 'COMPLETED'
  }),
  /REQUIRED_DELIVERABLE_FORMAT_MISSING/
);

assert.throws(
  () => builder.build(
    'definitely-does-not-exist'
  ),
  /DELIVERABLE_NOT_FOUND/
);

assert.throws(
  () => builder.verify(
    'definitely-does-not-exist'
  ),
  /DELIVERABLE_NOT_FOUND/
);

console.log(
  'STAGE10_1_NEGATIVE_TEST: PASS'
);
