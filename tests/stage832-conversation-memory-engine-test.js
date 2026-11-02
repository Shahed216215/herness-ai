"use strict";

const assert = require("assert");
const fs = require("fs");

const store =
  require("../conversation-store");

const engine =
  require("../services/mira-conversation-memory-engine");

const TEST_FILE =
  store.CONVERSATION_FILE;

function resetStore() {
  fs.writeFileSync(
    TEST_FILE,
    JSON.stringify(
      {
        version: 1,
        updatedAt:
          new Date().toISOString(),
        conversations: [],
        messages: [],
        contexts: []
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function expectThrow(fn) {
  let thrown = false;

  try {
    fn();
  } catch (error) {
    thrown = true;
  }

  assert.strictEqual(
    thrown,
    true,
    "Expected function to throw."
  );
}

console.log(
  "\n=== STAGE 8.3.2 CONVERSATION MEMORY ENGINE TEST ==="
);

resetStore();

console.log(
  "[1] Create conversation"
);

const created =
  store.createStoredConversation({
    clientId: "client-memory-001",
    opportunityId: "opp-memory-001",
    proposalId: "proposal-memory-001",
    title: "Memory Engine Test"
  });

assert.strictEqual(
  created.ok,
  true
);

const conversationId =
  created.conversation.conversationId;

console.log("PASS");

console.log(
  "[2] Extract structured context"
);

const extracted =
  engine.extractContextFromMessage({
    content:
      "I need a responsive website. Scope includes landing page and contact form. Deliverables are the completed website. Please finish by Friday. Which hosting provider will you use?"
  });

assert.ok(
  extracted.requirements.length >= 1
);

assert.ok(
  extracted.scope.length >= 1
);

assert.ok(
  extracted.deliverables.length >= 1
);

assert.strictEqual(
  extracted.deadline,
  "Friday"
);

assert.ok(
  extracted.questions.length >= 1
);

console.log("PASS");

console.log(
  "[3] Store incoming client message"
);

const incoming =
  store.createStoredMessage({
    conversationId,
    clientId: "client-memory-001",
    participant: "client",
    direction: "incoming",
    status: "received",
    content:
      "I need a responsive website. Scope includes landing page and contact form. Deliverables are the completed website. Please finish by Friday. Which hosting provider will you use?"
  });

assert.strictEqual(
  incoming.ok,
  true
);

console.log("PASS");

console.log(
  "[4] Update conversation memory"
);

const memory =
  engine.updateConversationMemory({
    conversationId,
    message:
      incoming.message
  });

assert.strictEqual(
  memory.ok,
  true
);

assert.ok(
  memory.context
);

assert.strictEqual(
  memory.context.clientId,
  "client-memory-001"
);

assert.ok(
  memory.context.requirements.length >= 1
);

assert.ok(
  memory.context.scope.length >= 1
);

assert.ok(
  memory.context.deliverables.length >= 1
);

assert.strictEqual(
  memory.context.deadline,
  "Friday"
);

assert.ok(
  memory.context.questions.length >= 1
);

console.log("PASS");

console.log(
  "[5] Preserve existing context"
);

const secondMessage =
  store.createStoredMessage({
    conversationId,
    clientId: "client-memory-001",
    participant: "client",
    direction: "incoming",
    status: "received",
    content:
      "Please also support mobile devices. We decided to use the existing branding."
  });

assert.strictEqual(
  secondMessage.ok,
  true
);

const secondMemory =
  engine.updateConversationMemory({
    conversationId,
    message:
      secondMessage.message
  });

assert.strictEqual(
  secondMemory.context.deadline,
  "Friday"
);

assert.ok(
  secondMemory.context.requirements.length >= 2
);

assert.ok(
  secondMemory.context.decisions.length >= 1
);

console.log("PASS");

console.log(
  "[6] Conversation history"
);

const history =
  engine.getConversationHistory(
    conversationId
  );

assert.strictEqual(
  history.length,
  2
);

assert.strictEqual(
  history[0].participant,
  "client"
);

assert.strictEqual(
  history[1].participant,
  "client"
);

console.log("PASS");

console.log(
  "[7] Complete conversation memory"
);

const fullMemory =
  engine.getConversationMemory(
    conversationId
  );

assert.ok(
  fullMemory.conversation
);

assert.ok(
  fullMemory.context
);

assert.strictEqual(
  fullMemory.history.length,
  2
);

console.log("PASS");

console.log(
  "[8] Missing conversation rejection"
);

expectThrow(() =>
  engine.updateConversationMemory({
    conversationId:
      "missing-conversation",
    message: {
      content: "test"
    }
  })
);

console.log("PASS");

console.log(
  "[9] Missing message rejection"
);

expectThrow(() =>
  engine.updateConversationMemory({
    conversationId
  })
);

console.log("PASS");

console.log(
  "[10] Conversation mismatch rejection"
);

expectThrow(() =>
  engine.updateConversationMemory({
    conversationId,
    message: {
      conversationId:
        "different-conversation",
      content: "test"
    }
  })
);

console.log("PASS");

console.log(
  "\nSTAGE832_CONVERSATION_MEMORY_ENGINE_TEST: PASS"
);
