"use strict";

const planner =
  require("./mira-conversation-response-planner");

const policyEngine =
  require("./mira-conversation-policy-engine");

function buildControlledResponsePlan(input = {}) {
  if (!input.conversationId) {
    throw new Error(
      "conversationId is required."
    );
  }

  if (!input.message) {
    throw new Error(
      "message is required."
    );
  }

  const plan =
    planner.planResponse({
      conversationId:
        input.conversationId,
      message:
        input.message
    });

  const policy =
    policyEngine.evaluateConversationPolicy({
      plan,
      content:
        input.message.content
    });

  return policyEngine.applyPolicyToPlan(
    plan,
    policy
  );
}

module.exports = {
  buildControlledResponsePlan
};
