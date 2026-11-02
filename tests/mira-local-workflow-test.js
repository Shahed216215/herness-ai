'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'mira-local-workflow.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-workflow-test-'));
const env = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || root,
  TMPDIR: process.env.TMPDIR || os.tmpdir(),
  TMP: process.env.TMP || os.tmpdir(),
  TEMP: process.env.TEMP || os.tmpdir(),
  LANG: process.env.LANG || '',
  LC_ALL: process.env.LC_ALL || '',
  MIRA_LOCAL_WORKFLOW_HOME: temp
};

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 40000
  });
}
function ok(...args) {
  const r = run(...args);
  assert.equal(r.status, 0, `${args.join(' ')} failed: ${r.stderr}\n${r.stdout}`);
  return r.stdout;
}
function fails(expected, ...args) {
  const r = run(...args);
  assert.notEqual(r.status, 0, `expected failure: ${args.join(' ')}`);
  assert.match(r.stderr, new RegExp(expected));
}

try {
  ok('enqueue', 'needs-approval', 'status');
  fails('EXPLICIT_APPROVAL_REQUIRED', 'run', 'needs-approval');
  ok('approve', 'needs-approval');
  const result = ok('run', 'needs-approval');
  assert.match(result, /TASK_STATUS=completed/);
  const evidence = JSON.parse(fs.readFileSync(
    path.join(temp, 'reports', 'needs-approval.json'), 'utf8'));
  assert.equal(evidence.task_id, 'needs-approval');
  assert.equal(evidence.exit_code, 0);
  assert.ok(evidence.started_at);
  assert.ok(evidence.completed_at);
  assert.match(evidence.output_sha256, /^[a-f0-9]{64}$/);
  fails('DUPLICATE_TASK_ID', 'enqueue', 'needs-approval', 'status');
  fails('ACTION_NOT_ALLOWED', 'enqueue', 'bad-action', 'shell');
  fails('EXPLICIT_APPROVAL_REQUIRED', 'run', 'needs-approval');
  ok('enqueue', 'inventory-check', 'inventory');
  ok('approve', 'inventory-check');
  assert.match(ok('run', 'inventory-check'), /TASK_STATUS=completed/);

  // Crash simulation: a persisted running task must not execute again.
  ok('enqueue', 'crash-sim', 'status');
  ok('approve', 'crash-sim');
  const crashTaskFile = path.join(temp, 'tasks', 'crash-sim.json');
  const crashTask = JSON.parse(fs.readFileSync(crashTaskFile, 'utf8'));
  crashTask.status = 'running';
  crashTask.started_at = new Date().toISOString();
  fs.writeFileSync(crashTaskFile, JSON.stringify(crashTask, null, 2), { mode: 0o600 });
  fails('EXPLICIT_APPROVAL_REQUIRED', 'run', 'crash-sim');
  assert.equal(JSON.parse(fs.readFileSync(crashTaskFile, 'utf8')).status, 'running');
  fails('EXPLICIT_RECOVERY_APPROVAL_REQUIRED', 'recover', 'crash-sim');
  ok('recover', 'crash-sim', '--approve');
  const recovered = JSON.parse(fs.readFileSync(crashTaskFile, 'utf8'));
  assert.equal(recovered.status, 'recovery_required');
  assert.ok(recovered.recovery_at);
  assert.match(recovered.recovery_note, /automatic re-execution prohibited/i);
  fails('EXPLICIT_APPROVAL_REQUIRED', 'run', 'crash-sim');

  // Simulated stale lock: do not execute while the lock exists.
  ok('enqueue', 'lock-sim', 'status');
  ok('approve', 'lock-sim');
  const lockFile = path.join(temp, 'run.lock');
  fs.writeFileSync(lockFile, 'simulated-lock', { flag: 'wx', mode: 0o600 });
  fails('ANOTHER_TASK_MAY_BE_RUNNING', 'run', 'lock-sim');
  assert.equal(JSON.parse(fs.readFileSync(
    path.join(temp, 'tasks', 'lock-sim.json'), 'utf8')).status, 'approved');
  fs.unlinkSync(lockFile);
  assert.match(ok('run', 'lock-sim'), /TASK_STATUS=completed/);

  console.log('TESTS=PASS');
  console.log('CASES=approval-required, duplicate-protection, action-allowlist, evidence-hash, single-run, crash-state-block, explicit-recovery-approval, recovery-quarantine, lock-block-and-resume');
} catch (error) {
  console.error('TESTS=FAIL');
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
