'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-memory-test-'));
process.env.MIRA_MEMORY_FILE = path.join(root, 'memory.json');

const store = require('../services/mira-local-memory-store');
const memory = require('../memory');
const restoreTool = require('../tools/memory-restore');

async function main() {
  try {
    assert.deepEqual(memory.getMemory(), []);

    memory.addMemory({ role: 'user', content: 'fixture-one' });
    memory.addMemory('assistant', 'fixture-two');
    memory.addMemory('assistant', 'fixture-two');

    let entries = memory.getMemory();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].content, 'fixture-one');
    assert.equal(entries[1].content, 'fixture-two');

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

    // Corrupt JSON must throw and must not be silently converted to [].
    fs.writeFileSync(store.MEMORY_FILE, '{broken', { mode: 0o600 });
    assert.throws(() => memory.getMemory(), /invalid JSON/i);
    assert.throws(
      () => memory.addMemory('user', 'must-not-overwrite'),
      /invalid JSON/i
    );
    assert.equal(fs.readFileSync(store.MEMORY_FILE, 'utf8'), '{broken');

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
  }
}

main().catch(error => {
  process.stderr.write(`FAIL: ${error.message}\n`);
  process.exitCode = 1;
});
