"use strict";

/**
 * Stage 8.2
 * Proposal Workflow Engine
 *
 * Flow:
 * Opportunity
 *   -> Requirements
 *   -> Capabilities
 *   -> Work Plan
 *   -> Proposal
 *   -> Accuracy Check
 *   -> Policy Check
 *   -> Approval/Send Boundary
 *
 * This workflow does NOT send externally.
 * It does NOT accept work, sign contracts, make payments,
 * access credentials, or perform irreversible client actions.
 */

const {
  generateProposal
} = require("./mira-proposal-generation-engine");

const {
  applyAccuracyCheck
} = require("./mira-proposal-accuracy-engine");

const {
  applyPolicyCheck
} = require("./mira-proposal-policy-engine");

function buildSendBoundary(
  proposal
) {
  if (!proposal) {
    return {
      status: "blocked",
      reason: "Proposal is missing.",
      sendAllowed: false,
      externalSendImplemented: false
    };
  }

  if (
    proposal.status === "blocked" ||
    proposal.sendBoundary === "blocked"
  ) {
    return {
      status: "blocked",
      reason:
        "Proposal failed a required safety or policy check.",
      sendAllowed: false,
      externalSendImplemented: false
    };
  }

  if (
    proposal.policyDecision ===
    "approval_required"
  ) {
    return {
      status: "approval_required",
      reason:
        "Policy approval is required before any external action.",
      sendAllowed: false,
      externalSendImplemented: false
    };
  }

  if (
    proposal.approval &&
    proposal.approval.approved === true
  ) {
    return {
      status: "ready_for_review",
      reason:
        "Proposal is approved internally but external sending remains a separate controlled action.",
      sendAllowed: false,
      externalSendImplemented: false
    };
  }

  return {
    status: "ready_for_review",
    reason:
      "Proposal passed accuracy and policy checks and is ready for review; external sending is not implemented.",
    sendAllowed: false,
    externalSendImplemented: false
  };
}

function generateAndCheckProposal(
  input = {}
) {
  const generated =
    generateProposal(input);

  let proposal =
    generated.proposal;

  const accuracy =
    applyAccuracyCheck(
      proposal
    );

  proposal =
    accuracy.proposal;

  if (!accuracy.accuracyCheck.passed) {
    const sendBoundary =
      buildSendBoundary(
        proposal
      );

    proposal = {
      ...proposal,
      sendBoundary:
        sendBoundary.status
    };

    return {
      proposal,
      opportunity:
        generated.opportunity,
      requirements:
        generated.requirements,
      skills:
        generated.skills,
      capabilityProfile:
        generated.capabilityProfile,
      workPlan:
        generated.workPlan,
      validation:
        generated.validation,
      accuracyCheck:
        accuracy.accuracyCheck,
      policyCheck:
        proposal.policyCheck,
      sendBoundary,
      stoppedAt:
        "accuracy_check",
      externalActionPerformed:
        false
    };
  }

  const policy =
    applyPolicyCheck(
      proposal,
      generated.opportunity
    );

  proposal =
    policy.proposal;

  const sendBoundary =
    buildSendBoundary(
      proposal
    );

  proposal = {
    ...proposal,
    sendBoundary:
      sendBoundary.status
  };

  return {
    proposal,
    opportunity:
      generated.opportunity,
    requirements:
      generated.requirements,
    skills:
      generated.skills,
    capabilityProfile:
      generated.capabilityProfile,
    workPlan:
      generated.workPlan,
    validation:
      generated.validation,
    accuracyCheck:
      accuracy.accuracyCheck,
    policyCheck:
      policy.policyCheck,
    sendBoundary,
    stoppedAt:
      null,
    externalActionPerformed:
      false
  };
}

module.exports = {
  buildSendBoundary,
  generateAndCheckProposal
};
