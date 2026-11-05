'use strict';

const assert = require('node:assert/strict');
const { evaluateDeploymentPreflight } = require('../scripts/mira-hfm-phase6-deployment-preflight');

const goodEnv = {
  NODE_ENV: 'production',
  MIRA_SESSION_SECRET: 's'.repeat(40),
  TAVILY_API_KEY: 'tavily-synthetic-secret',
  GEMINI_API_KEY: 'gemini-synthetic-secret',
  MIRA_AUDIT_DURABLE_STORAGE_CONFIRMED: 'true',
  MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND: 'supabase',
  SUPABASE_URL: 'https://mira-test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'supabase-synthetic-secret'
};

const ready = evaluateDeploymentPreflight({
  env: goodEnv,
  nodeVersion: 'v24.18.0',
  providerRuntime: { provider: 'gemini', model: '' }
});
assert.equal(ready.status, 'READY_FOR_LIVE_TEST');
assert.equal(ready.networkCalls, 0);
assert.equal(ready.secretsDisplayed, false);
assert.ok(ready.checks.every(item => item.status === 'PASS'));
assert.equal(JSON.stringify(ready).includes('synthetic-secret'), false);

const missingAuditDurability = evaluateDeploymentPreflight({
  env: { ...goodEnv, MIRA_AUDIT_DURABLE_STORAGE_CONFIRMED: '' },
  nodeVersion: 'v24.18.0',
  providerRuntime: { provider: 'gemini', model: '' }
});
assert.equal(missingAuditDurability.status, 'BLOCKED');
assert.equal(missingAuditDurability.checks.find(item => item.name === 'AUDIT_DURABILITY').status, 'FAIL');

const localEphemeral = evaluateDeploymentPreflight({
  env: { ...goodEnv, MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND: 'local' },
  nodeVersion: 'v24.18.0',
  providerRuntime: { provider: 'gemini', model: '' }
});
assert.equal(localEphemeral.status, 'BLOCKED');
assert.equal(localEphemeral.checks.find(item => item.name === 'ARCHIVE_DURABILITY').status, 'FAIL');

const missingTavily = evaluateDeploymentPreflight({
  env: { ...goodEnv, TAVILY_API_KEY: '' },
  nodeVersion: 'v24.18.0',
  providerRuntime: { provider: 'gemini', model: '' }
});
assert.equal(missingTavily.status, 'BLOCKED');
assert.equal(missingTavily.checks.find(item => item.name === 'TAVILY_API_KEY').status, 'FAIL');

const openAiMissingModel = evaluateDeploymentPreflight({
  env: { ...goodEnv, OPENAI_API_KEY: 'openai-synthetic-secret' },
  nodeVersion: 'v24.18.0',
  providerRuntime: { provider: 'openai', model: '' }
});
assert.equal(openAiMissingModel.status, 'BLOCKED');
assert.equal(openAiMissingModel.checks.find(item => item.name === 'AI_PROVIDER_MODEL').status, 'FAIL');

const openAiReady = evaluateDeploymentPreflight({
  env: { ...goodEnv, OPENAI_API_KEY: 'openai-synthetic-secret' },
  nodeVersion: 'v24.18.0',
  providerRuntime: { provider: 'openai', model: 'gpt-4.1-mini' }
});
assert.equal(openAiReady.status, 'READY_FOR_LIVE_TEST');

const custom = evaluateDeploymentPreflight({
  env: goodEnv,
  nodeVersion: 'v24.18.0',
  providerRuntime: { provider: 'custom', model: 'custom-model' }
});
assert.equal(custom.status, 'REVIEW_REQUIRED');
assert.equal(custom.networkCalls, 0);

const invalidSupabase = evaluateDeploymentPreflight({
  env: { ...goodEnv, SUPABASE_URL: 'http://localhost:54321' },
  nodeVersion: 'v24.18.0',
  providerRuntime: { provider: 'gemini', model: '' }
});
assert.equal(invalidSupabase.status, 'BLOCKED');
assert.equal(invalidSupabase.checks.find(item => item.name === 'SUPABASE_ARCHIVE_CONFIG').status, 'FAIL');

console.log('HFM_PHASE6_DEPLOYMENT_PREFLIGHT_SECRET_REDACTION=PASS');
console.log('HFM_PHASE6_DEPLOYMENT_PREFLIGHT_SUPABASE_CONFIG_VALIDATION=PASS');
console.log('HFM_PHASE6_DEPLOYMENT_PREFLIGHT_EPHEMERAL_STORAGE_BLOCK=PASS');
console.log('HFM_PHASE6_DEPLOYMENT_PREFLIGHT_AUDIT_DURABILITY_BLOCK=PASS');
console.log('HFM_PHASE6_DEPLOYMENT_PREFLIGHT_MISSING_PROVIDER_KEY_BLOCK=PASS');
console.log('HFM_PHASE6_DEPLOYMENT_PREFLIGHT_OPENAI_MODEL_REQUIRED=PASS');
console.log('HFM_PHASE6_DEPLOYMENT_PREFLIGHT_CUSTOM_PROVIDER_REVIEW=PASS');
console.log('LIVE_NETWORK_REQUESTS=0');
console.log('TESTS_FAILED=0');
