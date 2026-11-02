"use strict";

const assert = require("assert");
const fs = require("fs");

const store =
  require("../conversation-store");

const memoryEngine =
  require("../services/mira-conversation-memory-engine");

const planner =
  require("../services/mira-conversation-response-planner");

const TEST_FILE =
  store.CONVERSATION_FILE;

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

function expectThrow(fn) {
  let thrown = false;

  try {
    fn();
  } catch (error) {
    thrown = true;
  }

  assert.strictEqual(
    thrown,
    true
  );
}

console.log(
  "\n=== STAGE 8.3.3 RESPONSE PLANNER TEST ==="
);

console.log(
  "[1] Create conversation"
);

const created =
  store.createStoredConversation({
    clientId: "client-response-001",
    opportunityId: "opp-response-001",
    proposalId: "proposal-response-001",
    title: "Response Planner Test"
  });

assert.strictEqual(
  created.ok,
  true
);

const conversationId =
  created.conversation.conversationId;

console.log("PASS");

console.log(
  "[2] Store client question"
);

const message =
  store.createStoredMessage({
    conversationId,
    clientId: "client-response-001",
    participant: "client",
    direction: "incoming",
    status: "received",
    content:
      "Which hosting provider will you use?"
  });

assert.strictEqual(
  message.ok,
  true
);

console.log("PASS");

console.log(
  "[3] Build conversation memory"
);

memoryEngine.updateConversationMemory({
  conversationId,
  message: message.message
});

const memory =
  memoryEngine.getConversationMemory(
    conversationId
  );

assert.ok(memory.context);
assert.strictEqual(
  memory.history.length,
  1
);

console.log("PASS");

console.log(
  "[4] Detect question intent"
);

assert.strictEqual(
  planner.detectIntent(
    message.message
  ),
  "question"
);

console.log("PASS");

console.log(
  "[5] Create response plan"
);

const plan =
  planner.planResponse({
    conversationId,
    message: message.message
  });

assert.strictEqual(
  plan.ok,
  true
);

assert.strictEqual(
  plan.conversationId,
  conversationId
);

assert.strictEqual(
  plan.clientId,
  "client-response-001"
);

assert.strictEqual(
  plan.intent,
  "question"
);

assert.strictEqual(
  plan.responseType,
  "answer"
);

assert.strictEqual(
  plan.responseRequired,
  true
);

assert.strictEqual(
  plan.acknowledge,
  true
);

console.log("PASS");

console.log(
  "[6] Controlled send boundary"
);

assert.strictEqual(
  plan.externalSendAllowed,
  false
);

assert.strictEqual(
  plan.approvalRequired,
  false
);

console.log("PASS");

console.log(
  "[7] Revision request planning"
);

const revision =
  store.createStoredMessage({
    conversationId,
    clientId: "client-response-001",
    participant: "client",
    direction: "incoming",
    status: "received",
    content:
      "Please revise the contact form."
  });

const revisionPlan =
  planner.planResponse({
    conversationId,
    message:
      revision.message
  });

assert.strictEqual(
  revisionPlan.intent,
  "revision_request"
);

assert.strictEqual(
  revisionPlan.responseType,
  "revision_acknowledgement"
);

assert.strictEqual(
  revisionPlan.priority,
  "high"
);

console.log("PASS");

console.log(
  "[8] Delivery request planning"
);

const delivery =
  store.createStoredMessage({
    conversationId,
    clientId: "client-response-001",
    participant: "client",
    direction: "incoming",
    status: "received",
    content:
      "Please send the completed website."
  });

const deliveryPlan =
  planner.planResponse({
    conversationId,
    message:
      delivery.message
  });

assert.strictEqual(
  deliveryPlan.intent,
  "delivery_request"
);

assert.strictEqual(
  deliveryPlan.responseType,
  "delivery_response"
);

assert.strictEqual(
  deliveryPlan.priority,
  "high"
);

console.log("PASS");

console.log(
  "[9] Missing conversation rejection"
);

expectThrow(() =>
  planner.planResponse({
    conversationId:
      "missing-conversation",
    message: {
      content: "Hello"
    }
  })
);

console.log("PASS");

console.log(
  "[10] Missing message rejection"
);

expectThrow(() =>
  planner.planResponse({
    conversationId
  })
);

console.log("PASS");

console.log(
  "[11] Conversation mismatch rejection"
);

expectThrow(() =>
  planner.planResponse({
    conversationId,
    message: {
      conversationId:
        "another-conversation",
      content: "Hello"
    }
  })
);

console.log("PASS");

console.log(
  "\nSTAGE833_RESPONSE_PLANNER_TEST: PASS"
);
