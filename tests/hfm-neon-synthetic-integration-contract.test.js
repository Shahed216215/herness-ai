'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const integration = fs.readFileSync('tests/hfm-neon-synthetic-integration.test.js', 'utf8');
const workflow = fs.readFileSync('.github/workflows/mira-hfm-neon-synthetic-integration.yml', 'utf8');

test('synthetic Neon writes require an exact separately approved test endpoint host', () => {
  assert.match(integration, /MIRA_HFM_TEST_DATABASE_HOST/);
  assert.match(integration, /TEST_DATABASE_URL_HOST_MISMATCH/);
  assert.match(integration, /TEST_DATABASE_HOST_MUST_DIFFER_FROM_PRODUCTION/);
  assert.ok(
    integration.indexOf('TEST_DATABASE_URL_HOST_MISMATCH') < integration.indexOf('adapter.createPool'),
    'endpoint mismatch must fail before database pool creation'
  );
});

test('workflow requires and passes the disposable endpoint host allowlist', () => {
  assert.match(workflow, /MIRA_HFM_TEST_DATABASE_HOST: \$\{\{ vars\.MIRA_HFM_TEST_DATABASE_HOST \}\}/);
  assert.match(workflow, /\|\| -z "\$\{MIRA_HFM_TEST_DATABASE_HOST:-\}"/);
  assert.match(workflow, /node tests\/hfm-neon-synthetic-integration-contract\.test\.js/);
});
