"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');

const {
  createConversation,
  createClientMessage,
  createClientCommunicationRecord
} = require("./client-communication-schema");

const CLIENT_COMMUNICATION_FILE =
  storagePath("data/client-communications.json");

function ensureStore() {
  const dataDir =
    path.dirname(
      CLIENT_COMMUNICATION_FILE
    );

  fs.mkdirSync(
    dataDir,
    { recursive: true }
  );

  if (
    !fs.existsSync(
      CLIENT_COMMUNICATION_FILE
    )
  ) {
    const initialStore = {
      version: 1,
      updatedAt:
        new Date().toISOString(),
      conversations: [],
      messages: [],
      communications: []
    };

    fs.writeFileSync(
      CLIENT_COMMUNICATION_FILE,
      JSON.stringify(
        initialStore,
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
      CLIENT_COMMUNICATION_FILE,
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
      store.communications
    )
  ) {
    throw new Error(
      "Invalid client communication store."
    );
  }

  return store;
}

function saveStore(store) {
  ensureStore();

  store.updatedAt =
    new Date().toISOString();

  const temporaryFile =
    `${CLIENT_COMMUNICATION_FILE}.tmp`;

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
    CLIENT_COMMUNICATION_FILE
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
      conversation =>
        conversation.conversationId ===
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
        conversation =>
          conversation.clientId ===
          options.clientId
      );
  }

  if (options.status) {
    results =
      results.filter(
        conversation =>
          conversation.status ===
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

  const duplicate =
    store.conversations.some(
      existing =>
        existing.conversationId ===
        conversation.conversationId
    );

  if (duplicate) {
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

function getMessage(messageId) {
  const store =
    loadStore();

  return (
    store.messages.find(
      message =>
        message.messageId ===
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
        message =>
          message.conversationId ===
          options.conversationId
      );
  }

  if (options.clientId) {
    results =
      results.filter(
        message =>
          message.clientId ===
          options.clientId
      );
  }

  if (options.type) {
    results =
      results.filter(
        message =>
          message.type ===
          options.type
      );
  }

  return results;
}

function createStoredMessage(
  input = {}
) {
  const message =
    createClientMessage(input);

  const store =
    loadStore();

  const duplicate =
    store.messages.some(
      existing =>
        existing.messageId ===
        message.messageId
    );

  if (duplicate) {
    return {
      ok: false,
      status: "duplicate",
      message: null
    };
  }

  store.messages.push(
    message
  );

  saveStore(store);

  return {
    ok: true,
    status: "created",
    message
  };
}

function getCommunication(
  communicationId
) {
  const store =
    loadStore();

  return (
    store.communications.find(
      communication =>
        communication.communicationId ===
        communicationId
    ) || null
  );
}

function listCommunications(
  options = {}
) {
  const store =
    loadStore();

  let results =
    [...store.communications];

  if (options.conversationId) {
    results =
      results.filter(
        communication =>
          communication.conversationId ===
          options.conversationId
      );
  }

  if (options.clientId) {
    results =
      results.filter(
        communication =>
          communication.clientId ===
          options.clientId
      );
  }

  if (options.policyDecision) {
    results =
      results.filter(
        communication =>
          communication.policy &&
          communication.policy.decision ===
          options.policyDecision
      );
  }

  return results;
}

function createStoredCommunication(
  input = {}
) {
  const communication =
    createClientCommunicationRecord(
      input
    );

  const store =
    loadStore();

  const duplicate =
    store.communications.some(
      existing =>
        existing.communicationId ===
        communication.communicationId
    );

  if (duplicate) {
    return {
      ok: false,
      status: "duplicate",
      communication: null
    };
  }

  store.communications.push(
    communication
  );

  saveStore(store);

  return {
    ok: true,
    status: "created",
    communication
  };
}

function updateCommunication(
  communicationId,
  updates = {}
) {
  const store =
    loadStore();

  const index =
    store.communications.findIndex(
      communication =>
        communication.communicationId ===
        communicationId
    );

  if (index === -1) {
    return {
      ok: false,
      status: "not_found",
      communication: null
    };
  }

  const current =
    store.communications[index];

  const merged = {
    ...current,
    ...updates,
    communicationId:
      current.communicationId,
    createdAt:
      current.createdAt,
    updatedAt:
      new Date().toISOString()
  };

  const validated =
    createClientCommunicationRecord(
      merged
    );

  store.communications[index] =
    validated;

  saveStore(store);

  return {
    ok: true,
    status: "updated",
    communication:
      validated
  };
}

function countCommunications() {
  return loadStore()
    .communications.length;
}

function getStorePath() {
  return CLIENT_COMMUNICATION_FILE;
}

module.exports = {
  CLIENT_COMMUNICATION_FILE,

  ensureStore,
  loadStore,
  saveStore,

  getConversation,
  listConversations,
  createStoredConversation,

  getMessage,
  listMessages,
  createStoredMessage,

  getCommunication,
  listCommunications,
  createStoredCommunication,
  updateCommunication,

  countCommunications,
  getStorePath
};
