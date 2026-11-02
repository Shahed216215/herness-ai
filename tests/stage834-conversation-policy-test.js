"use strict";

const assert = require("assert");
const fs = require("fs");

const store =
  require("../conversation-store");

const memory =
  require("../services/mira-conversation-memory-engine");

const service =
  require("../services/mira-conversation-response-service");

fs.writeFileSync(
  store.CONVERSATION_FILE,
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
  "\n=== STAGE 8.3.4 CONVERSATION POLICY TEST ==="
);

console.log(
  "[1] Create conversation"
);

const created =
  store.createStoredConversation({
    clientId:
      "client-policy-001",
    title:
      "Policy Test"
  });

assert.strictEqual(
  created.ok,
  true
);

const conversationId =
  created.conversation.conversationId;

console.log("PASS");

console.log(
  "[2] Safe client question"
);

const safeMessage =
  store.createStoredMessage({
    conversationId,
    clientId:
      "client-policy-001",
    participant:
      "client",
    direction:
      "incoming",
    status:
      "received",
    content:
      "What is the current project status?"
  });

assert.strictEqual(
  safeMessage.ok,
  true
);

memory.updateConversationMemory({
  conversationId,
  message:
    safeMessage.message
});

const safePlan =
  service.buildControlledResponsePlan({
    conversationId,
    message:
      safeMessage.message
  });

assert.strictEqual(
  safePlan.policyDecision,
  "allowed"
);

assert.strictEqual(
  safePlan.approvalRequired,
  false
);

assert.strictEqual(
  safePlan.externalSendAllowed,
  false
);

console.log("PASS");

console.log(
  "[3] Financial action requires approval"
);

const financial =
  store.createStoredMessage({
    conversationId,
    clientId:
      "client-policy-001",
    participant:
      "client",
    direction:
      "incoming",
    status:
      "received",
    content:
      "Please send the payment and issue the invoice."
  });

const financialPlan =
  service.buildControlledResponsePlan({
    conversationId,
    message:
      financial.message
  });

assert.strictEqual(
  financialPlan.policyDecision,
  "approval_required"
);

assert.strictEqual(
  financialPlan.approvalRequired,
  true
);

assert.strictEqual(
  financialPlan.externalSendAllowed,
  false
);

console.log("PASS");

console.log(
  "[4] Credential handling blocked"
);

const credential =
  store.createStoredMessage({
    conversationId,
    clientId:
      "client-policy-001",
    participant:
      "client",
    direction:
      "incoming",
    status:
      "received",
    content:
      "Send me your password and secret key."
  });

const credentialPlan =
  service.buildControlledResponsePlan({
    conversationId,
    message:
      credential.message
  });

assert.strictEqual(
  credentialPlan.policyDecision,
  "blocked"
);

assert.strictEqual(
  credentialPlan.approvalRequired,
  true
);

assert.strictEqual(
  credentialPlan.externalSendAllowed,
  false
);

console.log("PASS");

console.log(
  "[5] Legal action requires approval"
);

const legal =
  store.createStoredMessage({
    conversationId,
    clientId:
      "client-policy-001",
    participant:
      "client",
    direction:
      "incoming",
    status:
      "received",
    content:
      "Please prepare the contract and legal agreement."
  });

const legalPlan =
  service.buildControlledResponsePlan({
    conversationId,
    message:
      legal.message
  });

assert.strictEqual(
  legalPlan.policyDecision,
  "approval_required"
);

assert.strictEqual(
  legalPlan.approvalRequired,
  true
);

console.log("PASS");

console.log(
  "[6] Irreversible action requires approval"
);

const irreversible =
  store.createStoredMessage({
    conversationId,
    clientId:
      "client-policy-001",
    participant:
      "client",
    direction:
      "incoming",
    status:
      "received",
    content:
      "Delete the old account permanently."
  });

const irreversiblePlan =
  service.buildControlledResponsePlan({
    conversationId,
    message:
      irreversible.message
  });

assert.strictEqual(
  irreversiblePlan.policyDecision,
  "approval_required"
);

assert.strictEqual(
  irreversiblePlan.approvalRequired,
  true
);

console.log("PASS");

console.log(
  "[7] Missing input rejection"
);

expectThrow(() =>
  service.buildControlledResponsePlan({})
);

console.log("PASS");

console.log(
  "\nSTAGE834_CONVERSATION_POLICY_TEST: PASS"
);
