"use strict";

const {
  createConversationContext
} = require("../conversation-schema");

const store =
  require("../conversation-store");

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function unique(list) {
  return [
    ...new Set(
      (Array.isArray(list) ? list : [])
        .map(cleanText)
        .filter(Boolean)
    )
  ];
}

function addUnique(existing, values) {
  return unique([
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(values) ? values : [])
  ]);
}

function extractDeadline(text) {
  const value = cleanText(text);

  const match = value.match(
    /\b(?:by|before|deadline(?:\s+is)?|due(?:\s+on)?)\s+([^.!?\n]+)/i
  );

  return match
    ? match[1].trim()
    : null;
}

function extractRequirements(text) {
  const value = cleanText(text);
  const results = [];

  const patterns = [
    /(?:i need|we need|need|requires?|requirement is)\s+([^.!?\n]+)/i,
    /(?:must have|must include|should include|should support|please also support|please support)\s+([^.!?\n]+)/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      results.push(match[1].trim());
    }
  }

  return results;
}

function extractScope(text) {
  const value = cleanText(text);
  const results = [];

  const match = value.match(
    /(?:scope(?: is| includes)?|include(?:s)?)\s+([^.!?\n]+)/i
  );

  if (match) {
    results.push(match[1].trim());
  }

  return results;
}

function extractDeliverables(text) {
  const value = cleanText(text);
  const results = [];

  const match = value.match(
    /(?:deliver(?:able|ables)|deliverables are|please deliver)\s*:?\s*([^.!?\n]+)/i
  );

  if (match) {
    results.push(match[1].trim());
  }

  return results;
}

function extractQuestions(text) {
  const value = cleanText(text);
  const results = [];

  if (value.includes("?")) {
    const parts = value
      .split("?")
      .map(item => item.trim())
      .filter(Boolean);

    for (const part of parts) {
      results.push(`${part}?`);
    }
  }

  return results;
}

function extractRevisions(text) {
  const value = cleanText(text);
  const results = [];

  const match = value.match(
    /(?:revision|revise|change|changes|update|updates|modify|modify the)\s*:?\s*([^.!?\n]+)/i
  );

  if (match) {
    results.push(match[1].trim());
  }

  return results;
}

function extractConstraints(text) {
  const value = cleanText(text);
  const results = [];

  const match = value.match(
    /(?:must not|cannot|can't|constraint|constraints|only|use existing)\s+([^.!?\n]+)/i
  );

  if (match) {
    results.push(match[1].trim());
  }

  return results;
}

function extractDecisions(text) {
  const value = cleanText(text);
  const results = [];

  const match = value.match(
    /(?:we decided|decision|decided|agreed|agreement)\s*:?\s*([^.!?\n]+)/i
  );

  if (match) {
    results.push(match[1].trim());
  }

  return results;
}

function getConversationHistory(conversationId) {
  return store
    .listMessages({ conversationId })
    .map(message => ({
      messageId: message.messageId,
      participant: message.participant,
      direction: message.direction,
      status: message.status,
      content: message.content,
      createdAt: message.createdAt
    }));
}

function mergeContext(existing, extracted, input) {
  const context = createConversationContext({
    contextId:
      existing?.contextId,

    conversationId:
      input.conversationId,

    clientId:
      input.clientId || existing?.clientId,

    opportunityId:
      input.opportunityId ||
      existing?.opportunityId,

    proposalId:
      input.proposalId ||
      existing?.proposalId,

    requirements:
      addUnique(
        existing?.requirements,
        extracted.requirements
      ),

    scope:
      addUnique(
        existing?.scope,
        extracted.scope
      ),

    deliverables:
      addUnique(
        existing?.deliverables,
        extracted.deliverables
      ),

    deadline:
      extracted.deadline ||
      existing?.deadline ||
      null,

    questions:
      addUnique(
        existing?.questions,
        extracted.questions
      ),

    revisions:
      addUnique(
        existing?.revisions,
        extracted.revisions
      ),

    constraints:
      addUnique(
        existing?.constraints,
        extracted.constraints
      ),

    decisions:
      addUnique(
        existing?.decisions,
        extracted.decisions
      )
  });

  return context;
}

function extractContextFromMessage(message) {
  if (!message || typeof message !== "object") {
    throw new Error(
      "message is required."
    );
  }

  const content =
    cleanText(message.content);

  if (!content) {
    throw new Error(
      "message.content is required."
    );
  }

  return {
    requirements:
      extractRequirements(content),

    scope:
      extractScope(content),

    deliverables:
      extractDeliverables(content),

    deadline:
      extractDeadline(content),

    questions:
      extractQuestions(content),

    revisions:
      extractRevisions(content),

    constraints:
      extractConstraints(content),

    decisions:
      extractDecisions(content)
  };
}

function updateConversationMemory(input = {}) {
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

  if (
    message.conversationId &&
    message.conversationId !==
      conversationId
  ) {
    throw new Error(
      "Message conversationId mismatch."
    );
  }

  const extracted =
    extractContextFromMessage(
      message
    );

  const existing =
    store.getContext(
      conversationId
    );

  const context =
    mergeContext(
      existing,
      extracted,
      {
        conversationId,
        clientId:
          conversation.clientId,
        opportunityId:
          conversation.opportunityId,
        proposalId:
          conversation.proposalId
      }
    );

  const saved =
    store.saveContext(
      context
    );

  return {
    ok: true,
    context: saved,
    extracted,
    history:
      getConversationHistory(
        conversationId
      )
  };
}

function getConversationMemory(
  conversationId
) {
  const id =
    cleanText(conversationId);

  if (!id) {
    throw new Error(
      "conversationId is required."
    );
  }

  const conversation =
    store.getConversation(id);

  if (!conversation) {
    throw new Error(
      "Conversation not found."
    );
  }

  return {
    conversation,
    context:
      store.getContext(id),
    history:
      getConversationHistory(id)
  };
}

module.exports = {
  extractContextFromMessage,
  getConversationHistory,
  updateConversationMemory,
  getConversationMemory
};
