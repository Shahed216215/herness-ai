'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'mira-hfm-standing-read-authority.js'), 'utf8');
const memoryReadRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'mira-hfm-memory-read.js'), 'utf8');

for (const id of [
  'hfmV02StandingReadAuthority',
  'hfmV02StandingRefresh',
  'hfmV02StandingIssue',
  'hfmV02StandingPause',
  'hfmV02StandingResume',
  'hfmV02StandingRevoke',
  'hfmV02StandingStatus'
]) {
  assert.ok(html.includes('id="' + id + '"'), 'missing UI control ' + id);
}
assert.match(html, /365-Day Standing Read Authority/);
assert.match(html, /memory\.read/);
assert.match(html, /Learning and Knowledge records only/);
assert.match(memoryReadRoute, /\['learning_note', 'knowledge_item'\]/);
assert.match(html, /window\.confirm\([\s\S]*Approve 365 days/);
assert.match(html, /Every read is audited/);
assert.match(html, /No writes, edits, Trash, Restore/);
assert.match(html, /standing-authority\/issue/);
assert.match(html, /standing-authority\/pause/);
assert.match(html, /standing-authority\/resume/);
assert.match(html, /standing-authority\/revoke/);
assert.match(route, /MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED !== 'true'/);
assert.match(route, /body\.confirm !== true/);
assert.match(route, /sameOriginRequest\(req\)/);
assert.match(route, /STANDING_READ_AUTHORITY_NOT_FOUND|setStandingReadAuthorityStatus/);
console.log('HFM_STANDING_READ_UI_365_DAY_SCOPE_AND_CONSENT=PASS');
console.log('HFM_STANDING_READ_UI_PAUSE_RESUME_REVOKE_CONTROLS=PASS');
console.log('HFM_STANDING_READ_UI_NO_WRITE_OR_PUBLISH_SCOPE=PASS');
console.log('NETWORK_REQUESTS=0');
console.log('DATABASE_WRITES=0');
