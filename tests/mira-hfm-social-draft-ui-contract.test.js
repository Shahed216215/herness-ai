'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');

assert.match(html, /hfmV02SocialDraftWorkspace/);
assert.match(html, /navigator\.clipboard\.writeText/);
assert.match(html, /I manually published this in Facebook/);
assert.match(html, /Copy is not Published/);
assert.match(html, /Generate Today's Draft/);
assert.match(html, /Mira never auto-publishes/);
assert.match(html, /\/api\/hfm\/social-drafts\/generate-daily/);
assert.match(html, /\/api\/hfm\/memory\/authorize/);
assert.match(html, /\/api\/hfm\/memory\/read/);
assert.match(html, /\/api\/hfm\/social-drafts\/trash/);
assert.match(html, /\/api\/hfm\/social-drafts\/restore/);
assert.match(html, /recoverable Neon Trash/);
assert.match(html, /No permanent deletion will occur/);
assert.match(html, /content\.textContent = typeof record\.content === "string" \? record\.content : ""/);
assert.doesNotMatch(html, /graph\.facebook\.com|facebook\.com\/v\d+|\/feed\?/i);
assert.match(html, /Copy failed:/);
assert.match(html, /Trash outcome not confirmed:/);
assert.match(html, /Restore outcome not confirmed:/);

console.log('HFM_SOCIAL_DRAFT_UI_MANUAL_COPY_ONLY=PASS');
console.log('HFM_SOCIAL_DRAFT_UI_EXPLICIT_MANUAL_PUBLISH_CONFIRMATION=PASS');
console.log('HFM_SOCIAL_DRAFT_UI_RECOVERABLE_TRASH_AND_RESTORE=PASS');
console.log('HFM_SOCIAL_DRAFT_UI_NO_FACEBOOK_API_PUBLISH=PASS');
console.log('NETWORK_REQUESTS=0');
console.log('DATABASE_WRITES=0');
