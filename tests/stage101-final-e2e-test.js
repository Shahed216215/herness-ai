'use strict';

const assert = require('assert');
const fs = require('fs');

const routeSource =
  fs.readFileSync(
    'routes/deliverable-integration.js',
    'utf8'
  );

const serverSource =
  fs.readFileSync(
    'server.js',
    'utf8'
  );

const requiredRoutes = [
  '/deliverables/from-completed-work',
  '/deliverables/:id/build-verify',
  '/deliverables/:id/prepare-submission',
  '/deliverables/:id/submit',
  '/deliverables/:id/accept',
  '/deliverables/:id/revision-requested'
];

for (const route of requiredRoutes) {
  assert(
    routeSource.includes(route),
    `MISSING_ROUTE:${route}`
  );
}

assert(
  serverSource.includes('registerDeliverableIntegrationRoutes') &&
  serverSource.includes("require('./routes/deliverable-integration')") &&
  /registerDeliverableIntegrationRoutes\s*\(\s*app\s*,/.test(serverSource),
  'DELIVERABLE_ROUTE_MOUNT_MISSING'
);

console.log('ROUTE DEFINITIONS: PASS');
console.log('SERVER MOUNT: PASS');

const tests = [
  'tests/stage101-real-format-test.js',
  'tests/stage101-deliverable-builder-e2e-test.js',
  'tests/stage101-deliverable-revision-test.js',
  'tests/stage101-revision-return-e2e.js',
  'tests/stage101-deliverable-integration-e2e.js',
  'tests/stage101-deliverable-tamper-test.js',
  'tests/stage101-deliverable-negative-test.js'
];

const { spawnSync } = require('child_process');

for (const test of tests) {
  const result = spawnSync(
    process.execPath,
    [test],
    {
      encoding: 'utf8'
    }
  );

  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  assert.strictEqual(
    result.status,
    0,
    `TEST_FAILED:${test}`
  );
}

console.log('STAGE10_1_CANONICAL_FINAL_E2E: PASS');
