"use strict";

const CONVERSATION_STATUSES = Object.freeze([
  "active",
  "waiting_client",
  "waiting_mira",
  "waiting_approval",
  "completed",
  "archived"
]);

const PARTICIPANT_TYPES = Object.freeze([
  "client",
  "mira",
  "system"
]);

const MESSAGE_DIRECTIONS = Object.freeze([
  "incoming",
  "outgoing"
]);

const MESSAGE_STATUSES = Object.freeze([
  "received",
  "draft",
  "approved",
  "sent",
  "archived"
]);

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 12)}`;
}

function cleanText(value, field, max = 5000) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  const text = String(value).trim();

  if (text.length > max) {
    throw new Error(
      `${field} exceeds maximum length.`
    );
  }

  return text;
}

function cleanList(
  value,
  field,
  maxItems = 100,
  itemMax = 2000
) {
  if (
    value === undefined ||
    value === null
  ) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(
      `${field} must be an array.`
    );
  }

  if (value.length > maxItems) {
    throw new Error(
      `${field} exceeds maximum item count.`
    );
  }

  return value.map(item =>
    cleanText(
      item,
      field,
      itemMax
    )
  );
}

function normalizeEnum(
  value,
  allowed,
  field,
  fallback
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (!allowed.includes(normalized)) {
    throw new Error(
      `Invalid ${field}.`
    );
  }

  return normalized;
}

function createConversation(input = {}) {
  const createdAt =
    input.createdAt || now();

  const clientId =
    cleanText(
      input.clientId,
      "clientId",
      200
    );

  if (!clientId) {
    throw new Error(
      "clientId is required."
    );
  }

  return {
    conversationId:
      cleanText(
        input.conversationId,
        "conversationId",
        200
      ) ||
      createId("conversation"),

    clientId,

    opportunityId:
      cleanText(
        input.opportunityId,
        "opportunityId",
        200
      ) || null,

    proposalId:
      cleanText(
        input.proposalId,
        "proposalId",
        200
      ) || null,

    title:
      cleanText(
        input.title,
        "title",
        300
      ) || "Client Conversation",

    status:
      normalizeEnum(
        input.status,
        CONVERSATION_STATUSES,
        "conversation status",
        "active"
      ),

    messageCount:
      Number.isInteger(
        input.messageCount
      ) &&
      input.messageCount >= 0
        ? input.messageCount
        : 0,

    lastMessageAt:
      input.lastMessageAt ||
      null,

    createdAt,

    updatedAt:
      input.updatedAt ||
      createdAt
  };
}

function createConversationMessage(
  input = {}
) {
  const content =
    cleanText(
      input.content,
      "content",
      10000
    );

  if (!content) {
    throw new Error(
      "content is required."
    );
  }

  const createdAt =
    input.createdAt || now();

  return {
    messageId:
      cleanText(
        input.messageId,
        "messageId",
        200
      ) ||
      createId("conversation-message"),

    conversationId:
      cleanText(
        input.conversationId,
        "conversationId",
        200
      ),

    clientId:
      cleanText(
        input.clientId,
        "clientId",
        200
      ),

    participant:
      normalizeEnum(
        input.participant,
        PARTICIPANT_TYPES,
        "participant",
        "client"
      ),

    direction:
      normalizeEnum(
        input.direction,
        MESSAGE_DIRECTIONS,
        "message direction",
        "incoming"
      ),

    status:
      normalizeEnum(
        input.status,
        MESSAGE_STATUSES,
        "message status",
        "received"
      ),

    content,

    source:
      cleanText(
        input.source,
        "source",
        500
      ) || "manual",

    externalMessageId:
      cleanText(
        input.externalMessageId,
        "externalMessageId",
        500
      ) || null,

    createdAt,

    updatedAt:
      input.updatedAt ||
      createdAt
  };
}

function createConversationContext(
  input = {}
) {
  return {
    contextId:
      cleanText(
        input.contextId,
        "contextId",
        200
      ) ||
      createId("context"),

    conversationId:
      cleanText(
        input.conversationId,
        "conversationId",
        200
      ),

    clientId:
      cleanText(
        input.clientId,
        "clientId",
        200
      ),

    opportunityId:
      cleanText(
        input.opportunityId,
        "opportunityId",
        200
      ) || null,

    proposalId:
      cleanText(
        input.proposalId,
        "proposalId",
        200
      ) || null,

    requirements:
      cleanList(
        input.requirements,
        "requirements",
        100,
        2000
      ),

    scope:
      cleanList(
        input.scope,
        "scope",
        100,
        2000
      ),

    deliverables:
      cleanList(
        input.deliverables,
        "deliverables",
        100,
        2000
      ),

    deadline:
      cleanText(
        input.deadline,
        "deadline",
        500
      ) || null,

    questions:
      cleanList(
        input.questions,
        "questions",
        100,
        2000
      ),

    revisions:
      cleanList(
        input.revisions,
        "revisions",
        100,
        2000
      ),

    constraints:
      cleanList(
        input.constraints,
        "constraints",
        100,
        2000
      ),

    decisions:
      cleanList(
        input.decisions,
        "decisions",
        100,
        2000
      ),

    updatedAt:
      input.updatedAt || now()
  };
}

module.exports = {
  CONVERSATION_STATUSES,
  PARTICIPANT_TYPES,
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUSES,
  createConversation,
  createConversationMessage,
  createConversationContext
};
