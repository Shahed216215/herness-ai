"use strict";

async function executeSeoWorkflowReviewDecision(input = {}) {
  const requestRole = input.requestRole;
  const session = input.session;
  const tool = input.tool;
  const toolArguments = input.toolArguments || {};

  const authorized =
    requestRole === "admin" &&
    session &&
    session.authenticated === true &&
    session.role === "admin" &&
    typeof session.username === "string" &&
    session.username.trim().length > 0;

  if (!authorized) {
    return {
      success: false,
      status: "BLOCKED",
      reason: "NAMED_ADMIN_BROWSER_SESSION_REQUIRED"
    };
  }

  try {
    if (!tool || typeof tool.execute !== "function") {
      throw new Error("SEO_WORKFLOW_REVIEW_TOOL_NOT_REGISTERED");
    }

    const rawResult = await tool.execute(toolArguments, {
      permissionGranted: true,
      actor: {
        role: session.role,
        username: session.username.trim()
      }
    });

    try {
      const normalized =
        typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;

      if (
        !normalized ||
        typeof normalized !== "object" ||
        Array.isArray(normalized)
      ) {
        throw new Error("SEO_WORKFLOW_REVIEW_RESPONSE_INVALID");
      }

      return normalized;
    } catch {
      return {
        success: false,
        status: "INCONCLUSIVE",
        reason: "SEO_WORKFLOW_REVIEW_RESPONSE_INVALID"
      };
    }
  } catch {
    return {
      success: false,
      status: "INCONCLUSIVE",
      reason: "SEO_WORKFLOW_REVIEW_EXECUTION_FAILED"
    };
  }
}

module.exports = { executeSeoWorkflowReviewDecision };
