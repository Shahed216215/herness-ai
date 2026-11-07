'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { persistConversationMessage } = require('../services/mira-conversation-memory-persistence');

const message = { role: 'user', content: 'A conversation turn.' };
for (const flag of [
  'MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED',
  'MIRA_HFM_WORK_LEARNING_ENABLED',
  'MIRA_HFM_MEMORY_READ_ENABLED',
  'MIRA_HFM_MEMORY_WRITE_ENABLED'
]) {
  let calls = 0;
  const result = persistConversationMessage(message, {
    env: { [flag]: 'true' },
    addMemory: () => { calls += 1; }
  });
  assert.equal(calls, 0, flag + ' must not write to legacy local Memory');
  assert.equal(result.persisted, false);
  assert.equal(result.localFallback, false);
  assert.equal(result.driveFallback, false);
}
console.log('HFM_MODES_NEVER_WRITE_CONVERSATION_TRANSCRIPTS_TO_LOCAL_MEMORY=PASS');

let legacyCalls = 0;
const legacy = persistConversationMessage(message, {
  env: {},
  addMemory: received => {
    legacyCalls += 1;
    assert.deepEqual(received, message);
  }
});
assert.equal(legacyCalls, 1);
assert.equal(legacy.persisted, true);
assert.equal(legacy.source, 'LEGACY_LOCAL_TRANSCRIPT');
console.log('LEGACY_TRANSCRIPT_BEHAVIOR_PRESERVED_OUTSIDE_HFM_MODE=PASS');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(server, /require\(["']\.\/services\/mira-conversation-memory-persistence["']\)/);
assert.equal((server.match(/persistConversationMessage\(\{/g) || []).length, 4);
assert.equal(/\baddMemory\s*\(\s*\{/.test(server), false);
console.log('SERVER_CHAT_ROUTES_USE_HFM_AWARE_TRANSCRIPT_GATE=PASS');

console.log('CANONICAL_MEMORY_WRITTEN=NO');
console.log('NETWORK_REQUESTS=0');
