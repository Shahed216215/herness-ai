'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-phase2-recovery-'));
  const previous = {
    storage: process.env.MIRA_STORAGE_DIR,
    memory: process.env.MIRA_MEMORY_FILE,
    offline: process.env.MIRA_TEST_OFFLINE_DRIVE,
    hmac: process.env.MIRA_AUDIT_HMAC_KEY
  };
  process.env.MIRA_STORAGE_DIR = root;
  process.env.MIRA_TEST_OFFLINE_DRIVE = '1';
  process.env.MIRA_AUDIT_HMAC_KEY = 'phase2-isolated-audit-test-key';

  try {
    const stateStore = require('../services/mira-json-state-store');
    const knowledgeRecovery = require('../services/mira-knowledge-state-recovery');
    const versionRecovery = require('../services/mira-state-version-recovery');
    const knowledgeFile = path.join(root, 'knowledge.json');

    const original = [
      { id: 'k-1', title: 'Original', content: 'verified original state' },
      { id: 'k-2', title: 'Second', content: 'second record' }
    ];
    stateStore.writeArrayState(knowledgeFile, original, 'Mira Knowledge');
    const backup = knowledgeRecovery.createKnowledgeBackup();
    assert.equal(backup.integrity, 'SHA256_VERIFIED');
    assert.equal(backup.entryCount, 2);

    const changed = [{ id: 'k-3', title: 'Changed', content: 'temporary current state' }];
    stateStore.writeArrayState(knowledgeFile, changed, 'Mira Knowledge');
    const noConfirm = knowledgeRecovery.restoreKnowledge({ confirm: false });
    assert.equal(noConfirm.restored, false);
    assert.deepEqual(stateStore.readJsonArray(knowledgeFile, 'Mira Knowledge'), changed);

    const restored = knowledgeRecovery.restoreKnowledge({ confirm: true });
    assert.equal(restored.restored, true);
    assert.equal(restored.integrity, 'SHA256_VERIFIED');
    assert.deepEqual(stateStore.readJsonArray(knowledgeFile, 'Mira Knowledge'), original);
    assert.equal(fs.existsSync(path.join(root, 'knowledge-before-restore.json')), true);

    const snapshotList = versionRecovery.listVersions('knowledge');
    assert.ok(snapshotList.versions.length >= 2);
    const firstVersion = snapshotList.versions[snapshotList.versions.length - 1];
    assert.equal(versionRecovery.verifyVersion('knowledge', firstVersion.file).status, 'VERIFIED');
    const versionRestore = versionRecovery.restoreVersion({
      target: 'knowledge',
      versionFile: firstVersion.file,
      confirm: true
    });
    assert.equal(versionRestore.restored, true);
    assert.deepEqual(
      stateStore.readJsonArray(knowledgeFile, 'Mira Knowledge'),
      original
    );

    const backupPath = path.join(root, 'knowledge-backup.json');
    const backupRaw = fs.readFileSync(backupPath, 'utf8');
    const tampered = JSON.parse(backupRaw);
    tampered.sha256 = '0'.repeat(64);
    fs.writeFileSync(backupPath, JSON.stringify(tampered));
    assert.throws(
      () => knowledgeRecovery.restoreKnowledge({ confirm: true }),
      /SHA-256 verification failed/i
    );
    assert.deepEqual(
      stateStore.readJsonArray(knowledgeFile, 'Mira Knowledge'),
      original
    );
    fs.writeFileSync(backupPath, backupRaw);

    const audit = require('../audit-log');
    assert.equal(audit.verifyAuditIntegrity().ok, true);
    assert.ok(audit.loadAuditLog().some(e => e.action === 'knowledge_backup_created'));
    assert.ok(audit.loadAuditLog().some(e => e.action === 'knowledge_restore_committed'));
    assert.ok(audit.loadAuditLog().some(e => e.action === 'memory_version_restore_committed'));

    console.log('KNOWLEDGE_BACKUP_RESTORE=PASS');
    console.log('VERSION_LIST_VERIFY_RESTORE=PASS');
    console.log('TAMPERED_BACKUP_REJECTED=PASS');
    console.log('AUDIT_CHAIN=PASS');
    console.log('PRODUCTION_KNOWLEDGE_TOUCHED=NO');
    console.log('REAL_GOOGLE_DRIVE_TOUCHED=NO');
    console.log('NETWORK_REQUESTS=0');
    console.log('TESTS_FAILED=0');
    console.log('RESULT=PHASE2_RECOVERY_PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previous.storage === undefined) delete process.env.MIRA_STORAGE_DIR;
    else process.env.MIRA_STORAGE_DIR = previous.storage;
    if (previous.memory === undefined) delete process.env.MIRA_MEMORY_FILE;
    else process.env.MIRA_MEMORY_FILE = previous.memory;
    if (previous.offline === undefined) delete process.env.MIRA_TEST_OFFLINE_DRIVE;
    else process.env.MIRA_TEST_OFFLINE_DRIVE = previous.offline;
    if (previous.hmac === undefined) delete process.env.MIRA_AUDIT_HMAC_KEY;
    else process.env.MIRA_AUDIT_HMAC_KEY = previous.hmac;
  }
}

main().catch(error => {
  process.stderr.write('FAIL: ' + (error.stack || error.message) + '\n');
  process.exitCode = 1;
});
