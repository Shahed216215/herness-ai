'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-audit-log-safety-'));
const auditFile = path.join(root, 'audit-log.json');
const anchorFile = auditFile + '.anchor';
const markerFile = auditFile + '.hfm-initialized.json';
const lockFile = auditFile + '.lock';
process.env.MIRA_AUDIT_FILE = auditFile;
process.env.MIRA_AUDIT_HMAC_KEY = 'fixture-audit-hmac-key-2026';
delete require.cache[require.resolve('../audit-log')];
const audit = require('../audit-log');

function runWorker(label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, 'fixtures/mira-audit-log-append-worker.js'),
      label
    ], {
      env: {
        ...process.env,
        MIRA_AUDIT_FILE: auditFile,
        MIRA_AUDIT_HMAC_KEY: process.env.MIRA_AUDIT_HMAC_KEY
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || 'audit worker failed'));
    });
  });
}

(async () => {
  try {
    assert.deepEqual(audit.loadAuditLog(), []);
    assert.equal(fs.existsSync(markerFile), false);
    console.log('AUDIT_LOG_TRUE_FIRST_RUN_EMPTY=PASS');

    const first = audit.recordAudit({
      actorRole: 'fixture',
      action: 'audit-safety-initial',
      resource: 'mira_audit_log_test',
      resourceId: 'initial',
      details: { safe: true }
    });
    assert.ok(first.integrityHash);
    assert.equal(fs.existsSync(markerFile), true);
    assert.equal(audit.verifyAuditIntegrity().ok, true);
    console.log('AUDIT_LOG_INITIALIZATION_MARKER_AND_HMAC=PASS');

    const workerIds = await Promise.all([
      runWorker('one'), runWorker('two'), runWorker('three'), runWorker('four')
    ]);
    assert.equal(new Set(workerIds).size, 4);
    const concurrentEntries = audit.loadAuditLog();
    assert.equal(concurrentEntries.length, 5);
    assert.equal(audit.verifyAuditIntegrity().ok, true);
    assert.equal(concurrentEntries.filter(entry =>
      String(entry.action).startsWith('concurrent-audit-worker-')
    ).length, 4);
    console.log('AUDIT_LOG_CROSS_PROCESS_APPEND_NO_LOST_EVENTS=PASS');

    fs.writeFileSync(lockFile, JSON.stringify({ pid: -1, createdAt: new Date().toISOString() }));
    assert.throws(
      () => audit.recordAudit({ action: 'must-not-pass-stale-lock' }),
      error => error.code === 'AUDIT_LOCK_BUSY'
    );
    fs.unlinkSync(lockFile);
    assert.equal(audit.loadAuditLog().length, 5);
    console.log('AUDIT_LOG_STALE_LOCK_FAILS_CLOSED=PASS');

    const beforeLimit = fs.readFileSync(auditFile, 'utf8');
    const oversized = [...audit.loadAuditLog(), ...Array(500).fill({ fixture: true })];
    assert.throws(
      () => audit.saveAuditLog(oversized),
      error => error.code === 'AUDIT_RETENTION_LIMIT_REACHED'
    );
    assert.equal(fs.readFileSync(auditFile, 'utf8'), beforeLimit);
    console.log('AUDIT_LOG_RETENTION_LIMIT_NEVER_TRUNCATES=PASS');

    const cleared = audit.clearAuditLog();
    assert.equal(cleared.success, true);
    assert.equal(cleared.archivedEntries, 5);
    assert.ok(cleared.archiveFile);
    const archive = JSON.parse(fs.readFileSync(path.join(root, cleared.archiveFile), 'utf8'));
    assert.equal(archive.entries.length, 5);
    assert.deepEqual(audit.loadAuditLog(), []);
    assert.equal(audit.verifyAuditIntegrity().ok, true);
    console.log('AUDIT_LOG_CLEAR_PRESERVES_VERIFIED_ARCHIVE=PASS');

    audit.recordAudit({
      actorRole: 'fixture',
      action: 'audit-safety-after-clear',
      resource: 'mira_audit_log_test',
      resourceId: 'after-clear'
    });
    assert.equal(audit.verifyAuditIntegrity().ok, true);
    const validAuditBytes = fs.readFileSync(auditFile);
    const validAnchorBytes = fs.readFileSync(anchorFile);
    console.log('AUDIT_LOG_CAN_START_NEW_VERIFIED_CHAIN_AFTER_ARCHIVE=PASS');

    fs.writeFileSync(auditFile, '');
    assert.throws(() => audit.loadAuditLog(), /empty and may be corrupted/i);
    assert.throws(() => audit.recordAudit({ action: 'must-not-overwrite-empty-audit' }), /empty and may be corrupted/i);
    assert.equal(fs.readFileSync(auditFile, 'utf8'), '');
    console.log('AUDIT_LOG_EMPTY_FILE_FAILS_CLOSED=PASS');

    fs.writeFileSync(auditFile, '{');
    assert.throws(() => audit.loadAuditLog(), /invalid JSON/i);
    assert.throws(() => audit.recordAudit({ action: 'must-not-overwrite-invalid-json' }), /invalid JSON/i);
    assert.equal(fs.readFileSync(auditFile, 'utf8'), '{');
    console.log('AUDIT_LOG_INVALID_JSON_FAILS_CLOSED=PASS');

    fs.writeFileSync(auditFile, '{}');
    assert.throws(() => audit.loadAuditLog(), /must contain a JSON array/i);
    assert.throws(() => audit.recordAudit({ action: 'must-not-overwrite-non-array' }), /must contain a JSON array/i);
    assert.equal(fs.readFileSync(auditFile, 'utf8'), '{}');
    console.log('AUDIT_LOG_NON_ARRAY_FAILS_CLOSED=PASS');

    fs.writeFileSync(auditFile, validAuditBytes);
    fs.writeFileSync(anchorFile, validAnchorBytes);
    fs.unlinkSync(auditFile);
    assert.throws(() => audit.loadAuditLog(), /previously initialized/i);
    assert.throws(() => audit.recordAudit({ action: 'must-not-reinitialize-audit' }), /previously initialized/i);
    assert.equal(fs.existsSync(auditFile), false);
    console.log('AUDIT_LOG_MISSING_PRIMARY_FAILS_CLOSED=PASS');

    const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    marker.sha256 = '0'.repeat(64);
    fs.writeFileSync(markerFile, JSON.stringify(marker), { mode: 0o600 });
    assert.throws(() => audit.loadAuditLog(), /initialization marker integrity/i);
    console.log('AUDIT_LOG_MARKER_TAMPER_FAILS_CLOSED=PASS');

    console.log('TESTS_FAILED=0');
    console.log('RESULT=MIRA_AUDIT_LOG_SAFETY_PASS');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
