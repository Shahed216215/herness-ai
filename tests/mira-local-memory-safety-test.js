'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-memory-test-'));
const originalStorage = process.env.MIRA_STORAGE_DIR;
process.env.MIRA_STORAGE_DIR = root;
process.env.MIRA_MEMORY_FILE = path.join(root, 'memory.json');

const store = require('../services/mira-local-memory-store');
const memory = require('../memory');
const policyPath = require.resolve('../services/mira-tool-execution-policy');
const previousPolicy = require.cache[policyPath];
const policyStub = new Module(policyPath);
policyStub.filename = policyPath;
policyStub.loaded = true;
// This suite verifies restore mechanics after authorization. The separate
// wrapper-guard suite tests the real human-only policy denial.
policyStub.exports = {
  checkToolSafety: () => ({ passed: true, reason: 'isolated restore fixture authorization' })
};
require.cache[policyPath] = policyStub;
const restoreTool = require('../tools/memory-restore');

async function main() {
  try {
    assert.deepEqual(memory.getMemory(), []);
    assert.equal(fs.existsSync(store.INITIALIZATION_FILE), false);
    console.log('FIRST_RUN_EMPTY_ONLY_WITHOUT_INITIALIZATION_MARKER=PASS');

    memory.addMemory({ role: 'user', content: 'fixture-one' });
    memory.addMemory('assistant', 'fixture-two');
    memory.addMemory('assistant', 'fixture-two');

    let entries = memory.getMemory();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].content, 'fixture-one');
    assert.equal(entries[1].content, 'fixture-two');
    assert.equal(fs.existsSync(store.INITIALIZATION_FILE), true);

    // A legacy existing primary without a marker is marked only after a valid read.
    fs.unlinkSync(store.INITIALIZATION_FILE);
    assert.equal(memory.getMemory().length, 2);
    assert.equal(fs.existsSync(store.INITIALIZATION_FILE), true);
    console.log('LEGACY_PRIMARY_READ_ESTABLISHES_INITIALIZATION_MARKER=PASS');

    // A previous valid state is retained as an immutable version before replacement.
    const versionsDir = store.MEMORY_FILE + '.versions';
    assert.equal(fs.existsSync(versionsDir), true);
    assert.ok(fs.readdirSync(versionsDir).length >= 1);

    const backupResult = store.createBackup();
    assert.equal(backupResult.success, true);
    assert.equal(backupResult.backupVersion, 2);

    memory.addMemory('user', 'fixture-after-backup');
    assert.equal(memory.getMemory().length, 3);

    const denied = JSON.parse(await restoreTool.execute({ confirm: false }));
    assert.equal(denied.restored, false);
    assert.equal(memory.getMemory().length, 3);

    const restored = JSON.parse(await restoreTool.execute({ confirm: true }));
    assert.equal(restored.success, true);
    assert.equal(restored.integrity, 'SHA256_VERIFIED');
    assert.equal(memory.getMemory().length, 2);
    assert.equal(fs.existsSync(store.SAFETY_BACKUP_FILE), true);

    // Missing primary with a verified backup must not silently become empty.
    fs.unlinkSync(store.MEMORY_FILE);
    const recoveredRead = memory.getMemory();
    assert.equal(recoveredRead.length, 2);
    console.log('MISSING_PRIMARY_VERIFIED_BACKUP_READ_ONLY=PASS');
    assert.throws(
      () => memory.addMemory('user', 'must-require-explicit-restore'),
      /explicit verified restore is required/i
    );
    console.log('MISSING_PRIMARY_WRITE_REQUIRES_EXPLICIT_RESTORE=PASS');
    const missingPrimaryRestore = JSON.parse(await restoreTool.execute({ confirm: true }));
    assert.equal(missingPrimaryRestore.success, true);
    assert.equal(memory.getMemory().length, 2);
    memory.addMemory('user', 'fixture-after-primary-recovery');
    assert.equal(memory.getMemory().length, 3);

    // Corrupt JSON must throw and must not be silently converted to [].
    fs.writeFileSync(store.MEMORY_FILE, '{broken', { mode: 0o600 });
    assert.throws(() => memory.getMemory(), /invalid JSON/i);
    assert.throws(
      () => memory.addMemory('user', 'must-not-overwrite'),
      /invalid JSON/i
    );
    assert.equal(fs.readFileSync(store.MEMORY_FILE, 'utf8'), '{broken');

    // Explicit restore must preserve corrupt primary bytes before replacing them.
    const recovered = JSON.parse(await restoreTool.execute({ confirm: true }));
    assert.equal(recovered.restored, true);
    assert.equal(recovered.safetyBackup, path.basename(store.SAFETY_QUARANTINE_FILE));
    assert.equal(fs.existsSync(store.SAFETY_QUARANTINE_FILE), true);
    const corruptPreservation = JSON.parse(
      fs.readFileSync(store.SAFETY_QUARANTINE_FILE, 'utf8')
    );
    assert.equal(corruptPreservation.rawContent, '{broken');
    assert.equal(memory.getMemory().length, 2);
    const auditLog = require('../audit-log');
    assert.ok(auditLog.loadAuditLog().some(entry => entry.action === 'memory_restore_committed'));

    // Empty files are corruption, not an empty Memory.
    fs.writeFileSync(store.MEMORY_FILE, '');
    assert.throws(() => memory.getMemory(), /empty/i);

    // Symlink targets must be rejected.
    fs.unlinkSync(store.MEMORY_FILE);
    const outside = path.join(root, 'outside.json');
    fs.writeFileSync(outside, '[]');
    fs.symlinkSync(outside, store.MEMORY_FILE);
    assert.throws(() => memory.getMemory(), /safe regular file/i);

    // Backup checksum tampering must be rejected.
    fs.unlinkSync(store.MEMORY_FILE);
    const backup = JSON.parse(fs.readFileSync(store.BACKUP_FILE, 'utf8'));
    backup.entries.push({ role: 'user', content: 'tampered' });
    backup.entryCount = backup.entries.length;
    fs.writeFileSync(store.BACKUP_FILE, JSON.stringify(backup));
    assert.throws(() => store.validateBackup(backup), /SHA-256/i);
    assert.throws(() => memory.getMemory(), /backup SHA-256 integrity/i);

    // A previously initialized store with neither primary nor valid backup
    // must never degrade into a first-run empty Memory database.
    fs.unlinkSync(store.BACKUP_FILE);
    assert.throws(() => memory.getMemory(), /previously initialized/i);
    console.log('MISSING_PRIMARY_AND_BACKUP_FAIL_CLOSED=PASS');
    assert.throws(
      () => memory.addMemory('user', 'must-not-reinitialize'),
      /previously initialized/i
    );

    const marker = JSON.parse(fs.readFileSync(store.INITIALIZATION_FILE, 'utf8'));
    marker.sha256 = '0'.repeat(64);
    fs.writeFileSync(store.INITIALIZATION_FILE, JSON.stringify(marker), { mode: 0o600 });
    assert.throws(() => memory.getMemory(), /initialization marker integrity/i);
    console.log('INITIALIZATION_MARKER_TAMPER_FAILS_CLOSED=PASS');

    // Legacy v1 is recognized but explicitly not checksum-verified.
    const legacy = {
      backupVersion: 1,
      entryCount: 1,
      entries: [{ role: 'user', content: 'legacy-fixture' }]
    };
    assert.equal(
      store.validateBackup(legacy).integrity,
      'LEGACY_UNCHECKSUMMED'
    );

    process.stdout.write(
      'PASS: isolated local Memory safety tests completed.\n'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previousPolicy) require.cache[policyPath] = previousPolicy;
    else delete require.cache[policyPath];
    if (originalStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
    else process.env.MIRA_STORAGE_DIR = originalStorage;
  }
}

main().catch(error => {
  process.stderr.write(`FAIL: ${error.message}\n`);
  process.exitCode = 1;
});
