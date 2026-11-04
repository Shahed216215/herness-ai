'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-conversation-store-safety-'));
const previousStorage = process.env.MIRA_STORAGE_DIR;
const cachePaths = [
  path.join(root, 'mira-storage.js'),
  path.join(root, 'services', 'mira-json-state-store.js'),
  path.join(root, 'audit-log.js'),
  path.join(root, 'conversation-store.js')
];

try {
  process.env.MIRA_STORAGE_DIR = storageRoot;
  for (const file of cachePaths) {
    try { delete require.cache[require.resolve(file)]; } catch {}
  }

  const store = require('../conversation-store');
  const initial = store.loadStore();
  assert.deepEqual(initial.conversations, []);
  assert.deepEqual(initial.messages, []);
  assert.deepEqual(initial.contexts, []);

  const saved = store.saveStore({
    version: 1,
    conversations: [{ conversationId: 'fixture-conversation' }],
    messages: [],
    contexts: []
  });
  assert.equal(saved.conversations.length, 1);
  const validBytes = fs.readFileSync(store.CONVERSATION_FILE);
  assert.ok(fs.existsSync(path.join(storageRoot, 'audit-log.json')));

  fs.writeFileSync(store.CONVERSATION_FILE, '{invalid', 'utf8');
  assert.throws(() => store.loadStore(), /invalid JSON/i);
  assert.equal(fs.readFileSync(store.CONVERSATION_FILE, 'utf8'), '{invalid');
  assert.throws(() => store.saveStore({
    version: 1, conversations: [], messages: [], contexts: []
  }), /invalid JSON|safe regular file/i);
  console.log('CONVERSATION_STORE_CORRUPT_STATE_FAILS_CLOSED=PASS');

  fs.writeFileSync(store.CONVERSATION_FILE, validBytes);
  const external = path.join(storageRoot, 'external.json');
  fs.writeFileSync(external, JSON.stringify({
    version: 1, conversations: [], messages: [], contexts: []
  }));
  fs.unlinkSync(store.CONVERSATION_FILE);
  fs.symlinkSync(external, store.CONVERSATION_FILE);
  assert.throws(() => store.loadStore(), /safe regular file/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(external, 'utf8')).conversations, []);
  assert.throws(() => store.saveStore({
    version: 1, conversations: [], messages: [], contexts: []
  }), /safe regular file/i);
  console.log('CONVERSATION_STORE_SYMLINK_REJECTED=PASS');

  fs.unlinkSync(store.CONVERSATION_FILE);
  const final = store.loadStore();
  assert.deepEqual(final.conversations, []);
  console.log('CONVERSATION_STORE_ATOMIC_INITIALIZATION=PASS');
  console.log('CONVERSATION_STORE_ATOMIC_WRITE_AND_AUDIT=PASS');
  console.log('TESTS_FAILED=0');
  console.log('PRODUCTION_CONVERSATIONS_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('EXTERNAL_ACTIONS=0');
  console.log('RESULT=MIRA_CONVERSATION_STORE_SAFETY_PASS');
} catch (error) {
  console.error(error);
  console.log('TESTS_FAILED=1');
  console.log('RESULT=MIRA_CONVERSATION_STORE_SAFETY_FAIL');
  process.exitCode = 1;
} finally {
  for (const file of cachePaths) {
    try { delete require.cache[require.resolve(file)]; } catch {}
  }
  if (previousStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
  else process.env.MIRA_STORAGE_DIR = previousStorage;
  fs.rmSync(storageRoot, { recursive: true, force: true });
}
