'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const route = fs.readFileSync(path.join(root, 'routes/mira-hfm-learning-evolution.js'), 'utf8');

for (const id of [
  'miraHfmProposalReviewPanel','miraHfmRefreshStatus','miraHfmBridgeStatus',
  'miraHfmProjectId','miraHfmProposalId','miraHfmLoadProposal',
  'miraHfmProposalDetails','miraHfmReviewReason','miraHfmApproveHandoff',
  'miraHfmRejectProposal','miraHfmAgentProposalOptIn','miraHfmStageTitle',
  'miraHfmStageRationale','miraHfmStageChange'
]) {
  assert.match(html, new RegExp('id="' + id + '"'), 'Missing HFM UI control: ' + id);
}

assert.match(html, /\/api\/admin\/mira-hfm-learning-evolution\/status/);
assert.match(html, /\/api\/admin\/mira-hfm-learning-evolution\/proposals\//);
assert.match(html, /APPROVE_FOR_MANUAL_HANDOFF/);
assert.match(html, /decision,reason/);
assert.match(html, /payload\.learningProposalOptIn = true/);
assert.match(html, /payload\.learningProposal =/);
assert.match(html, /miraHfmAgentProposalOptIn\.checked = false/);
assert.match(html, /data\.learningProposalHandoff\.success === true/);
assert.match(html, /window\.confirm\(confirmation\)/);
assert.match(html, /manual handoff only/i);
assert.match(html, /miraHfmApproveHandoff\.disabled = !reviewable/);
assert.match(html, /miraHfmRejectProposal\.disabled = !reviewable/);

const start = html.indexOf('    const miraHfmRefreshStatus =');
const end = html.indexOf('    function renderAutonomousProposal(proposal)', start);
assert.ok(start >= 0 && end > start, 'HFM review UI script block must exist');
const uiScript = html.slice(start, end);
assert.doesNotMatch(uiScript, /appendMiraHfmProposal/);
assert.doesNotMatch(uiScript, /innerHTML\s*=/, 'HFM review details must use safe DOM text rendering');
new vm.Script(uiScript, { filename:'public/index.html#hfm-learning-ui' });

assert.match(route, /router\.get\('\/status'/);
assert.match(route, /requireNamedAdminSession\(req, res\)/);
assert.match(route, /canonicalMemoryWrites:0/);
assert.match(route, /automaticExecution:false/);
assert.match(route, /productionReady:isProduction && productionReady && !!bridge/);

console.log('HFM_PHASE8_UI_PANEL_PRESENT=PASS');
console.log('HFM_PHASE8_UI_STATUS_AND_PROPOSAL_LOOKUP=PASS');
console.log('HFM_PHASE8_UI_IMMUTABLE_REVIEW_ACTIONS=PASS');
console.log('HFM_PHASE8_UI_SAFE_TEXT_RENDERING=PASS');
console.log('HFM_PHASE8_UI_SCRIPT_SYNTAX=PASS');
console.log('HFM_PHASE8_UI_STATUS_ROUTE_ADMIN_GUARD=PASS');
console.log('TESTS_FAILED=0');
