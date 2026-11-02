"use strict";

const {
  getCapabilityRequest
} = require("../capability-request");

function assertAdminActor(actor) {
  if (
    typeof actor !== "string" ||
    !/^admin(?::|$)/i.test(actor.trim())
  ) {
    throw new Error(
      "Human approval requires an authorized admin actor."
    );
  }
}

function approveValidatedCapability(
  requestId,
  actor = "admin"
) {
  assertAdminActor(actor);

  const request =
    getCapabilityRequest(requestId);

  if (!request) {
    throw new Error(
      "Capability request could not be loaded."
    );
  }

  if (request.status !== "validated") {
    throw new Error(
      `Capability request must be validated before approval. Current: ${request.status}`
    );
  }

  if (!request.validation) {
    throw new Error(
      "Capability validation record is required before approval."
    );
  }

  if (request.validation.status !== "validated") {
    throw new Error(
      "Capability validation must be successful before approval."
    );
  }

  if (
    request.validation.activationAllowed !== false
  ) {
    throw new Error(
      "Capability activation boundary is invalid."
    );
  }

  if (
    request.governance &&
    request.governance.executionAllowed !== false
  ) {
    throw new Error(
      "Capability execution boundary is invalid."
    );
  }

  if (request.approval) {
    throw new Error(
      "Capability approval has already been recorded."
    );
  }

  const now =
    new Date().toISOString();

  const approval = {
    status: "approved",
    approvedAt: now,
    approvedBy: actor,
    humanApprovalRequired: true,

    executionAllowed: false,
    applyAllowed: false,
    activationAllowed: false
  };

  return {
    ok: true,

    status:
      "approved_for_controlled_apply",

    requestId:
      request.requestId,

    approval,

    executionAllowed: false,
    applyAllowed: false,
    activationAllowed: false
  };
}

function autonomousApprovalAttempt(
  requestId
) {
  return {
    ok: false,

    status:
      "approval_denied",

    requestId,

    reason:
      "Autonomous approval is not permitted.",

    humanApprovalRequired:
      true,

    executionAllowed:
      false,

    applyAllowed:
      false,

    activationAllowed:
      false
  };
}

module.exports = {
  approveValidatedCapability,
  autonomousApprovalAttempt
};
