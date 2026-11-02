"use strict";

const {
  getOpportunity,
  updateOpportunity
} = require("../opportunity-store");

const {
  evaluatePolicy
} = require("./mira-opportunity-risk-policy-engine");

function evaluateOpportunityPolicy(opportunityId) {
  const opportunity =
    getOpportunity(opportunityId);

  if (!opportunity) {
    throw new Error(
      `Opportunity not found: ${opportunityId}`
    );
  }

  if (!opportunity.opportunityId) {
    throw new Error(
      `Opportunity missing opportunityId: ${opportunityId}`
    );
  }

  const result =
    evaluatePolicy(opportunity);

  const evaluatedAt =
    new Date().toISOString();

  return updateOpportunity(
    opportunityId,
    {
      policy: {
        decision: result.decision,
        policyChecked: result.policyChecked,
        findings: result.findings,
        reasons: result.reasons,
        evaluatedAt
      },

      provenance: {
        ...(opportunity.provenance || {}),
        policyCheckedAt: evaluatedAt
      }
    }
  );
}

module.exports = {
  evaluateOpportunityPolicy
};
