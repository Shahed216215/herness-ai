'use strict';

const assert = require('node:assert/strict');
const { runProviderSmoke, LIVE_QUERY } = require('../scripts/mira-hfm-phase6-live-provider-smoke');

(async () => {
  let calls = 0;
  const notRun = await runProviderSmoke({
    confirmLive: false,
    apiKey: 'synthetic-key',
    searchWeb: async () => { calls++; return []; }
  });
  assert.equal(notRun.status, 'NOT_RUN');
  assert.equal(notRun.networkCalls, 0);
  assert.equal(calls, 0);

  const blocked = await runProviderSmoke({
    confirmLive: true,
    apiKey: '',
    searchWeb: async () => { calls++; return []; }
  });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.reason, 'TAVILY_API_KEY_NOT_CONFIGURED');
  assert.equal(blocked.networkCalls, 0);
  assert.equal(calls, 0);

  let observedQuery = '';
  const connected = await runProviderSmoke({
    confirmLive: true,
    apiKey: 'synthetic-key',
    searchWeb: async query => {
      calls++;
      observedQuery = query;
      return JSON.stringify([
        { title: 'Synthetic result', url: 'https://example.org/result', snippet: 'must not be returned' },
        { title: 'Insecure URL', url: 'http://example.net/result', snippet: 'must not be returned' }
      ]);
    }
  });
  assert.equal(connected.status, 'LIVE_PROVIDER_CONNECTED');
  assert.equal(connected.networkCalls, 1);
  assert.equal(connected.resultCount, 2);
  assert.deepEqual(connected.inspectedResultHosts, ['example.org', 'NON_HTTPS_RESULT']);
  assert.equal(connected.archiveWrites, 0);
  assert.equal(connected.canonicalMemoryWrites, 0);
  assert.equal(observedQuery, LIVE_QUERY);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(connected).includes('synthetic-key'), false);
  assert.equal(JSON.stringify(connected).includes('must not be returned'), false);

  const failed = await runProviderSmoke({
    confirmLive: true,
    apiKey: 'synthetic-key',
    searchWeb: async () => { throw Object.assign(new Error('private message'), { code: 'PROVIDER_OFFLINE' }); }
  });
  assert.equal(failed.status, 'LIVE_PROVIDER_FAILED');
  assert.equal(failed.errorCode, 'PROVIDER_OFFLINE');
  assert.equal(JSON.stringify(failed).includes('private message'), false);
  assert.equal(failed.archiveWrites, 0);

  console.log('HFM_PHASE6_LIVE_SMOKE_EXPLICIT_CONFIRMATION_GATE=PASS');
  console.log('HFM_PHASE6_LIVE_SMOKE_MISSING_KEY_FAIL_CLOSED=PASS');
  console.log('HFM_PHASE6_LIVE_SMOKE_SINGLE_CALL_AND_REDACTION=PASS');
  console.log('HFM_PHASE6_LIVE_SMOKE_NO_ARCHIVE_OR_CANONICAL_WRITES=PASS');
  console.log('LIVE_NETWORK_REQUESTS=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
