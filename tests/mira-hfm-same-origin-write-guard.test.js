'use strict';

const assert = require('node:assert/strict');
const { createMiraHfmSameOriginWriteGuard } =
  require('../services/security/mira-hfm-same-origin-write-guard');

function invoke(guard, { method='POST', headers={}, protocol='https', host='mira.example' } = {}) {
  let nextCalls = 0;
  const requestHeaders = { ...headers, host: headers.host || host };
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  guard({ method, headers: requestHeaders, protocol, get(name) { return requestHeaders[name.toLowerCase()]; } },
    response, () => { nextCalls++; });
  return { response, nextCalls };
}

const env = { MIRA_HFM_LEARNING_ALLOWED_ORIGINS: 'https://admin.example, https://mira.example' };
const guard = createMiraHfmSameOriginWriteGuard({ env });

let result = invoke(guard, { headers: { origin: 'https://mira.example', referer: 'https://mira.example/admin', 'sec-fetch-site': 'same-origin' } });
assert.equal(result.nextCalls, 1);
assert.equal(result.response.statusCode, 200);

result = invoke(guard, { headers: { origin: 'https://evil.example', referer: 'https://evil.example/attack', 'sec-fetch-site': 'cross-site' } });
assert.equal(result.nextCalls, 0);
assert.equal(result.response.statusCode, 403);
assert.equal(result.response.body.code, 'HFM_LEARNING_CSRF_ORIGIN_REJECTED');

result = invoke(guard, { headers: { origin: 'https://mira.example.attacker.test' } });
assert.equal(result.nextCalls, 0);

result = invoke(guard, { headers: { origin: 'null' } });
assert.equal(result.nextCalls, 0);

result = invoke(guard, { headers: {} });
assert.equal(result.nextCalls, 0);

result = invoke(guard, { headers: { origin: 'https://mira.example', referer: 'https://evil.example/path' } });
assert.equal(result.nextCalls, 0);

result = invoke(guard, { headers: { origin: 'https://admin.example', 'sec-fetch-site': 'same-site' } });
assert.equal(result.nextCalls, 1);

result = invoke(guard, { method: 'GET', headers: {} });
assert.equal(result.nextCalls, 1);

const noConfig = createMiraHfmSameOriginWriteGuard({ env: {} });
result = invoke(noConfig, { headers: { origin: 'https://mira.example' } });
assert.equal(result.nextCalls, 1, 'exact request same-origin remains allowed without an explicit list');

console.log('HFM_PHASE8_CSRF_SAME_ORIGIN_POST_ALLOWED=PASS');
console.log('HFM_PHASE8_CSRF_CROSS_SITE_POST_BLOCKED=PASS');
console.log('HFM_PHASE8_CSRF_ORIGIN_SUFFIX_CONFUSION_BLOCKED=PASS');
console.log('HFM_PHASE8_CSRF_OPAQUE_ORIGIN_BLOCKED=PASS');
console.log('HFM_PHASE8_CSRF_MISSING_ORIGIN_AND_REFERER_BLOCKED=PASS');
console.log('HFM_PHASE8_CSRF_ORIGIN_REFERER_MISMATCH_BLOCKED=PASS');
console.log('HFM_PHASE8_CSRF_EXPLICIT_CUSTOM_ORIGIN_ALLOWLIST=PASS');
console.log('HFM_PHASE8_CSRF_READ_ONLY_GET_UNCHANGED=PASS');
console.log('TESTS_FAILED=0');
