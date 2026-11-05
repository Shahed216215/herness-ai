'use strict';

const assert = require('node:assert/strict');
const { resolveServerBindHost } = require('../services/mira-server-bind-host');

assert.equal(resolveServerBindHost({ NODE_ENV: 'production' }), '0.0.0.0');
assert.equal(resolveServerBindHost({ NODE_ENV: 'Production' }), '0.0.0.0');
assert.equal(resolveServerBindHost({ NODE_ENV: 'development' }), '127.0.0.1');
assert.equal(resolveServerBindHost({}), '127.0.0.1');
assert.equal(resolveServerBindHost(null), '127.0.0.1');

console.log('MIRA_PRODUCTION_BIND_HOST_PLATFORM_REACHABLE=PASS');
console.log('MIRA_LOCAL_BIND_HOST_LOOPBACK_ONLY=PASS');
console.log('LIVE_NETWORK_REQUESTS=0');
console.log('TESTS_FAILED=0');
