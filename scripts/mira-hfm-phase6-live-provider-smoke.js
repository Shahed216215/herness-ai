'use strict';

const { parseResults } = require('../services/mira-hfm-public-web-retrieval');

const LIVE_QUERY = 'Mira HFM public web retrieval provider connectivity smoke test';

function safeErrorCode(error) {
  const value = String(error && (error.code || error.name) || 'PROVIDER_ERROR');
  return /^[A-Za-z0-9_-]{1,48}$/.test(value) ? value : 'PROVIDER_ERROR';
}

async function runProviderSmoke({
  confirmLive = false,
  apiKey = process.env.TAVILY_API_KEY,
  searchWeb = query => require('../tools/web-search').execute({ query })
} = {}) {
  if (confirmLive !== true) {
    return {
      status: 'NOT_RUN',
      reason: 'EXPLICIT_LIVE_CONFIRMATION_REQUIRED',
      networkCalls: 0,
      archiveWrites: 0,
      canonicalMemoryWrites: 0
    };
  }

  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return {
      status: 'BLOCKED',
      reason: 'TAVILY_API_KEY_NOT_CONFIGURED',
      networkCalls: 0,
      archiveWrites: 0,
      canonicalMemoryWrites: 0
    };
  }

  try {
    const raw = await searchWeb(LIVE_QUERY);
    const results = parseResults(raw);
    const safeHosts = [...new Set(results.slice(0, 5).map(item => {
      try {
        const url = new URL(item && (item.url || item.link) || '');
        return url.protocol === 'https:' ? url.hostname.toLowerCase() : 'NON_HTTPS_RESULT';
      } catch {
        return 'INVALID_RESULT_URL';
      }
    }))];
    return {
      status: results.length ? 'LIVE_PROVIDER_CONNECTED' : 'LIVE_PROVIDER_CONNECTED_NO_RESULTS',
      provider: 'tavily',
      networkCalls: 1,
      resultCount: results.length,
      inspectedResultHosts: safeHosts,
      archiveStatus: 'NOT_REQUESTED',
      archiveWrites: 0,
      canonicalMemoryWrites: 0
    };
  } catch (error) {
    return {
      status: 'LIVE_PROVIDER_FAILED',
      provider: 'tavily',
      networkCalls: 1,
      errorCode: safeErrorCode(error),
      archiveWrites: 0,
      canonicalMemoryWrites: 0
    };
  }
}

if (require.main === module) {
  runProviderSmoke({ confirmLive: process.argv.includes('--confirm-live') })
    .then(result => {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (result.status === 'LIVE_PROVIDER_FAILED' || result.status === 'BLOCKED') {
        process.exitCode = 1;
      }
    })
    .catch(() => {
      process.stdout.write(JSON.stringify({
        status: 'INCONCLUSIVE',
        reason: 'SMOKE_RUNNER_FAILURE',
        networkCalls: 0
      }) + '\n');
      process.exitCode = 1;
    });
}

module.exports = { runProviderSmoke, LIVE_QUERY };
