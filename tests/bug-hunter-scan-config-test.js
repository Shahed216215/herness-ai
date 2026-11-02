'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const scanner = path.resolve('scripts/mira-bug-hunter.js');
const run = spawnSync(process.execPath, [scanner], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 15000,
  maxBuffer: 2 * 1024 * 1024,
  env: {
    ...process.env,
    MIRA_BUG_HUNTER_MAX_ENTRIES: '1',
    MIRA_BUG_HUNTER_MAX_FILES: '1',
    MIRA_BUG_HUNTER_SCAN_BUDGET_MS: '1'
  }
});
const output = String(run.stdout || '') + '\n' + String(run.stderr || '');
assert.equal(run.error, undefined, 'scanner process should finish without spawn error');
assert.match(output, /SCAN_LIMITS=entries:1,files:1,budgetMs:1/);
assert.match(output, /MODE=READ_ONLY/);
assert.match(output, /INCONCLUSIVE=\d+/);
console.log('SCAN_CONFIG_TEST=PASS');
console.log('ASSERTIONS_PASSED=3');
