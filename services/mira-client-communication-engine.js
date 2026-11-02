const { recordAudit } = require("../audit-log");

"use strict";

const {
  createClientCommunicationRecord,
  createIntentAnalysis,
  createContextAnalysis,
  createResponseRequirements,
  createDraft,
  createPolicyDecision,
  createSendBoundary
} = require("../client-communication-schema");

const {
  createStoredCommunication
} = require("../client-communication-store");

function cleanInput(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .trim()
    .slice(0, 10000);
}

function analyzeIntent(content) {
  const text =
    cleanInput(content).toLowerCase();

  if (!text) {
    return createIntentAnalysis({
      intent: "unknown",
      confidence: 0,
      signals: []
    });
  }

  if (
    text.includes("?") ||
    text.includes("what") ||
    text.includes("how") ||
    text.includes("when") ||
    text.includes("where") ||
    text.includes("why")
  ) {
    return createIntentAnalysis({
      intent: "question",
      confidence: 0.75,
      signals: ["question_language"]
    });
  }

  if (
    text.includes("revision") ||
    text.includes("change this") ||
    text.includes("modify") ||
    text.includes("edit")
  ) {
    return createIntentAnalysis({
      intent: "revision_request",
      confidence: 0.8,
      signals: ["revision_language"]
    });
  }

  if (
    text.includes("status") ||
    text.includes("progress") ||
    text.includes("update")
  ) {
    return createIntentAnalysis({
      intent: "status_request",
      confidence: 0.8,
      signals: ["status_language"]
    });
  }

  if (
    text.includes("new task") ||
    text.includes("new project") ||
    text.includes("can you do")
  ) {
    return createIntentAnalysis({
      intent: "new_task",
      confidence: 0.75,
      signals: ["task_language"]
    });
  }

  if (
    text.includes("deliver") ||
    text.includes("delivery") ||
    text.includes("send the file")
  ) {
    return createIntentAnalysis({
      intent: "delivery_request",
      confidence: 0.8,
      signals: ["delivery_language"]
    });
  }

  return createIntentAnalysis({
    intent: "general_conversation",
    confidence: 0.55,
    signals: ["general_message"]
  });
}

function buildContext(input) {
  return createContextAnalysis({
    clientId:
      cleanInput(input.clientId) ||
      null,
    conversationId:
      cleanInput(input.conversationId) ||
      null,
    knownFacts:
      Array.isArray(input.knownFacts)
        ? input.knownFacts.slice(0, 20)
        : [],
    activeProjects:
      Array.isArray(input.activeProjects)
        ? input.activeProjects.slice(0, 20)
        : [],
    recentMessages:
      Array.isArray(input.recentMessages)
        ? input.recentMessages.slice(-20)
        : [],
    contextReady: true
  });
}

function determineResponseRequirements(
  content,
  intent
) {
  const text =
    cleanInput(content).toLowerCase();

  let level = "low";
  let reasons = [];

  if (
    intent === "unknown"
  ) {
    level = "unknown";
    reasons.push(
      "intent_uncertain"
    );
  }

  if (
    intent === "new_task" ||
    intent === "revision_request" ||
    intent === "delivery_request"
  ) {
    level = "medium";
    reasons.push(
      "work_related_request"
    );
  }

  if (
    text.includes("contract") ||
    text.includes("agreement") ||
    text.includes("price") ||
    text.includes("payment") ||
    text.includes("refund") ||
    text.includes("legal")
  ) {
    level = "high";
    reasons.push(
      "commitment_sensitive_topic"
    );
  }

  return createResponseRequirements({
    level,
    requiredElements: [
      "direct_response",
      "avoid_unverified_commitments"
    ],
    missingInformation: [],
    reasons
  });
}

function createSafeDraft(
  content,
  intent,
  requirements
) {
  const original =
    cleanInput(content);

  if (!original) {
    return createDraft({
      content: "",
      addressesRequirements: false,
      rationale:
        "No client message content was provided."
    });
  }

  let draft =
    "Thanks for your message. ";

  if (
    intent === "question"
  ) {
    draft +=
      "I’ll review the question and provide the relevant information.";
  } else if (
    intent === "new_task"
  ) {
    draft +=
      "I can review the task requirements and prepare the next steps.";
  } else if (
    intent === "revision_request"
  ) {
    draft +=
      "I’ll review the requested changes and identify what needs to be updated.";
  } else if (
    intent === "status_request"
  ) {
    draft +=
      "I’ll review the current work status and provide an update.";
  } else if (
    intent === "delivery_request"
  ) {
    draft +=
      "I’ll review the delivery requirements before anything is sent.";
  } else {
    draft +=
      "I’ll review your message and determine the appropriate next step.";
  }

  if (
    requirements.level === "high"
  ) {
    draft +=
      " Any contractual, financial, legal, or irreversible commitment will require the appropriate approval.";
  }

  return createDraft({
    content: draft,
    addressesRequirements: true,
    rationale:
      "Deterministic safe draft generated from client message intent."
  });
}

