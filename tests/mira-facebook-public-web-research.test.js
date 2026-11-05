'use strict';
const assert = require('node:assert/strict');
const {
  validatePageId, validateFacebookUrl, buildFacebookPageResearchQueries,
  collectPublicFacebookPageEvidence, buildEvidenceContext
} = require('../services/mira-facebook-public-web-research');
const { createTool } = require('../tools/facebook-page-research');

(async () => {
  const pageId = '118056109579206';
  assert.equal(validatePageId(pageId), pageId);
  assert.throws(() => validatePageId('online-canel'), /numeric/);
  assert.equal(validateFacebookUrl('https://www.facebook.com/onlinecanel/?ref=share'), 'https://www.facebook.com/onlinecanel');
  assert.throws(() => validateFacebookUrl('https://facebook.com.evil.test/118'), /HTTPS Facebook URL/);
  assert.throws(() => validateFacebookUrl('http://facebook.com/118'), /HTTPS Facebook URL/);
  const queries = buildFacebookPageResearchQueries({ pageId, pageName: 'Online canel' });
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => query.includes(pageId)));
  const calls = [];
  const report = await collectPublicFacebookPageEvidence({
    pageId, pageName: 'Online canel', observedAt: '2026-11-05T00:00:00.000Z',
    searchWeb: async query => {
      calls.push(query);
      return JSON.stringify([
        { title: 'Online canel Page ' + pageId, link: 'https://www.facebook.com/' + pageId, snippet: 'Public page result for ' + pageId },
        { title: 'Page post', url: 'https://www.facebook.com/' + pageId + '/posts/123456', content: 'Public indexed post for ' + pageId },
        { title: 'Wrong Page', url: 'https://www.facebook.com/other/posts/987', content: 'Not the requested page' },
        { title: 'Spoofed Page Post', url: 'https://www.facebook.com/other/posts/999', content: 'This unrelated result mentions Page ID ' + pageId },
        { title: 'Lookalike', url: 'https://facebook.com.evil.test/' + pageId, content: 'spoof' },
        { title: 'Group', url: 'https://www.facebook.com/groups/123', content: pageId }
      ]);
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(report.status, 'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED');
  assert.equal(report.evidence.length, 2);
  assert.deepEqual(report.evidence.map(item => item.sourceType), ['FACEBOOK_PAGE_PROFILE', 'FACEBOOK_PAGE_POST']);
  assert.ok(report.evidence.every(item => item.pageId === pageId));
  assert.ok(report.evidence.every(item => item.integrityStatus === 'UNVERIFIED'));
  assert.equal(report.limits.directFacebookFetches, 0);
  assert.equal(report.limits.metaGraphApiCalls, 0);
  assert.equal(report.limits.loginOrCookieUse, 0);
  assert.equal(report.limits.canonicalMemoryWrite, false);
  assert.equal(report.limits.mayEnterTrustedMemory, false);
  assert.equal(buildEvidenceContext(report).length, 2);
  await assert.rejects(() => collectPublicFacebookPageEvidence({ pageId, searchWeb: null }), /provider function/);
  await assert.rejects(() => collectPublicFacebookPageEvidence({ pageId, searchWeb: async () => [], maxResults: 11 }), /between 1 and 10/);
  await assert.rejects(() => collectPublicFacebookPageEvidence({ pageId, searchWeb: async () => [], observedAt: '2099-01-01T00:00:00.000Z' }), /future/);
  const unavailable = await collectPublicFacebookPageEvidence({ pageId, searchWeb: async () => 'Tavily API key is missing.' });
  assert.equal(unavailable.status, 'SEARCH_PROVIDER_UNAVAILABLE');
  assert.equal(unavailable.limits.canonicalMemoryWrite, false);
  const toolCalls = [];
  const tool = createTool({ searchWeb: async query => {
    toolCalls.push(query);
    return JSON.stringify([{ title: 'Online canel ' + pageId, url: 'https://www.facebook.com/' + pageId, snippet: 'Indexed Page ' + pageId }]);
  }});
  const toolResult = JSON.parse(await tool.execute({}));
  assert.equal(toolResult.page.pageId, pageId);
  assert.equal(toolResult.status, 'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED');
  assert.equal(toolResult.limits.mayEnterTrustedMemory, false);
  assert.equal(toolCalls.length, 2);
  console.log('FACEBOOK_PUBLIC_WEB_SEARCH_ID_BINDING_AND_UNTRUSTED_EVIDENCE_PASS=PASS');
  console.log('DIRECT_FACEBOOK_FETCHES=0');
  console.log('META_GRAPH_API_CALLS=0');
  console.log('LOGIN_OR_COOKIE_USE=0');
  console.log('CANONICAL_MEMORY_WRITES=0');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_FACEBOOK_PUBLIC_WEB_RESEARCH_CONTRACT_PASS');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
