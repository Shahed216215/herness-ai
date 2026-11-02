"use strict";

const store =
  require("../conversation-store");

const memoryEngine =
  require("./mira-conversation-memory-engine");

const RESPONSE_TYPES = Object.freeze([
  "acknowledge",
  "answer",
  "clarification",
  "revision_acknowledgement",
  "status_update",
  "delivery_response",
  "general_response"
]);

const PRIORITIES = Object.freeze([
  "low",
  "medium",
  "high"
]);

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function detectIntent(message) {
  const text =
    cleanText(message?.content).toLowerCase();

  if (!text) {
    return "unknown";
  }

  if (
    text.includes("?") ||
    /^(what|which|when|where|how|can|could|would|is|are|do|does)\b/i.test(text)
  ) {
    return "question";
  }

  if (
    /\b(change|changes|revise|revision|modify|update|replace)\b/i.test(text)
  ) {
    return "revision_request";
  }

  if (
    /\b(status|progress|update)\b/i.test(text)
  ) {
    return "status_request";
  }

  if (
    /\b(deliver|delivery|send|submit)\b/i.test(text)
  ) {
    return "delivery_request";
  }

  if (
    /\b(need|require|requires|requirement)\b/i.test(text)
  ) {
    return "new_requirement";
  }

  return "general_conversation";
}

function determineResponseType(intent) {
  switch (intent) {
    case "question":
      return "answer";

    case "revision_request":
      return "revision_acknowledgement";

    case "status_request":
      return "status_update";

    case "delivery_request":
      return "delivery_response";

    case "new_requirement":
      return "clarification";

    default:
      return "general_response";
  }
}

function determinePriority(intent, context) {
  if (
    intent === "delivery_request" ||
    intent === "revision_request"
  ) {
    return "high";
  }

  if (
    intent === "question" ||
    context?.deadline
  ) {
    return "medium";
  }

  return "low";
}

function findMissingContext(context) {
  const missing = [];

  if (!context) {
    return [
      "conversation context"
    ];
  }

  if (
    !Array.isArray(context.requirements) ||
    context.requirements.length === 0
  ) {
    missing.push("requirements");
  }

  if (
    !Array.isArray(context.deliverables) ||
    context.deliverables.length === 0
  ) {
    missing.push("deliverables");
  }

  return missing;
}

function planResponse(input = {}) {
  const conversationId =
    cleanText(input.conversationId);

  if (!conversationId) {
    throw new Error(
      "conversationId is required."
    );
  }

  const conversation =
    store.getConversation(
      conversationId
    );

  if (!conversation) {
    throw new Error(
      "Conversation not found."
    );
  }

  const message =
    input.message;

  if (!message) {
    throw new Error(
      "message is required."
    );
  }

  if (!cleanText(message.content)) {
    throw new Error(
      "message.content is required."
    );
  }

  if (
    message.conversationId &&
    message.conversationId !==
      conversationId
  ) {
    throw new Error(
      "Message conversationId mismatch."
    );
  }

  const memory =
    memoryEngine.getConversationMemory(
      conversationId
    );

  const intent =
    detectIntent(message);

  const responseType =
    determineResponseType(intent);

  const priority =
    determinePriority(
      intent,
      memory.context
    );

  const missingContext =
    findMissingContext(
      memory.context
    );

  const clarificationNeeded =
    intent === "new_requirement" ||
    (
      responseType === "answer" &&
      missingContext.length > 0
    );

  return {
    ok: true,

    conversationId,

    clientId:
      conversation.clientId,

    messageId:
      message.messageId || null,

    intent,

    responseType,

    responseRequired: true,

    priority,

    acknowledge: true,

    clarificationNeeded,

    clarificationsNeeded:
      clarificationNeeded
        ? missingContext
        : [],

    contextUsed: {
      requirements:
        memory.context?.requirements || [],

      scope:
        memory.context?.scope || [],

      deliverables:
        memory.context?.deliverables || [],

      deadline:
        memory.context?.deadline || null,

      questions:
        memory.context?.questions || [],

      revisions:
        memory.context?.revisions || [],

      constraints:
        memory.context?.constraints || [],

      decisions:
        memory.context?.decisions || []
    },

    historyCount:
      memory.history.length,

    riskLevel: "low",

    approvalRequired: false,

    externalSendAllowed: false
  };
}

module.exports = {
  RESPONSE_TYPES,
  PRIORITIES,
  detectIntent,
  determineResponseType,
  determinePriority,
  planResponse
};
