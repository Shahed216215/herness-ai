"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const schema =
  require("../conversation-schema");

const store =
  require("../conversation-store");

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
  "\n=== STAGE 8.3 CONVERSATION STORE TEST ==="
);

resetStore();

console.log(
  "[1] Schema exports"
);

assert.ok(
  Array.isArray(
    schema.CONVERSATION_STATUSES
  )
);

assert.ok(
  Array.isArray(
    schema.PARTICIPANT_TYPES
  )
);

assert.ok(
  Array.isArray(
    schema.MESSAGE_DIRECTIONS
  )
);

assert.ok(
  Array.isArray(
    schema.MESSAGE_STATUSES
  )
);

console.log(
  "PASS"
);

console.log(
  "[2] Create conversation"
);

const created =
  store.createStoredConversation({
    clientId: "client-test-001",
    opportunityId:
      "opportunity-test-001",
    proposalId:
      "proposal-test-001",
    title:
      "Test Client Conversation"
  });

assert.strictEqual(
  created.ok,
  true
);

assert.strictEqual(
  created.status,
  "created"
);

assert.ok(
  created.conversation.conversationId
);

assert.strictEqual(
  created.conversation.clientId,
  "client-test-001"
);

assert.strictEqual(
  created.conversation.messageCount,
  0
);

console.log(
  "PASS"
);

const conversationId =
  created.conversation.conversationId;

console.log(
  "[3] Duplicate conversation protection"
);

const duplicate =
  store.createStoredConversation({
    conversationId,
    clientId: "client-test-001"
  });

assert.strictEqual(
  duplicate.ok,
  false
);

assert.strictEqual(
  duplicate.status,
  "duplicate"
);

console.log(
  "PASS"
);

console.log(
  "[4] Create incoming message"
);

const incoming =
  store.createStoredMessage({
    conversationId,
    clientId: "client-test-001",
    participant: "client",
    direction: "incoming",
    status: "received",
    content:
      "I need the website completed by Friday."
  });

assert.strictEqual(
  incoming.ok,
  true
);

assert.strictEqual(
  incoming.message.direction,
  "incoming"
);

assert.strictEqual(
  incoming.message.participant,
  "client"
);

console.log(
  "PASS"
);

console.log(
  "[5] Conversation counter update"
);

const afterIncoming =
  store.getConversation(
    conversationId
  );

assert.strictEqual(
  afterIncoming.messageCount,
  1
);

assert.ok(
  afterIncoming.lastMessageAt
);

console.log(
  "PASS"
);

console.log(
  "[6] Create outgoing message"
);

const outgoing =
  store.createStoredMessage({
    conversationId,
    clientId: "client-test-001",
    participant: "mira",
    direction: "outgoing",
    status: "draft",
    content:
      "Thanks. I’ll review the requirements."
  });

assert.strictEqual(
  outgoing.ok,
  true
);

assert.strictEqual(
  outgoing.message.direction,
  "outgoing"
);

console.log(
  "PASS"
);

console.log(
  "[7] Message listing"
);

const messages =
  store.listMessages({
    conversationId
  });

assert.strictEqual(
  messages.length,
  2
);

assert.strictEqual(
  store.listMessages({
    conversationId,
    direction: "incoming"
  }).length,
  1
);

assert.strictEqual(
  store.listMessages({
    conversationId,
    direction: "outgoing"
  }).length,
  1
);

console.log(
  "PASS"
);

console.log(
  "[8] Message lookup"
);

const foundMessage =
  store.getMessage(
    incoming.message.messageId
  );

assert.ok(foundMessage);

assert.strictEqual(
  foundMessage.content,
  "I need the website completed by Friday."
);

console.log(
  "PASS"
);

console.log(
  "[9] Duplicate message protection"
);

const duplicateMessage =
  store.createStoredMessage({
    messageId:
      incoming.message.messageId,
    conversationId,
    clientId: "client-test-001",
    participant: "client",
    direction: "incoming",
    content:
      "Duplicate message"
  });

assert.strictEqual(
  duplicateMessage.ok,
  false
);

assert.strictEqual(
  duplicateMessage.status,
  "duplicate"
);

console.log(
  "PASS"
);

console.log(
  "[10] Save conversation context"
);

const context =
  store.saveContext({
    conversationId,
    clientId: "client-test-001",
    opportunityId:
      "opportunity-test-001",
    proposalId:
      "proposal-test-001",
    requirements: [
      "Responsive website"
    ],
    scope: [
      "Landing page",
      "Contact form"
    ],
    deliverables: [
      "Completed website"
    ],
    deadline: "Friday",
    questions: [
      "Which hosting provider?"
    ],
    revisions: [
      "Initial revision pending"
    ],
    constraints: [
      "Use existing branding"
    ],
    decisions: [
      "Contact form required"
    ]
  });

assert.ok(context);

assert.strictEqual(
  context.conversationId,
  conversationId
);

assert.deepStrictEqual(
  context.requirements,
  ["Responsive website"]
);

assert.strictEqual(
  context.deadline,
  "Friday"
);

console.log(
  "PASS"
);

console.log(
  "[11] Context retrieval"
);

const retrievedContext =
  store.getContext(
    conversationId
  );

assert.ok(retrievedContext);

assert.strictEqual(
  retrievedContext.deadline,
  "Friday"
);

console.log(
  "PASS"
);

console.log(
  "[12] Context update"
);

const updatedContext =
  store.saveContext({
    conversationId,
    clientId: "client-test-001",
    requirements: [
      "Responsive website",
      "Mobile support"
    ],
    deadline: "Saturday"
  });

assert.strictEqual(
  updatedContext.deadline,
  "Saturday"
);

assert.deepStrictEqual(
  updatedContext.requirements,
  [
    "Responsive website",
    "Mobile support"
  ]
);

assert.strictEqual(
  updatedContext.contextId,
  context.contextId
);

console.log(
  "PASS"
);

console.log(
  "[13] Conversation listing"
);

const conversations =
  store.listConversations({
    clientId: "client-test-001"
  });

assert.strictEqual(
  conversations.length,
  1
);

assert.strictEqual(
  conversations[0].conversationId,
  conversationId
);

console.log(
  "PASS"
);

console.log(
  "[14] Persistence / reload"
);

delete require.cache[
  require.resolve(
    "../conversation-store"
  )
];

const reloadedStore =
  require(
    "../conversation-store"
  );

const persistedConversation =
  reloadedStore.getConversation(
    conversationId
  );

const persistedMessages =
  reloadedStore.listMessages({
    conversationId
  });

const persistedContext =
  reloadedStore.getContext(
    conversationId
  );

assert.ok(
  persistedConversation
);

assert.strictEqual(
  persistedConversation.messageCount,
  2
);

assert.strictEqual(
  persistedMessages.length,
  2
);

assert.ok(
  persistedContext
);

assert.strictEqual(
  persistedContext.deadline,
  "Saturday"
);

console.log(
  "PASS"
);

console.log(
  "[15] Invalid conversation rejection"
);

expectThrow(() =>
  schema.createConversation({})
);

console.log(
  "PASS"
);

console.log(
  "[16] Invalid message rejection"
);

expectThrow(() =>
  schema.createConversationMessage({
    conversationId,
    clientId: "client-test-001",
    content: ""
  })
);

console.log(
  "PASS"
);

console.log(
  "[17] Invalid context rejection"
);

expectThrow(() =>
  schema.createConversationContext({
    conversationId,
    clientId: "client-test-001",
    requirements: "not-an-array"
  })
);

console.log(
  "PASS"
);

console.log(
  "\nSTAGE83_CONVERSATION_STORE_TEST: PASS"
);