function evaluatePolicy(
  content,
  intent
) {
  const text =
    cleanInput(content).toLowerCase();

  const contractualCommitment =
    text.includes("contract") ||
    text.includes("agreement") ||
    text.includes("sign");

  const financialCommitment =
    text.includes("price") ||
    text.includes("payment") ||
    text.includes("refund") ||
    text.includes("money");

  const legalCommitment =
    text.includes("legal") ||
    text.includes("law") ||
    text.includes("liability");

  const irreversibleAction =
    text.includes("delete") ||
    text.includes("close account") ||
    text.includes("cancel permanently");

  const sensitive =
    contractualCommitment ||
    financialCommitment ||
    legalCommitment ||
    irreversibleAction;

  return createPolicyDecision({
    decision:
      sensitive
        ? "approval_required"
        : "allowed",
    reasons:
      sensitive
        ? [
            "commitment_or_irreversible_action_detected"
          ]
        : [
            "no_restricted_commitment_detected"
          ],
    contractualCommitment,
    financialCommitment,
    legalCommitment,
    irreversibleAction,
    policyChecked: true,
    intent
  });
}

function createControlledSendBoundary(
  policy
) {
  if (
    policy.decision ===
    "blocked"
  ) {
    return createSendBoundary({
      status: "blocked",
      reason:
        "Policy blocked communication."
    });
  }

  if (
    policy.decision ===
    "approval_required"
  ) {
    return createSendBoundary({
      status:
        "approval_required",
      reason:
        "Policy approval is required before any external action."
    });
  }

  return createSendBoundary({
    status:
      "ready_for_review",
    reason:
      "Draft is prepared, but external sending is not implemented in Stage 8.1."
  });
}

function processClientMessage(
  input = {},
  options = {}
) {
  const content =
    cleanInput(
      input.content ||
      (
        input.message &&
        input.message.content
      )
    );

  const recordInput = {
    ...input,
    message: {
      ...(input.message || {}),
      content
    }
  };

  const baseRecord =
    createClientCommunicationRecord(
      recordInput
    );

  const intent =
    analyzeIntent(content);

  const context =
    buildContext({
      ...input,
      conversationId:
        baseRecord.conversationId
    });

  const responseRequirements =
    determineResponseRequirements(
      content,
      intent.intent
    );

  const draft =
    createSafeDraft(
      content,
      intent.intent,
      responseRequirements
    );

  const policy =
    evaluatePolicy(
      content,
      intent.intent
    );

  const sendBoundary =
    createControlledSendBoundary(
      policy
    );

  const communication = {
    ...baseRecord,
    intent,
    context,
    responseRequirements,
    draft,
    policy,
    sendBoundary,
    status:
      "send_boundary",
    updatedAt:
      new Date().toISOString()
  };

  recordAudit({
    actorRole: "mira",
    action:
      "CLIENT_COMMUNICATION_PROCESSED",
    resource:
      "client_communication",
    resourceId:
      communication.communicationId,
    status:
      "success",
    details: {
      communicationId:
        communication.communicationId,
      conversationId:
        communication.conversationId,
      clientId:
        communication.clientId,
      intent:
        communication.intent.intent,
      responseRequirementLevel:
        communication.responseRequirements.level,
      policyDecision:
        communication.policy.decision,
      policyChecked:
        communication.policy.policyChecked,
      contractualCommitment:
        communication.policy.contractualCommitment,
      financialCommitment:
        communication.policy.financialCommitment,
      legalCommitment:
        communication.policy.legalCommitment,
      irreversibleAction:
        communication.policy.irreversibleAction,
      sendBoundaryStatus:
        communication.sendBoundary.status,
      sendAllowed:
        communication.sendBoundary.sendAllowed,
      externalSendImplemented:
        communication.sendBoundary.externalSendImplemented
    }
  });

  if (
    options.persist === true
  ) {
    return createStoredCommunication(
      communication
    );
  }

  return {
    ok: true,
    status: "processed",
    communication
  };
}

module.exports = {
  analyzeIntent,
  buildContext,
  determineResponseRequirements,
  createSafeDraft,
  evaluatePolicy,
  createControlledSendBoundary,
  processClientMessage
};
