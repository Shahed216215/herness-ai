'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('public/mira-hfm-knowledge.html', 'utf8');
const nav = fs.readFileSync('public/index.html', 'utf8');

test('Facebook Knowledge UI exposes import, public research, search, view, update, trash, restore and history controls', () => {
  for (const id of ['importBtn','researchBtn','searchBtn','viewBtn','updateBtn','deleteBtn','restoreBtn','historyBtn']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const route of ['/api/hfm/facebook-knowledge/import','/api/hfm/facebook-knowledge/research','/api/hfm/facebook-knowledge/search','/api/hfm/facebook-knowledge/history']) {
    assert.ok(html.includes(route), 'missing API integration: ' + route);
  }
  assert.match(html, /\/api\/hfm\/authorities\/issue/);
  assert.match(nav, /mira-hfm-knowledge\.html/);
});

test('UI uses same-origin authenticated requests and does not contain Facebook API or login automation', () => {
  assert.match(html, /credentials: 'same-origin'/);
  assert.doesNotMatch(html, /graph\.facebook\.com|access_token|facebook\.com\/login|document\.cookie/i);
  assert.match(html, /single-use authority|single-use/i);
});

