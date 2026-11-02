"use strict";

const assert = require("assert");

const {
  analyzeIntent,
  buildContext,
  determineResponseRequirements,
  createSafeDraft,
  evaluatePolicy,
  createControlledSendBoundary,
  processClientMessage
} = require("../services/mira-client-communication-engine");

function main() {
  console.log(
    "\n=== STAGE 8.1 CLIENT COMMUNICATION ENGINE TEST ==="
  );

  const content =
    "Please explain the status of my research task.";

  const intent =
    analyzeIntent(content);

  assert(
    intent &&
      typeof intent.intent === "string",
    "Intent analysis must return an intent"
  );

  assert(
    [
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
    ].includes(intent.intent),
    "Intent must use an allowed Stage 8.1 intent"
  );

  const context =
    buildContext({
      clientId:
        "stage81-engine-client",
      conversationId:
        "stage81-engine-conversation",
      context: {
        source:
          "stage81-engine-test"
      },
      taskIds: [
        "stage81-task-001"
      ],
      opportunityIds: [
        "stage81-opportunity-001"
      ]
    });

  assert.strictEqual(
    context.contextReady,
    true,
    "Context must be marked ready"
  );

  assert(
    Array.isArray(context.knownFacts),
    "Context knownFacts must be an array"
  );

  assert(
    Array.isArray(context.relevantTasks),
    "Context relevantTasks must be an array"
  );

  assert(
    Array.isArray(context.relevantOpportunities),
    "Context relevantOpportunities must be an array"
  );

  assert(
    Array.isArray(context.unresolvedPoints),
    "Context unresolvedPoints must be an array"
  );

  const requirements =
    determineResponseRequirements(
      content,
      intent.intent
    );

  assert(
    requirements &&
      typeof requirements.level === "string",
    "Response requirements must return a level"
  );

  assert(
    [
      "none",
      "low",
      "medium",
      "high",
      "unknown"
    ].includes(
      requirements.level
    ),
    "Response requirement level must be valid"
  );

  const draft =
    createSafeDraft(
      content,
      intent.intent,
      requirements
    );

  assert(
    draft &&
      typeof draft.content === "string" &&
      draft.content.trim(),
    "Draft content must be generated"
  );

  assert(
    typeof draft.addressesRequirements ===
      "boolean",
    "Draft must expose addressesRequirements"
  );

  const normalPolicy =
    evaluatePolicy(
      content,
      intent.intent
    );

  assert.strictEqual(
    normalPolicy.policyChecked,
    true,
    "Normal policy must be checked"
  );

  assert(
    [
      "allowed",
      "restricted",
      "approval_required",
      "blocked",
      "unknown"
    ].includes(
      normalPolicy.decision
    ),
    "Normal policy decision must be valid"
  );

  const boundary =
    createControlledSendBoundary(
      normalPolicy
    );

  assert.strictEqual(
    boundary.sendAllowed,
    false,
    "Send must remain disabled"
  );

  assert.strictEqual(
    boundary.externalSendImplemented,
    false,
    "External sending must remain unimplemented"
  );

  assert(
    [
      "ready_for_review",
      "not_implemented",
      "approval_required",
      "blocked"
    ].includes(
      boundary.status
    ),
    "Send boundary status must remain controlled"
  );

  const financialPolicy =
    evaluatePolicy(
      "What is the payment amount for this work?",
      "information_request"
    );

  assert.strictEqual(
    financialPolicy.financialCommitment,
    true,
    "Financial commitment must be detected"
  );

  assert.strictEqual(
    financialPolicy.decision,
    "approval_required",
    "Financial commitment must require approval"
  );

  const financialBoundary =
    createControlledSendBoundary(
      financialPolicy
    );

  assert.strictEqual(
    financialBoundary.sendAllowed,
    false,
    "Financial communication must not be externally sent"
  );

  const legalPolicy =
    evaluatePolicy(
      "Please confirm the legal liability agreement.",
      "information_request"
    );

  assert.strictEqual(
    legalPolicy.legalCommitment,
    true,
    "Legal commitment must be detected"
  );

  assert.strictEqual(
    legalPolicy.decision,
    "approval_required",
    "Legal commitment must require approval"
  );

  const processed =
    processClientMessage(
      {
        clientId:
          "stage81-engine-client",
        content:
          "Please explain the status of my research task.",
        context: {
          source:
            "stage81-engine-test"
        },
        taskIds: [
          "stage81-task-001"
        ],
        opportunityIds: []
      },
      {
        persist: false
      }
    );

  assert.strictEqual(
    processed.ok,
    true,
    "Non-persisted processing must succeed"
  );

  assert.strictEqual(
    processed.status,
    "processed",
    "Non-persisted processing status must be processed"
  );

  assert(
    processed.communication,
    "Processed communication record must be returned"
  );

  assert(
    processed.communication.communicationId,
    "Processed communication must have an ID"
  );

  assert(
    processed.communication.intent,
    "Processed communication must include intent"
  );

  assert(
    processed.communication.context,
    "Processed communication must include context"
  );

  assert(
    processed.communication.responseRequirements,
    "Processed communication must include response requirements"
  );

  assert(
    processed.communication.draft,
    "Processed communication must include draft"
  );

  assert(
    processed.communication.policy,
    "Processed communication must include policy"
  );

  assert(
    processed.communication.sendBoundary,
    "Processed communication must include send boundary"
  );

  assert.strictEqual(
    processed.communication.sendBoundary.sendAllowed,
    false,
    "Processed communication must not allow external sending"
  );

  console.log(
    "PASS: intent analysis"
  );

  console.log(
    "PASS: context analysis"
  );

  console.log(
    "PASS: response requirements"
  );

  console.log(
    "PASS: safe draft generation"
  );

  console.log(
    "PASS: normal policy evaluation"
  );

  console.log(
    "PASS: financial policy boundary"
  );

  console.log(
    "PASS: legal policy boundary"
  );

  console.log(
    "PASS: controlled send boundary"
  );

  console.log(
    "PASS: non-persisted processing"
  );

  console.log(
    "STAGE 8.1 CLIENT COMMUNICATION ENGINE TEST: PASS"
  );
}

try {
  main();
} catch (error) {
  console.error(
    error.stack ||
      error.message
  );
  process.exit(1);
}
