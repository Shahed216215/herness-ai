"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const jsonStateStore = require('./services/mira-json-state-store');
const { createStoreInitializationGuard } = require('./services/mira-store-initialization-guard');

const {
  createConversation,
  createConversationMessage,
  createConversationContext
} = require("./conversation-schema");

const CONVERSATION_FILE =
  storagePath("data/conversations.json");
const CONVERSATION_GUARD = createStoreInitializationGuard({
  primaryFile: CONVERSATION_FILE,
  storeId: 'MIRA_CONVERSATION_STORE'
});

function validateStore(store) {
  if (
    !store ||
    typeof store !== "object" ||
    Array.isArray(store) ||
    !Array.isArray(store.conversations) ||
    !Array.isArray(store.messages) ||
    !Array.isArray(store.contexts)
  ) {
    throw new Error("Invalid conversation store format.");
  }
  return store;
}

function ensureStore() {
  try {
    const stat = fs.lstatSync(CONVERSATION_FILE);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Conversation store is not a safe regular file.");
    }
    CONVERSATION_GUARD.ensureMarker();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (CONVERSATION_GUARD.missingPrimaryDecision() === 'PREVIOUSLY_INITIALIZED') {
      const missing = new Error(
        'Conversation store was previously initialized but its primary is missing; empty reinitialization is blocked.'
      );
      missing.code = 'CONVERSATION_PRIMARY_MISSING_RESTORE_REQUIRED';
      throw missing;
    }
    CONVERSATION_GUARD.ensureMarker();
    const initial = {
      version: 1,
      updatedAt: new Date().toISOString(),
      conversations: [],
      messages: [],
      contexts: []
    };
    const result = jsonStateStore.atomicWriteJson(
      CONVERSATION_FILE,
      initial,
      "Mira conversation store"
    );
    try {
      jsonStateStore.recordStateAudit(
        "conversation_store_initialized",
        "success",
        CONVERSATION_FILE,
        {
          stateHash: result.sha256,
          conversationCount: 0,
          messageCount: 0,
          contextCount: 0
        }
      );
    } catch (auditError) {
      auditError.code = "CONVERSATION_STORE_INITIALIZED_AUDIT_FAILED";
      auditError.stateCommitted = true;
      throw auditError;
    }
  }
}
function loadStore() {
  ensureStore();

  let raw;
  try {
    const stat = fs.lstatSync(CONVERSATION_FILE);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Conversation store is not a safe regular file.");
    }
    raw = fs.readFileSync(CONVERSATION_FILE, "utf8");
  } catch (error) {
    throw new Error(
      "Conversation store cannot be read: " +
      (error.code || error.message || "IO_ERROR")
    );
  }

  if (!raw.trim()) {
    throw new Error("Conversation store is empty and may be corrupted.");
  }

  let store;
  try {
    store = JSON.parse(raw);
  } catch {
    throw new Error("Conversation store contains invalid JSON.");
  }
  return validateStore(store);
}

function saveStore(store) {
  validateStore(store);
  // Refuse to replace a corrupt or unsafe existing state through a direct save call.
  loadStore();
  const updated = {
    ...store,
    updatedAt: new Date().toISOString()
  };
  const result = jsonStateStore.atomicWriteJson(
    CONVERSATION_FILE,
    updated,
    "Mira conversation store"
  );
  try {
    jsonStateStore.recordStateAudit(
      "conversation_store_write_committed",
      "success",
      CONVERSATION_FILE,
      {
        stateHash: result.sha256,
        conversationCount: updated.conversations.length,
        messageCount: updated.messages.length,
        contextCount: updated.contexts.length
      }
    );
  } catch (error) {
    error.code = "CONVERSATION_STORE_COMMITTED_AUDIT_FAILED";
    error.stateCommitted = true;
    throw error;
  }
  return updated;
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
