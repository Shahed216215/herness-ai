'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const helper = fs.readFileSync(
  'scripts/mira-bug-hunter-evidence-audit.js', 'utf8'
);
const scanner = fs.readFileSync(
  'scripts/mira-bug-hunter.js', 'utf8'
);

assert.match(helper, /MIRA_BH_HELPER_TIMEOUT_ALIGNMENT_V1/);
assert.match(helper, /timeout:\s*65000/);
assert.match(scanner, /MIRA_BUG_HUNTER_SCAN_BUDGET_MS/);
assert.match(helper, /status:\s*'INCONCLUSIVE'/);
assert.match(helper, /check:\s*summaryPlaceholder\(\)/);
assert.match(helper, /!registry/);
assert.match(helper, /Scanner registry was unavailable/);

console.log('ASSERTIONS_PASSED=7');
console.log('HELPER_CONTRACT_TEST=PASS');
