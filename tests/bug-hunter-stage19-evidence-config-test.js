'use strict';
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('scripts/mira-bug-hunter.js', 'utf8');
assert(source.includes('MIRA_BH_CONFIGURABLE_STAGE19_EVIDENCE_V1'));
assert(source.includes('MIRA_BUG_HUNTER_STAGE19_EVIDENCE_PATH'));
assert(source.includes('reports/stage19-security-evidence.json'));
assert(!source.includes(
  'backups/stage19-live-injection-eval-20261012-074100/LIVE-EVALUATION.txt'
));
assert(source.includes('Evidence is missing required PASS markers, stale, or incomplete'));
assert(source.includes('EVIDENCE_TEST_RESULT=PASS'));
assert(source.includes('ATTACHMENT_SECURITY=PASS'));
assert(source.includes('OUTBOUND_NETWORK_COVERAGE=PASS'));
assert(source.includes('MIRA_BUG_HUNTER_STAGE19_EVIDENCE_MAX_AGE_MS'));
assert(source.includes('Configured Stage 19 evidence path is invalid'));
console.log('STAGE19_EVIDENCE_CONFIG_ASSERTIONS=10');
console.log('STAGE19_EVIDENCE_CONFIG_STATUS=PASS');
