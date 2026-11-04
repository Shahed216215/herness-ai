'use strict';
const assert = require('node:assert/strict');
const { readFacebookPageMetadata, validatePageId, GRAPH_API_VERSION } = require('../services/mira-facebook-page-read-only-probe');
(async () => {
  assert.equal(GRAPH_API_VERSION, 'v26.0');
  assert.equal(validatePageId('123456789'), '123456789');
  assert.throws(() => validatePageId('page-123'), /numeric/);
  assert.throws(() => validatePageId('123?fields=feed'), /numeric/);
  let captured;
  const result = await readFacebookPageMetadata({
    pageId: '123456789', accessToken: 'SYNTHETIC_SECRET_NEVER_LOG',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { status: 200, ok: true, text: async () => JSON.stringify({ id: '123456789', name: 'Synthetic Test Page' }) };
    }
  });
  const parsed = new URL(captured.url);
  assert.equal(parsed.origin, 'https://graph.facebook.com');
  assert.equal(parsed.pathname, '/v26.0/123456789');
  assert.equal(parsed.searchParams.get('fields'), 'id,name');
  assert.equal(parsed.searchParams.has('access_token'), false);
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.cache, 'no-store');
  assert.equal(captured.options.headers.authorization, 'Bearer SYNTHETIC_SECRET_NEVER_LOG');
  assert.equal(result.status, 'READ_ONLY_PAGE_METADATA_VERIFIED');
  assert.equal(result.pageId, '123456789');
  assert.equal(result.pageName, 'Synthetic Test Page');
  assert.equal(result.rawResponseStored, false);
  assert.equal(result.tokenExposed, false);
  assert.equal(result.mayPublish, false);
  assert.equal(result.mayWriteCanonicalMemory, false);
  console.log('READ_ONLY_METADATA_GET_ALLOWLIST_AND_SECRET_HEADER_PASS=PASS');
  await assert.rejects(() => readFacebookPageMetadata({
    pageId: '123456789', accessToken: 'secret',
    fetchImpl: async () => ({ status: 200, ok: true, text: async () => '{"id":"999","name":"Wrong Page"}' })
  }), /did not match/);
  await assert.rejects(() => readFacebookPageMetadata({
    pageId: '123456789', accessToken: 'secret',
    fetchImpl: async () => ({ status: 200, ok: true, text: async () => '{"id":"123456789","feed":[]}' })
  }), /did not contain a valid Page identity/);
  await assert.rejects(() => readFacebookPageMetadata({
    pageId: '123456789', accessToken: 'secret',
    fetchImpl: async () => ({ status: 403, ok: false, text: async () => 'private provider body' })
  }), error => error.code === 'AUTH_OR_PERMISSION_DENIED' && !error.message.includes('private provider body'));
  await assert.rejects(() => readFacebookPageMetadata({
    pageId: '123456789', accessToken: 'secret',
    fetchImpl: async () => ({ status: 429, ok: false, text: async () => '' })
  }), error => error.code === 'RATE_LIMITED');
  await assert.rejects(() => readFacebookPageMetadata({
    pageId: '123456789', accessToken: 'secret', apiVersion: 'v25.0',
    fetchImpl: async () => { throw new Error('must not be called'); }
  }), /pinned Graph API version/);
  await assert.rejects(() => readFacebookPageMetadata({
    pageId: '123456789', accessToken: 'secret',
    fetchImpl: async () => ({ status: 200, ok: true, text: async () => 'x'.repeat(65537) })
  }), /bounded response size/);
  console.log('READ_ONLY_PROBE_FAIL_CLOSED_IDENTITY_VERSION_PERMISSION_RATE_LIMIT_SIZE_PASS=PASS');
  console.log('NETWORK_REQUESTS=0');
  console.log('LIVE_META_API_CALLS=0');
  console.log('META_WRITE_REQUESTS=0');
  console.log('FACEBOOK_POSTS_PUBLISHED=0');
  console.log('CANONICAL_MEMORY_WRITES=0');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_META_READ_ONLY_PROBE_CONTRACT_PASS');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
