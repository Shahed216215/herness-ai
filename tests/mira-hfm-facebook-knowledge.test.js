'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeFacebookUrl,
  redactSensitiveText,
  buildKnowledgeRecord,
  tokenize
} = require('../services/mira-hfm-facebook-knowledge');
const { validateCanonicalRecord } = require('../services/mira-hfm-record-schema');

test('accepts only HTTPS Facebook Page and Group URLs without credentials or fragments', () => {
  assert.equal(normalizeFacebookUrl('https://m.facebook.com/example.page/?ref=share'), 'https://www.facebook.com/example.page');
  assert.throws(() => normalizeFacebookUrl('http://facebook.com/example'), /HFM_FACEBOOK_SOURCE_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeFacebookUrl('https://facebook.com.evil.example/page'), /HFM_FACEBOOK_SOURCE_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeFacebookUrl('https://user:pass@facebook.com/page'), /HFM_FACEBOOK_SOURCE_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeFacebookUrl('https://facebook.com/page#private'), /HFM_FACEBOOK_SOURCE_URL_NOT_ALLOWED/);
});

test('redacts common contact and amount patterns before persistence', () => {
  const result = redactSensitiveText('Contact test@example.com or +880 1712-345678. Paid BDT 1500.');
  assert.equal(result.redacted, true);
  assert.doesNotMatch(result.content, /test@example\.com|1712-345678|BDT 1500/);
});

test('creates PUBLIC source-attributed v1.1 knowledge record with explicit unverified provenance', () => {
  const record = buildKnowledgeRecord({
    memoryId: 'fbk_test_00000001',
    projectId: 'project-001',
    sourceType: 'facebook_page',
    sourceId: 'Example Page',
    sourceUrl: 'https://www.facebook.com/example.page',
    content: 'বাংলাদেশে প্রযুক্তি শিক্ষা ও AI নিয়ে আলোচনা',
    collectionMethod: 'manual_copy',
    publicContentConfirmed: true,
    now: '2026-11-07T00:00:00.000Z'
  });
  assert.equal(validateCanonicalRecord(record).valid, true);
  assert.equal(record.access.classification, 'PUBLIC');
  assert.equal(record.lifecycle, 'ACTIVE');
  assert.equal(record.trust.status, 'SOURCE_RECORDED');
  assert.equal(record.integrity.status, 'UNVERIFIED');
  assert.equal(record.provenance.verificationStatus, 'SOURCE_RECORDED');
  assert.deepEqual(record.access.allowedProjectIds, ['project-001']);
});

test('rejects unsupported source kinds and invalid content', () => {
  assert.throws(() => buildKnowledgeRecord({
    projectId: 'project-001', sourceType: 'facebook_group_private',
    content: 'content'
  }), /HFM_KNOWLEDGE_SCOPE_OR_SOURCE_INVALID/);
  assert.throws(() => buildKnowledgeRecord({
    projectId: 'project-001', sourceType: 'manual', publicContentConfirmed: true,
    content: ''
  }), /HFM_KNOWLEDGE_CONTENT_INVALID/);
});


test('public search fallback uses a fixed web-search endpoint and filters non-Facebook results', async () => {
  let calledUrl = null;
  let requestBody = null;
  const result = await require('../services/mira-hfm-facebook-knowledge').researchFacebookSource({
    sourceUrl: 'https://facebook.com/example.page',
    apiKey: 'synthetic-test-key',
    fetchImpl: async (url, options) => {
      calledUrl = url;
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          results: [
            { title: 'Public post', url: 'https://www.facebook.com/example.page/posts/123', content: 'Indexed public snippet' },
            { title: 'Outside domain', url: 'https://evil.example/post', content: 'Must be excluded' }
          ]
        })
      };
    }
  });
  assert.equal(calledUrl, 'https://api.tavily.com/search');
  assert.equal(requestBody.include_domains[0], 'facebook.com');
  assert.equal(result.status, 'SEARCH_RESULTS_FOUND');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].verificationStatus, 'SOURCE_RECORDED');
});

test('missing web-search provider returns manual-import fallback without making a request', async () => {
  const result = await require('../services/mira-hfm-facebook-knowledge').researchFacebookSource({
    sourceUrl: 'https://www.facebook.com/example.page',
    apiKey: ''
  });
  assert.equal(result.status, 'SEARCH_PROVIDER_NOT_CONFIGURED');
  assert.equal(result.fallback, 'MANUAL_IMPORT_REQUIRED');
  assert.deepEqual(result.results, []);
});
test('tokenizer handles Bengali and English Unicode terms', () => {
  assert.deepEqual(tokenize('AI প্রযুক্তি এবং Python'), ['ai', 'প্রযুক্তি', 'এবং', 'python']);
});
