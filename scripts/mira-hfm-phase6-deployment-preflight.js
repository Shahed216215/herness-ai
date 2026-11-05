'use strict';

const { resolveServerBindHost } = require('../services/mira-server-bind-host');

const PROVIDER_ENV_KEYS = Object.freeze({
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  xai: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  huggingface: 'HF_TOKEN'
});

function addCheck(checks, name, status, reason) {
  checks.push({ name, status, reason });
}

function evaluateDeploymentPreflight({
  env = process.env,
  nodeVersion = process.version,
  providerRuntime,
  openAiCredentialConfigured = false,
  openAiModelConfigured = false
} = {}) {
  const checks = [];
  const nodeMajor = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  addCheck(checks, 'NODE_RUNTIME', nodeMajor >= 24 ? 'PASS' : 'FAIL',
    nodeMajor >= 24 ? 'Node.js 24 or newer.' : 'Node.js 24 or newer is required by the Phase 6 workflow.');

  const production = env.NODE_ENV === 'production';
  addCheck(checks, 'NODE_ENV', production ? 'PASS' : 'FAIL',
    production ? 'Production mode is enabled.' : 'NODE_ENV must be production before Render live validation.');

  const sessionSecretOk = typeof env.MIRA_SESSION_SECRET === 'string' && env.MIRA_SESSION_SECRET.length >= 32;
  addCheck(checks, 'MIRA_SESSION_SECRET', sessionSecretOk ? 'PASS' : 'FAIL',
    sessionSecretOk ? 'Production session secret is configured.' : 'A session secret of at least 32 characters is required; value is never displayed.');

  const bindHost = resolveServerBindHost(env);
  addCheck(checks, 'SERVER_BIND_HOST', bindHost === '0.0.0.0' ? 'PASS' : 'FAIL',
    bindHost === '0.0.0.0' ? 'Production server binds to the platform interface.' : 'Production server is not bound to 0.0.0.0.');

  const tavilyOk = typeof env.TAVILY_API_KEY === 'string' && env.TAVILY_API_KEY.trim().length > 0;
  addCheck(checks, 'TAVILY_API_KEY', tavilyOk ? 'PASS' : 'FAIL',
    tavilyOk ? 'Tavily credential is present; value is hidden.' : 'Tavily credential is not configured; value is never displayed.');

  const runtime = providerRuntime || { provider: env.AI_PROVIDER || 'gemini', model: '' };
  const provider = String(runtime.provider || '').trim().toLowerCase();
  const knownProviders = new Set(['openai', 'anthropic', 'gemini', 'xai', 'groq', 'deepseek', 'openrouter', 'huggingface', 'custom']);
  if (!knownProviders.has(provider)) {
    addCheck(checks, 'AI_PROVIDER', 'FAIL', 'Selected AI provider is unsupported or unknown.');
  } else if (provider === 'custom') {
    addCheck(checks, 'AI_PROVIDER', 'REVIEW_REQUIRED', 'Custom provider credential and model configuration require a manual review.');
  } else {
    const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : PROVIDER_ENV_KEYS[provider];
    const keyOk = provider === 'openai'
      ? openAiCredentialConfigured || (typeof env.OPENAI_API_KEY === 'string' && !!env.OPENAI_API_KEY.trim())
      : typeof env[keyName] === 'string' && !!env[keyName].trim();
    addCheck(checks, 'AI_PROVIDER_CREDENTIAL', keyOk ? 'PASS' : 'FAIL',
      keyOk ? 'Selected provider credential is present; value is hidden.' : 'Selected provider credential is missing; value is never displayed.');
    const modelRequired = ['anthropic', 'xai', 'openai'].includes(provider);
    const modelConfigured = !!(
      runtime.model ||
      (provider === 'anthropic' && env.ANTHROPIC_MODEL) ||
      (provider === 'xai' && env.XAI_MODEL) ||
      (provider === 'openai' && (env.OPENAI_MODEL || openAiModelConfigured))
    );
    if (modelRequired && !modelConfigured) {
      addCheck(checks, 'AI_PROVIDER_MODEL', 'FAIL', 'Selected provider requires an explicit model ID.');
    } else {
      addCheck(checks, 'AI_PROVIDER_MODEL', 'PASS', 'Provider model is available or has a supported default.');
    }
  }

  const backend = String(env.MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND || 'local').trim().toLowerCase();
  if (backend === 'local') {
    const durable = env.MIRA_FACEBOOK_RESEARCH_MEMORY_DURABLE_STORAGE_CONFIRMED === 'true';
    addCheck(checks, 'ARCHIVE_DURABILITY', durable ? 'PASS' : 'FAIL',
      durable ? 'Operator has explicitly confirmed the local archive mount is persistent.' : 'Production local archive is blocked until a persistent mount is verified and explicitly confirmed.');
  } else if (backend === 'supabase') {
    let valid = false;
    try {
      require('../services/mira-facebook-research-memory-provider').validateConfig(env);
      valid = true;
    } catch (_) {}
    addCheck(checks, 'SUPABASE_ARCHIVE_CONFIG', valid ? 'PASS' : 'FAIL',
      valid ? 'Supabase HTTPS project URL and service-role credential are structurally configured; no request was sent.' : 'Supabase archive configuration is missing or invalid; secret values are never displayed.');
  } else {
    addCheck(checks, 'ARCHIVE_BACKEND', 'FAIL', 'Archive backend must be local or supabase.');
  }

  const failures = checks.filter(item => item.status === 'FAIL').length;
  const reviews = checks.filter(item => item.status === 'REVIEW_REQUIRED').length;
  return Object.freeze({
    status: failures ? 'BLOCKED' : reviews ? 'REVIEW_REQUIRED' : 'READY_FOR_LIVE_TEST',
    networkCalls: 0,
    secretsDisplayed: false,
    checks: Object.freeze(checks)
  });
}

if (require.main === module) {
  try {
    const runtime = require('../providers').getRuntimeConfig();
    let openAiCredentialConfigured = false;
    let openAiModelConfigured = false;
    if (runtime.provider === 'openai') {
      try {
        const credential = require('../services/provider-credential-resolver').getCredential('openai');
        openAiCredentialConfigured = !!(credential && credential.key);
        openAiModelConfigured = !!(credential && credential.model);
      } catch (_) {}
    }
    const result = evaluateDeploymentPreflight({ providerRuntime: runtime, openAiCredentialConfigured, openAiModelConfigured });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'READY_FOR_LIVE_TEST') process.exitCode = 1;
  } catch (_) {
    process.stdout.write(JSON.stringify({
      status: 'INCONCLUSIVE',
      networkCalls: 0,
      secretsDisplayed: false,
      reason: 'PREFLIGHT_RUNNER_FAILURE'
    }) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { evaluateDeploymentPreflight };
