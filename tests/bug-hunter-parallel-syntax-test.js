'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const project = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-bh-parallel-'));

try {
  const scripts = path.join(temp, 'scripts');
  const policyDir = path.join(temp, 'services', 'engineering');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(policyDir, { recursive: true });
  fs.mkdirSync(path.join(temp, 'reports'), { recursive: true });

  fs.copyFileSync(path.join(project, 'scripts/mira-bug-hunter.js'),
    path.join(scripts, 'mira-bug-hunter.js'));
  fs.copyFileSync(path.join(project, 'services/engineering/gate-status-policy.js'),
    path.join(policyDir, 'gate-status-policy.js'));

  fs.writeFileSync(path.join(temp, 'valid.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(temp, 'broken.js'), 'function { invalid syntax\n');
  fs.mkdirSync(path.join(temp, 'backup-fixture'));
  fs.writeFileSync(path.join(temp, 'backup-fixture', 'ignored.js'),
    'function { invalid syntax\n');

  const run = spawnSync(process.execPath, [path.join(scripts, 'mira-bug-hunter.js')], {
    cwd: temp, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      MIRA_BUG_HUNTER_MAX_ENTRIES: '500',
      MIRA_BUG_HUNTER_MAX_FILES: '100',
      MIRA_BUG_HUNTER_SCAN_BUDGET_MS: '10000',
      MIRA_BUG_HUNTER_SYNTAX_CONCURRENCY: '3',
      MIRA_BUG_HUNTER_SYNTAX_FILE_TIMEOUT_MS: '3000'
    }
  });

  const output = String(run.stdout || '') + '\n' + String(run.stderr || '');
  assert.equal(run.error, undefined, output);
  assert.equal(run.status, 0, output);
  assert.match(output, /concurrency:3,fileTimeoutMs:3000/);

  const match = output.match(/BUG_REGISTRY=(.+)/);
  assert.ok(match, output);
  const registry = JSON.parse(fs.readFileSync(path.join(temp, match[1].trim()), 'utf8'));
  const syntax = registry.findings.filter(f => f.check === 'javascript_syntax');

  assert.equal(registry.syntaxSummary.discovered, registry.filesScanned);
  assert.equal(registry.syntaxSummary.results, registry.filesScanned);
  assert.equal(syntax.length, registry.filesScanned);
  assert.equal(registry.syntaxSummary.coverageComplete, true,
    'All discovered fixture files received syntax results');
  assert.equal(registry.syntaxSummary.allPassed, false,
    'Invalid syntax must prevent an all-passed claim');
  assert.ok(syntax.some(f => f.file === 'valid.js' && f.status === 'PASS'));
  assert.ok(syntax.some(f => f.file === 'broken.js' && f.status === 'FAIL'));
  assert.ok(!syntax.some(f => String(f.file).includes('backup-fixture')));
  assert.match(output, /SYNTAX_COVERAGE_COMPLETE=true/);
  assert.match(output, /SYNTAX_ALL_PASSED=false/);

  // Truncated inventory must never claim complete syntax coverage.
  const limited = spawnSync(
    process.execPath,
    [path.join(scripts, 'mira-bug-hunter.js')],
    {
      cwd: temp,
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        MIRA_BUG_HUNTER_MAX_ENTRIES: '1',
        MIRA_BUG_HUNTER_MAX_FILES: '100',
        MIRA_BUG_HUNTER_SCAN_BUDGET_MS: '10000',
        MIRA_BUG_HUNTER_SYNTAX_CONCURRENCY: '3',
        MIRA_BUG_HUNTER_SYNTAX_FILE_TIMEOUT_MS: '3000'
      }
    }
  );
  const limitedOutput =
    String(limited.stdout || '') + '\n' + String(limited.stderr || '');
  assert.equal(limited.error, undefined, limitedOutput);
  assert.equal(limited.status, 0, limitedOutput);
  const limitedMatch = limitedOutput.match(/BUG_REGISTRY=(.+)/);
  assert.ok(limitedMatch, limitedOutput);
  const limitedRegistry = JSON.parse(fs.readFileSync(
    path.join(temp, limitedMatch[1].trim()), 'utf8'));
  assert.equal(limitedRegistry.syntaxSummary.inventoryComplete, false);
  assert.equal(limitedRegistry.syntaxSummary.coverageComplete, false);
  assert.equal(limitedRegistry.syntaxSummary.allPassed, false);
  assert.ok(limitedRegistry.findings.some(
    f => f.check === 'scan_completeness' && f.status === 'INCONCLUSIVE'));
  console.log('TRUNCATED_SCAN_NOT_PASSED=PASS');

  console.log('PARALLEL_SYNTAX_REGRESSION=PASS');
  console.log('DISCOVERED_MATCHES_RESULTS=PASS');
  console.log('INVALID_SYNTAX_DETECTED=PASS');
  console.log('ROOT_BACKUP_EXCLUSION=PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
