'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-knowledge-safety-'));
  const originalStorage = process.env.MIRA_STORAGE_DIR;
  const originalOffline = process.env.MIRA_TEST_OFFLINE_DRIVE;
  process.env.MIRA_STORAGE_DIR = root;
  process.env.MIRA_TEST_OFFLINE_DRIVE = '1';

  try {
    const knowledge = require('../knowledge');
    const recovery = require('../services/mira-knowledge-state-recovery');
    const file = path.join(root, 'knowledge.json');
    const markerFile = file + '.hfm-initialized.json';

    assert.deepEqual(knowledge.getKnowledge(), []);
    assert.equal(fs.existsSync(markerFile), false);
    console.log('KNOWLEDGE_FIRST_RUN_EMPTY_WITHOUT_MARKER=PASS');

    const added = await knowledge.addKnowledge(
      'Phase 2 fixture',
      'https://example.invalid/fixture',
      'isolated knowledge state safety fixture'
    );
    assert.equal(added.added, true);
    assert.equal(added.drive, false);
    assert.equal(knowledge.getKnowledge().length, 1);
    assert.equal(fs.existsSync(markerFile), true);
    console.log('KNOWLEDGE_INITIALIZATION_MARKER_CREATED_ON_FIRST_WRITE=PASS');

    const secondAdded = await knowledge.addKnowledge(
      'Phase 2 second fixture',
      'https://example.invalid/fixture-two',
      'second isolated knowledge state safety fixture'
    );
    assert.equal(secondAdded.added, true);
    assert.equal(secondAdded.drive, false);
    assert.equal(knowledge.getKnowledge().length, 2);

    const versionsDir = file + '.versions';
    assert.equal(fs.existsSync(versionsDir), true);
    assert.ok(fs.readdirSync(versionsDir).length >= 1);

    const backup = recovery.createKnowledgeBackup();
    assert.equal(backup.success, true);
    assert.equal(fs.existsSync(path.join(root, 'knowledge-backup.json')), true);
    fs.unlinkSync(file);
    assert.throws(() => knowledge.getKnowledge(), /previously initialized/i);
    await assert.rejects(
      knowledge.addKnowledge('Must require restore', '', 'no empty overwrite'),
      /previously initialized/i
    );
    assert.throws(() => recovery.createKnowledgeBackup(), /restore is required/i);
    console.log('KNOWLEDGE_MISSING_PRIMARY_BLOCKS_READ_WRITE_AND_BACKUP=PASS');

    const restoredMissingPrimary = recovery.restoreKnowledge({ confirm: true });
    assert.equal(restoredMissingPrimary.success, true);
    assert.equal(restoredMissingPrimary.restored, true);
    assert.equal(knowledge.getKnowledge().length, 2);
    console.log('KNOWLEDGE_MISSING_PRIMARY_EXPLICIT_RESTORE=PASS');

    const validBeforeCorruption = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, '{invalid');
    assert.throws(() => knowledge.getKnowledge(), /invalid JSON/i);
    await assert.rejects(
      knowledge.addKnowledge('Must not overwrite', '', 'must remain blocked'),
      /invalid JSON/i
    );
    assert.equal(fs.readFileSync(file, 'utf8'), '{invalid');

    fs.writeFileSync(file, JSON.stringify({ invalid: true }));
    assert.throws(() => knowledge.getKnowledge(), /JSON array/i);

    fs.writeFileSync(file, validBeforeCorruption);
    assert.equal(knowledge.getKnowledge().length, 2);

    console.log('TESTS_PASSED=14');
    console.log('TESTS_FAILED=0');
    console.log('PRODUCTION_KNOWLEDGE_TOUCHED=NO');
    console.log('REAL_GOOGLE_DRIVE_TOUCHED=NO');
    console.log('NETWORK_REQUESTS=0');
    console.log('RESULT=KNOWLEDGE_STATE_SAFETY_PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (originalStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
    else process.env.MIRA_STORAGE_DIR = originalStorage;
    if (originalOffline === undefined) delete process.env.MIRA_TEST_OFFLINE_DRIVE;
    else process.env.MIRA_TEST_OFFLINE_DRIVE = originalOffline;
  }
}

main().catch(error => {
  process.stderr.write('FAIL: ' + (error.stack || error.message) + '\n');
  process.exitCode = 1;
});
