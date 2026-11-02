"use strict";

const CLIENT_MESSAGE_TYPES = Object.freeze([
  "incoming",
  "outgoing_draft"
]);

const CLIENT_MESSAGE_STATUSES = Object.freeze([
  "received",
  "analyzed",
  "drafted",
  "policy_checked",
  "send_boundary",
  "archived"
]);

const CLIENT_INTENTS = Object.freeze([
  "question",
  "information_request",
  "clarification",
  "feedback",
  "revision_request",
  "status_request",
  "new_task",
  "delivery_request",
  "general_conversation",
  "unknown"
]);

const RESPONSE_REQUIREMENT_LEVELS = Object.freeze([
  "none",
  "low",
  "medium",
  "high",
  "unknown"
]);

const CLIENT_POLICY_DECISIONS = Object.freeze([
  "allowed",
  "restricted",
  "approval_required",
  "blocked",
  "unknown"
]);

const SEND_BOUNDARY_STATUSES = Object.freeze([
  "not_ready",
  "ready_for_review",
  "approval_required",
  "blocked",
  "not_implemented"
]);

function now() {
  return new Date().toISOString();
}

function createMessageId() {
  return `client-message-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 14)}`;
}

function createConversationId() {
  return `conversation-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 14)}`;
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
  itemMax = 500
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

function createClientMessage(input = {}) {
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
      input.messageId ||
      createMessageId(),

    conversationId:
      cleanText(
        input.conversationId,
        "conversationId",
        200
      ) || null,

    clientId:
      cleanText(
        input.clientId,
        "clientId",
        200
      ) || null,

    type:
      normalizeEnum(
        input.type,
        CLIENT_MESSAGE_TYPES,
        "message type",
        "incoming"
      ),

    status:
      normalizeEnum(
        input.status,
        CLIENT_MESSAGE_STATUSES,
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

    receivedAt:
      input.receivedAt ||
      createdAt,

    createdAt,

    updatedAt:
      input.updatedAt ||
      createdAt
  };
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

  return {
    conversationId:
      input.conversationId ||
      createConversationId(),

    clientId:
      clientId || null,

    title:
      cleanText(
        input.title,
        "title",
        300
      ),

    status:
      cleanText(
        input.status,
        "status",
        100
      ) || "active",

    messageCount:
      Number.isInteger(
        input.messageCount
      ) && input.messageCount >= 0
        ? input.messageCount
        : 0,

    createdAt,

    updatedAt:
      input.updatedAt ||
      createdAt
  };
}

function createIntentAnalysis(input = {}) {
  return {
    intent:
      normalizeEnum(
        input.intent,
        CLIENT_INTENTS,
        "intent",
        "unknown"
      ),

    confidence:
      typeof input.confidence === "number" &&
      input.confidence >= 0 &&
      input.confidence <= 1
        ? input.confidence
        : null,

    reasons:
      cleanList(
        input.reasons,
        "intent.reasons",
        20,
        1000
      ),

    analyzedAt:
      input.analyzedAt || now()
  };
}

function createContextAnalysis(input = {}) {
  return {
    conversationSummary:
      cleanText(
        input.conversationSummary,
        "context.conversationSummary",
        3000
      ),

    knownFacts:
      cleanList(
        input.knownFacts,
        "context.knownFacts",
        50,
        1000
      ),

    unresolvedPoints:
      cleanList(
        input.unresolvedPoints,
        "context.unresolvedPoints",
        50,
        1000
      ),

    relevantTasks:
      cleanList(
        input.relevantTasks,
        "context.relevantTasks",
        50,
        300
      ),

    relevantOpportunities:
      cleanList(
        input.relevantOpportunities,
        "context.relevantOpportunities",
        50,
        300
      ),

    contextReady:
      Boolean(input.contextReady),

    analyzedAt:
      input.analyzedAt || now()
  };
}

function createResponseRequirements(input = {}) {
  return {
    level:
      normalizeEnum(
        input.level,
        RESPONSE_REQUIREMENT_LEVELS,
        "response requirement level",
        "unknown"
      ),

    mustAddress:
      cleanList(
        input.mustAddress,
        "responseRequirements.mustAddress",
        50,
        1000
      ),

    requiredInformation:
      cleanList(
        input.requiredInformation,
        "responseRequirements.requiredInformation",
        50,
        1000
      ),

    prohibitedContent:
      cleanList(
        input.prohibitedContent,
        "responseRequirements.prohibitedContent",
        50,
        1000
      ),

    expectedFormat:
      cleanText(
        input.expectedFormat,
        "responseRequirements.expectedFormat",
        500
      ),

    requirementsReady:
      Boolean(input.requirementsReady)
  };
}

function createDraft(input = {}) {
  return {
    content:
      cleanText(
        input.content,
        "draft.content",
        10000
      ),

    tone:
      cleanText(
        input.tone,
        "draft.tone",
        200
      ) || "professional",

    addressesRequirements:
      Boolean(input.addressesRequirements),

    generatedAt:
      input.generatedAt || now()
  };
}

function createPolicyDecision(input = {}) {
  const decision =
    normalizeEnum(
      input.decision,
      CLIENT_POLICY_DECISIONS,
      "policy decision",
      "unknown"
    );

  return {
    decision,

    findings:
      cleanList(
        input.findings,
        "policy.findings",
        50,
        1000
      ),

    reasons:
      cleanList(
        input.reasons,
        "policy.reasons",
        50,
        1000
      ),

    contractualCommitment:
      Boolean(
        input.contractualCommitment
      ),

    financialCommitment:
      Boolean(
        input.financialCommitment
      ),

    legalCommitment:
      Boolean(
        input.legalCommitment
      ),

    irreversibleAction:
      Boolean(
        input.irreversibleAction
      ),

    policyChecked:
      Boolean(input.policyChecked),

    evaluatedAt:
      input.evaluatedAt || now()
  };
}

function createSendBoundary(input = {}) {
  const status =
    normalizeEnum(
      input.status,
      SEND_BOUNDARY_STATUSES,
      "send boundary status",
      "not_implemented"
    );

  return {
    status,

    sendAllowed: false,

    externalSendImplemented: false,

    approvalRequired:
      Boolean(input.approvalRequired),

    reasons:
      cleanList(
        input.reasons,
        "sendBoundary.reasons",
        50,
        1000
      ),

    blockedBy:
      cleanList(
        input.blockedBy,
        "sendBoundary.blockedBy",
        50,
        500
      ),

    evaluatedAt:
      input.evaluatedAt || now()
  };
}

function createClientCommunicationRecord(
  input = {}
) {
  const createdAt =
    input.createdAt || now();

  const inputMessage =
    input.message || input;

  const conversationId =
    cleanText(
      input.conversationId ||
      inputMessage.conversationId,
      "conversationId",
      200
    ) || createConversationId();

  const message =
    createClientMessage({
      ...inputMessage,
      conversationId
    });

  return {
    communicationId:
      input.communicationId ||
      `communication-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2, 14)}`,

    conversationId,

    clientId:
      message.clientId ||
      cleanText(
        input.clientId,
        "clientId",
        200
      ) ||
      null,

    message,

    intent:
      createIntentAnalysis(
        input.intent || {}
      ),

    context:
      createContextAnalysis(
        input.context || {}
      ),

    responseRequirements:
      createResponseRequirements(
        input.responseRequirements || {}
      ),

    draft:
      createDraft(
        input.draft || {}
      ),

    policy:
      createPolicyDecision(
        input.policy || {}
      ),

    sendBoundary:
      createSendBoundary(
        input.sendBoundary || {}
      ),

    createdAt,

    updatedAt:
      input.updatedAt || createdAt
  };
}

module.exports = {
  CLIENT_MESSAGE_TYPES,
  CLIENT_MESSAGE_STATUSES,
  CLIENT_INTENTS,
  RESPONSE_REQUIREMENT_LEVELS,
  CLIENT_POLICY_DECISIONS,
  SEND_BOUNDARY_STATUSES,
  createClientMessage,
  createConversation,
  createIntentAnalysis,
  createContextAnalysis,
  createResponseRequirements,
  createDraft,
  createPolicyDecision,
  createSendBoundary,
  createClientCommunicationRecord
};
