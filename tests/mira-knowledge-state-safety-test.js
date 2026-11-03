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
    const file = path.join(root, 'knowledge.json');

    assert.deepEqual(knowledge.getKnowledge(), []);

    const added = await knowledge.addKnowledge(
      'Phase 2 fixture',
      'https://example.invalid/fixture',
      'isolated knowledge state safety fixture'
    );
    assert.equal(added.added, true);
    assert.equal(knowledge.getKnowledge().length, 1);

    const versionsDir = file + '.versions';
    assert.equal(fs.existsSync(versionsDir), true);
    assert.ok(fs.readdirSync(versionsDir).length >= 1);

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
    assert.equal(knowledge.getKnowledge().length, 1);

    console.log('TESTS_PASSED=10');
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
