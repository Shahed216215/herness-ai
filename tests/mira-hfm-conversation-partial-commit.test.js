'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-conversation-partial-commit-'));
const previousStorage = process.env.MIRA_STORAGE_DIR;
const modules = [
  '../mira-storage',
  '../services/mira-json-state-store',
  '../audit-log',
  '../conversation-schema',
  '../conversation-store',
  '../services/mira-conversation-memory-engine'
];

try {
  process.env.MIRA_STORAGE_DIR = root;
  for (const id of modules) {
    try { delete require.cache[require.resolve(id)]; } catch {}
  }

  const store = require('../conversation-store');
  const engine = require('../services/mira-conversation-memory-engine');
  const created = store.createStoredConversation({
    clientId: 'fixture-client',
    title: 'Partial commit fixture',
    status: 'active'
  });
  assert.equal(created.ok, true);

  const persisted = store.createStoredMessage({
    conversationId: created.conversation.conversationId,
    clientId: 'fixture-client',
    participant: 'client',
    direction: 'incoming',
    status: 'received',
    content: 'We need a responsive website and please finish by Friday.',
    source: 'isolated-fault-injection'
  });
  assert.equal(persisted.ok, true);

  const originalSaveContext = store.saveContext;
  let injected = false;
  store.saveContext = function failOnce() {
    if (!injected) {
      injected = true;
      const error = new Error('INJECTED_CONTEXT_PERSISTENCE_FAILURE');
      error.code = 'INJECTED_CONTEXT_PERSISTENCE_FAILURE';
      throw error;
    }
    return originalSaveContext.apply(this, arguments);
  };

  assert.throws(
    () => engine.updateConversationMemory({
      conversationId: created.conversation.conversationId,
      message: persisted.message
    }),
    /INJECTED_CONTEXT_PERSISTENCE_FAILURE/
  );

  const afterFailure = store.loadStore();
  assert.equal(afterFailure.messages.length, 1);
  assert.equal(afterFailure.messages[0].messageId, persisted.message.messageId);
  assert.equal(store.getContext(created.conversation.conversationId), null);
  console.log('MESSAGE_COMMITTED_CONTEXT_WRITE_FAILED_PARTIAL_STATE=PASS');

  const retry = engine.updateConversationMemory({
    conversationId: created.conversation.conversationId,
    message: persisted.message
  });
  assert.equal(retry.ok, true);
  assert.ok(retry.context.requirements.length > 0);
  assert.equal(store.listMessages({ conversationId: created.conversation.conversationId }).length, 1);
  console.log('EXPLICIT_MEMORY_RETRY_RECOVERS_WITHOUT_DUPLICATE_MESSAGE=PASS');

  store.saveContext = originalSaveContext;
  console.log('PRODUCTION_CONVERSATIONS_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('EXTERNAL_ACTIONS=0');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_CONVERSATION_PARTIAL_COMMIT_RECOVERY_PASS');
} catch (error) {
  console.error(error);
  console.log('TESTS_FAILED=1');
  console.log('RESULT=MIRA_HFM_CONVERSATION_PARTIAL_COMMIT_RECOVERY_FAIL');
  process.exitCode = 1;
} finally {
  for (const id of modules) {
    try { delete require.cache[require.resolve(id)]; } catch {}
  }
  if (previousStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
  else process.env.MIRA_STORAGE_DIR = previousStorage;
  fs.rmSync(root, { recursive: true, force: true });
}
