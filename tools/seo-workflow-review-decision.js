"use strict";

const MAX_REASON_LENGTH = 1000;
const CONFIRMATION = "I_CONFIRM_SEO_REVIEW_DECISION";

function trustedAdmin(context) {
  return Boolean(
    context &&
    context.permissionGranted === true &&
    context.actor &&
    context.actor.role === "admin" &&
    typeof context.actor.username === "string" &&
    context.actor.username.trim()
  );
}

function createReviewDecisionExecutor(dependencies = {}) {
  return async function execute(args = {}, trustedContext = {}) {
    if (!trustedAdmin(trustedContext)) {
      return JSON.stringify({
        success: false,
        status: "BLOCKED",
        reason: "TRUSTED_NAMED_ADMIN_PERMISSION_REQUIRED"
      });
    }

    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "SEO_REVIEW_ARGUMENTS_INVALID"
      });
    }

    const allowed = [
      "clientId",
      "workflowId",
      "decision",
      "reason",
      "expectedVersion",
      "confirmation"
    ];

    if (Object.keys(args).some(key => !allowed.includes(key))) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "SEO_REVIEW_FIELD_NOT_ALLOWED"
      });
    }

    const clientId = typeof args.clientId === "string"
      ? args.clientId.trim()
      : "";
    const workflowId = typeof args.workflowId === "string"
      ? args.workflowId.trim()
      : "";
    const decision = args.decision;
    const reason = typeof args.reason === "string"
      ? args.reason.trim()
      : "";

    if (!clientId || clientId.length > 160 ||
        !workflowId || workflowId.length > 160 ||
        !["APPROVE", "REJECT", "REQUEST_REVISION"].includes(decision) ||
        reason.length < 10 || reason.length > MAX_REASON_LENGTH ||
        !Number.isInteger(args.expectedVersion) ||
        args.expectedVersion < 0 ||
        args.confirmation !== CONFIRMATION) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "SEO_REVIEW_FIELDS_OR_CONFIRMATION_INVALID"
      });
    }

    try {
      const update = dependencies.updateWorkflowReview ||
        require("../services/mira-seo-workflow-store").updateWorkflowReview;

      const result = update({
        clientId,
        workflowId,
        decision,
        reason,
        expectedVersion: args.expectedVersion,
        reviewer: trustedContext.actor.username.trim()
      });

      return JSON.stringify({
        success: true,
        status: "SEO_REVIEW_DECISION_RECORDED",
        ...result,
        approvalDoesNotPublish: true
      });
    } catch (error) {
      const known = [
        "SEO_REVIEW_WORKFLOW_NOT_FOUND",
        "SEO_REVIEW_QUALITY_REVIEW_NOT_FOUND",
        "SEO_REVIEW_VERSION_CONFLICT",
        "SEO_REVIEW_DECISION_ALREADY_FINAL",
        "SEO_WORKFLOW_STORE_LOCKED_REVIEW_REQUIRED",
        "SEO_WORKFLOW_RECORD_SIZE_LIMIT"
      ];

      return JSON.stringify({
        success: false,
        status: known.includes(error.message)
          ? "CONFLICT"
          : "INCONCLUSIVE",
        reason: known.includes(error.message)
          ? error.message
          : "SEO_REVIEW_STORE_UPDATE_FAILED"
      });
    }
  };
}

module.exports = {
  name: "seo_workflow_review_decision",
  declaration: {
    name: "seo_workflow_review_decision",
    description:
      "Record a named Admin's explicit human review decision for one exact " +
      "client SEO workflow. Decisions are APPROVE, REJECT, or REQUEST_REVISION. " +
      "Requires the expected review version and explicit confirmation. " +
      "Does not publish content or modify websites.",
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        workflowId: { type: "string" },
        decision: {
          type: "string",
          enum: ["APPROVE", "REJECT", "REQUEST_REVISION"]
        },
        reason: { type: "string" },
        expectedVersion: { type: "integer", minimum: 0 },
        confirmation: {
          type: "string",
          enum: ["I_CONFIRM_SEO_REVIEW_DECISION"]
        }
      },
      required: [
        "clientId",
        "workflowId",
        "decision",
        "reason",
        "expectedVersion",
        "confirmation"
      ],
      additionalProperties: false
    }
  },
  execute: createReviewDecisionExecutor(),
  createReviewDecisionExecutor
};
