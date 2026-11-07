'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('public/mira-hfm-knowledge.html', 'utf8');
const nav = fs.readFileSync('public/index.html', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

test('Facebook Knowledge UI exposes import, public research, search, view, update, trash, restore and history controls', () => {
  for (const id of ['importBtn','researchBtn','searchBtn','viewBtn','updateBtn','deleteBtn','restoreBtn','historyBtn']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const route of ['/api/hfm/facebook-knowledge/import','/api/hfm/facebook-knowledge/research','/api/hfm/facebook-knowledge/search','/api/hfm/facebook-knowledge/history']) {
    assert.ok(html.includes(route), 'missing API integration: ' + route);
  }
  assert.match(html, /\/api\/hfm\/authorities\/issue/);
  assert.match(nav, /mira-hfm-knowledge\.html/);
  assert.match(server, /registerFacebookKnowledgeRoutes\(app, requireAgentAuth/);
  assert.match(server, /registerHfmProjectRoutes\(app, requireAgentAuth/);
  assert.match(server, /registerDailyKnowledgeRoutes\(app, requireAgentAuth\)/);
});

test('manual Facebook draft workflow is wired to Neon with text-only clipboard and exact-record actions', () => {
  for (const id of ['loadSocialPostsBtn','socialPostArchive','socialPostStatus']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /navigator\.clipboard\.writeText\(draft\.content\)/);
  assert.match(html, /COPY_FAILED/);
  assert.match(html, /social-post-archive-read/);
  assert.match(html, /memory\.social_post\.copy/);
  assert.match(html, /memory\.social_post\.confirm_published/);
  assert.match(html, /memory\.social_post\.delete_payload/);
  assert.match(html, /USER_CONFIRMED_PUBLISHED/);
  assert.match(html, /DELETE_STATUS_UNKNOWN/);
  assert.match(html, /Delete Draft Payload/);
  assert.match(html, /draft\.memoryId/);
  assert.match(html, /draft\.source/);
  assert.match(html, /draft\.createdAt/);
  assert.match(html, /payloadErased/);
  assert.match(html, /not Facebook-verified/);
  assert.match(html, /No Facebook publishing occurs/);
  assert.doesNotMatch(html, /graph\.facebook\.com|access_token|facebook\.com\/login|document\.cookie/i);
});

test('UI uses same-origin authenticated requests and does not contain Facebook API or login automation', () => {
  assert.match(html, /credentials: 'same-origin'/);
  assert.doesNotMatch(html, /graph\.facebook\.com|access_token|facebook\.com\/login|document\.cookie/i);
  assert.match(html, /single-use authority|single-use/i);
  assert.match(html, /id="createProjectBtn"/);
  assert.match(html, /id="dailyGenerateBtn"/);
  assert.match(html, /\/api\/hfm\/daily-knowledge\/generate/);
  assert.match(html, /\/api\/hfm\/projects\/create/);
  assert.match(html, /\/api\/hfm\/projects\/active/);
  assert.match(html, /id="sourceFile"/);
  assert.match(html, /Import this evidence to Neon/);
  assert.match(html, /collectionMethod: 'public_url_preview'/);
  assert.match(html, /importFileName:/);
  assert.match(html, /originalPublishedAt: item\.publishedAt/);
  assert.match(html, /id="publishedAt"/);
  assert.match(html, /id="recordMeta"/);
  assert.match(html, /Verification:/);
  assert.match(html, /originalPublishedAt/);
  assert.match(html, /id="publicConfirm"/);
  assert.match(html, /publicContentConfirmed: \$\('publicConfirm'\)\.checked/);
});

