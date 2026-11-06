'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-knowledge-cleanup-storage-'));
const previousStorage = process.env.MIRA_STORAGE_DIR;
const rootKnowledge = path.join(root, 'knowledge.json');
const rootKnowledgeBefore = fs.existsSync(rootKnowledge) ? fs.readFileSync(rootKnowledge) : null;
const originalLoad = Module._load;
let drivePayload = null;

try {
  process.env.MIRA_STORAGE_DIR = storageRoot;
  for (const request of [
    '../mira-storage',
    '../services/mira-json-state-store',
    '../knowledge'
  ]) {
    try { delete require.cache[require.resolve(request, { paths: [root] })]; } catch {}
  }

  const knowledgeModule = require('../knowledge');
  const first = {
    title: 'Duplicate fixture', topic: 'fixture', url: 'https://example.invalid/a',
    content: 'same content', savedAt: '2026-11-04T00:00:00.000Z'
  };
  const second = { ...first };
  knowledgeModule.replaceKnowledge([first, second]);
  assert.equal(knowledgeModule.getKnowledge().length, 2);
  assert.ok(fs.existsSync(path.join(storageRoot, 'knowledge.json')));
  assert.equal(fs.existsSync(rootKnowledge), rootKnowledgeBefore !== null);

  Module._load = function(request, parent, isMain) {
    if (request === '../services/mira-tool-execution-policy' &&
        parent && parent.filename === path.join(root, 'tools', 'knowledge-cleanup.js')) {
      // This suite tests canonical storage behavior after authorization.
      // Real human-only denial is covered by mira-hfm-persistent-wrapper-guard.test.js.
      return {
        checkToolSafety: () => ({
          passed: true,
          reason: 'isolated storage fixture authorization'
        })
      };
    }
    if (request === '../google-drive' &&
        parent && parent.filename === path.join(root, 'tools', 'knowledge-cleanup.js')) {
      return {
        saveKnowledgeToDrive: async entries => {
          drivePayload = entries;
          return { success: true, action: 'isolated-stub' };
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const cleanupTool = require('../tools/knowledge-cleanup');
  cleanupTool.execute({ action: 'remove' }).then(raw => {
    const result = JSON.parse(raw);
    assert.equal(result.success, true);
    assert.equal(result.removed, 1);
    assert.equal(result.remaining, 1);
    assert.equal(result.driveSync, true);
    assert.ok(Array.isArray(drivePayload));
    assert.equal(drivePayload.length, 1);
    assert.equal(knowledgeModule.getKnowledge().length, 1);
    assert.equal(fs.existsSync(path.join(storageRoot, 'knowledge.json')), true);
    if (rootKnowledgeBefore === null) {
      assert.equal(fs.existsSync(rootKnowledge), false);
    } else {
      assert.deepEqual(fs.readFileSync(rootKnowledge), rootKnowledgeBefore);
    }
    console.log('KNOWLEDGE_CLEANUP_USES_CANONICAL_STORAGE_PATH=PASS');
    console.log('KNOWLEDGE_CLEANUP_DELEGATES_TO_ATOMIC_STATE_STORE=PASS');
    console.log('KNOWLEDGE_CLEANUP_DRIVE_SYNC_IS_STUBBED=PASS');
    console.log('KNOWLEDGE_CLEANUP_NO_PROJECT_ROOT_SPLIT_BRAIN_WRITE=PASS');
    console.log('TESTS_FAILED=0');
    console.log('RESULT=MIRA_KNOWLEDGE_CLEANUP_STORAGE_CONTRACT_PASS');
  }).catch(error => {
    console.error(error);
    console.log('TESTS_FAILED=1');
    console.log('RESULT=MIRA_KNOWLEDGE_CLEANUP_STORAGE_CONTRACT_FAIL');
    process.exitCode = 1;
  }).finally(() => {
    Module._load = originalLoad;
    if (previousStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
    else process.env.MIRA_STORAGE_DIR = previousStorage;
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
} catch (error) {
  Module._load = originalLoad;
  if (previousStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
  else process.env.MIRA_STORAGE_DIR = previousStorage;
  fs.rmSync(storageRoot, { recursive: true, force: true });
  console.error(error);
  console.log('TESTS_FAILED=1');
  console.log('RESULT=MIRA_KNOWLEDGE_CLEANUP_STORAGE_CONTRACT_FAIL');
  process.exitCode = 1;
}
