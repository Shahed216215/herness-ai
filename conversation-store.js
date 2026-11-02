"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');

const {
  createConversation,
  createConversationMessage,
  createConversationContext
} = require("./conversation-schema");

const CONVERSATION_FILE =
  storagePath("data/conversations.json");

function ensureStore() {
  const dataDir =
    path.dirname(
      CONVERSATION_FILE
    );

  fs.mkdirSync(
    dataDir,
    { recursive: true }
  );

  if (
    !fs.existsSync(
      CONVERSATION_FILE
    )
  ) {
    fs.writeFileSync(
      CONVERSATION_FILE,
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
}

function loadStore() {
  ensureStore();

  const raw =
    fs.readFileSync(
      CONVERSATION_FILE,
      "utf8"
    );

  const store =
    JSON.parse(raw);

  if (
    !store ||
    typeof store !== "object" ||
    !Array.isArray(
      store.conversations
    ) ||
    !Array.isArray(
      store.messages
    ) ||
    !Array.isArray(
      store.contexts
    )
  ) {
    throw new Error(
      "Invalid conversation store format."
    );
  }

  return store;
}

function saveStore(store) {
  ensureStore();

  store.updatedAt =
    new Date().toISOString();

  const temporaryFile =
    `${CONVERSATION_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(
      store,
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.renameSync(
    temporaryFile,
    CONVERSATION_FILE
  );

  return store;
}

function getConversation(
  conversationId
) {
  const store =
    loadStore();

  return (
    store.conversations.find(
      item =>
        item.conversationId ===
        conversationId
    ) || null
  );
}

function listConversations(
  options = {}
) {
  const store =
    loadStore();

  let results =
    [...store.conversations];

  if (options.clientId) {
    results =
      results.filter(
        item =>
          item.clientId ===
          options.clientId
      );
  }

  if (options.opportunityId) {
    results =
      results.filter(
        item =>
          item.opportunityId ===
          options.opportunityId
      );
  }

  if (options.status) {
    results =
      results.filter(
        item =>
          item.status ===
          options.status
      );
  }

  return results;
}

function createStoredConversation(
  input = {}
) {
  const conversation =
    createConversation(input);

  const store =
    loadStore();

  if (
    store.conversations.some(
      item =>
        item.conversationId ===
        conversation.conversationId
    )
  ) {
    return {
      ok: false,
      status: "duplicate",
      conversation: null
    };
  }

  store.conversations.push(
    conversation
  );

  saveStore(store);

  return {
    ok: true,
    status: "created",
    conversation
  };
}

function updateConversation(
  conversationId,
  updates = {}
) {
  const store =
    loadStore();

  const index =
    store.conversations.findIndex(
      item =>
        item.conversationId ===
        conversationId
    );

  if (index === -1) {
    throw new Error(
      `Conversation not found: ${conversationId}`
    );
  }

  const current =
    store.conversations[index];

  const updated =
    createConversation({
      ...current,
      ...updates,
      conversationId:
        current.conversationId,
      clientId:
        current.clientId,
      createdAt:
        current.createdAt,
      updatedAt:
        new Date().toISOString()
    });

  store.conversations[index] =
    updated;

  saveStore(store);

  return updated;
}

function getMessage(
  messageId
) {
  const store =
    loadStore();

  return (
    store.messages.find(
      item =>
        item.messageId ===
        messageId
    ) || null
  );
}

function listMessages(
  options = {}
) {
  const store =
    loadStore();

  let results =
    [...store.messages];

  if (options.conversationId) {
    results =
      results.filter(
        item =>
          item.conversationId ===
          options.conversationId
      );
  }

  if (options.clientId) {
    results =
      results.filter(
        item =>
          item.clientId ===
          options.clientId
      );
  }

  if (options.direction) {
    results =
      results.filter(
        item =>
          item.direction ===
          options.direction
      );
  }

  return results;
}

function createStoredMessage(
  input = {}
) {
  const message =
    createConversationMessage(
      input
    );

  const store =
    loadStore();

  if (
    !store.conversations.some(
      item =>
        item.conversationId ===
        message.conversationId
    )
  ) {
    throw new Error(
      `Conversation not found: ${message.conversationId}`
    );
  }

  if (
    store.messages.some(
      item =>
        item.messageId ===
        message.messageId
    )
  ) {
    return {
      ok: false,
      status: "duplicate",
      message: null
    };
  }

  store.messages.push(
    message
  );

  const conversationIndex =
    store.conversations.findIndex(
      item =>
        item.conversationId ===
        message.conversationId
    );

  const conversation =
    store.conversations[
      conversationIndex
    ];

  store.conversations[
    conversationIndex
  ] = {
    ...conversation,
    messageCount:
      conversation.messageCount + 1,
    lastMessageAt:
      message.createdAt,
    updatedAt:
      new Date().toISOString()
  };

  saveStore(store);

  return {
    ok: true,
    status: "created",
    message
  };
}

function getContext(
  conversationId
) {
  const store =
    loadStore();

  return (
    store.contexts.find(
      item =>
        item.conversationId ===
        conversationId
    ) || null
  );
}

function saveContext(
  input = {}
) {
  const context =
    createConversationContext(
      input
    );

  const store =
    loadStore();

  const index =
    store.contexts.findIndex(
      item =>
        item.conversationId ===
        context.conversationId
    );

  if (index === -1) {
    store.contexts.push(
      context
    );
  } else {
    store.contexts[index] =
      {
        ...store.contexts[index],
        ...context,
        contextId:
          store.contexts[index]
            .contextId,
        conversationId:
          store.contexts[index]
            .conversationId,
        updatedAt:
          new Date().toISOString()
      };
  }

  saveStore(store);

  return getContext(
    context.conversationId
  );
}

function getStorePath() {
  return CONVERSATION_FILE;
}

module.exports = {
  CONVERSATION_FILE,
  loadStore,
  saveStore,
  getConversation,
  listConversations,
  createStoredConversation,
  updateConversation,
  getMessage,
  listMessages,
  createStoredMessage,
  getContext,
  saveContext,
  getStorePath
};
