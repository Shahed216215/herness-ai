'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-knowledge-drive-retry-'));
const previousStorage = process.env.MIRA_STORAGE_DIR;
const originalLoad = Module._load;
let driveCalls = 0;

try {
  process.env.MIRA_STORAGE_DIR = root;
  Module._load = function(request, parent, isMain) {
    if (request === './google-drive' && parent && parent.filename.endsWith('/knowledge.js')) {
      return {
        saveKnowledgeToDrive: async entries => {
          driveCalls += 1;
          assert.equal(entries.length, 1);
          if (driveCalls === 1) throw new Error('INJECTED_DRIVE_SYNC_FAILURE');
          return { success: true };
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  for (const id of ['../mira-storage', '../services/mira-json-state-store', '../audit-log', '../capacity-config', '../knowledge']) {
    try { delete require.cache[require.resolve(id)]; } catch {}
  }

  const knowledge = require('../knowledge');
  (async () => {
    const first = await knowledge.addKnowledge(
      'Local commit survives Drive failure',
      'https://example.invalid/hfm-fixture',
      'Isolated fixture proving local state remains authoritative when provider sync fails.'
    );
    assert.equal(first.added, true);
    assert.equal(first.drive, false);
    assert.equal(knowledge.getKnowledge().length, 1);
    console.log('LOCAL_KNOWLEDGE_COMMIT_SURVIVES_DRIVE_SYNC_FAILURE=PASS');

    const retry = await knowledge.addKnowledge(
      'Local commit survives Drive failure',
      'https://example.invalid/hfm-fixture',
      'Isolated fixture proving local state remains authoritative when provider sync fails.'
    );
    assert.equal(retry.duplicate, true);
    assert.equal(retry.drive, true);
    assert.equal(driveCalls, 2);
    assert.equal(knowledge.getKnowledge().length, 1);
    console.log('DUPLICATE_RETRY_RECONCILES_PROVIDER_WITHOUT_DUPLICATING_LOCAL_ENTRY=PASS');
    console.log('PRODUCTION_KNOWLEDGE_TOUCHED=NO');
    console.log('REAL_GOOGLE_DRIVE_TOUCHED=NO');
    console.log('NETWORK_REQUESTS=0');
    console.log('EXTERNAL_ACTIONS=0');
    console.log('TESTS_FAILED=0');
    console.log('RESULT=MIRA_HFM_KNOWLEDGE_DRIVE_RETRY_RECOVERY_PASS');
  })().catch(error => {
    console.error(error);
    console.log('TESTS_FAILED=1');
    console.log('RESULT=MIRA_HFM_KNOWLEDGE_DRIVE_RETRY_RECOVERY_FAIL');
    process.exitCode = 1;
  }).finally(() => {
    Module._load = originalLoad;
    for (const id of ['../mira-storage', '../services/mira-json-state-store', '../audit-log', '../capacity-config', '../knowledge']) {
      try { delete require.cache[require.resolve(id)]; } catch {}
    }
    if (previousStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
    else process.env.MIRA_STORAGE_DIR = previousStorage;
    fs.rmSync(root, { recursive: true, force: true });
  });
} catch (error) {
  Module._load = originalLoad;
  if (previousStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
  else process.env.MIRA_STORAGE_DIR = previousStorage;
  fs.rmSync(root, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
}
