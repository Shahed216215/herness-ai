"use strict";

const {
  createStoredWorkAcceptance,
  getWorkAcceptance,
  listWorkAcceptances,
  updateWorkAcceptance
} = require("../work-acceptance-store");

const {
  evaluateAcceptanceDecision
} = require(
  "../services/mira-work-acceptance-decision-engine"
);

const {
  validateWorkAcceptance
} = require("../work-acceptance-schema");

const {
  evaluateWorkAcceptancePolicyGate,
  isPolicyGateAllowed
} = require(
  "../services/mira-work-acceptance-policy-gate"
);

const {
  recordAcceptanceEvaluated,
  recordPolicyGated,
  recordApprovalRequired,
  recordAcceptanceBlocked,
  recordAcceptanceCreated,
  recordAcceptanceUpdated
} = require(
  "../services/mira-work-acceptance-audit"
);

function registerWorkAcceptanceRoutes(
  app,
  requireAgentAuth,
  requireAgentPermission,
  PERMISSIONS
) {
  if (
    !app ||
    typeof app.post !== "function" ||
    typeof app.get !== "function" ||
    typeof app.patch !== "function"
  ) {
    throw new Error(
      "Express app with route methods is required."
    );
  }

  if (
    typeof requireAgentAuth !==
    "function"
  ) {
    throw new Error(
      "requireAgentAuth middleware is required."
    );
  }

  if (
    typeof requireAgentPermission !==
    "function"
  ) {
    throw new Error(
      "requireAgentPermission middleware is required."
    );
  }

  if (
    !PERMISSIONS ||
    !PERMISSIONS.CLIENT_PROJECTS
  ) {
    throw new Error(
      "CLIENT_PROJECTS permission is required."
    );
  }

  const auth = [
    requireAgentAuth,
    requireAgentPermission(
      PERMISSIONS.CLIENT_PROJECTS
    )
  ];

  app.post(
    "/api/work-acceptances/evaluate",
    ...auth,
    (req, res) => {
      try {
        const body =
          req.body || {};

        const decision =
          evaluateAcceptanceDecision(
            body
          );

        const policyGate =
          evaluateWorkAcceptancePolicyGate({
            ...body,
            acceptanceDecision:
              decision
          });

        const auditContext = {
          acceptanceId:
            body.acceptanceId,
          opportunityId:
            body.opportunityId ||
            body.opportunity?.opportunityId,
          proposalId:
            body.proposalId ||
            body.proposal?.proposalId,
          clientResponseId:
            body.clientResponseId ||
            body.clientResponse?.clientResponseId,
          requirementsId:
            body.requirementsId ||
            body.requirements?.requirementsId,
          decision:
            decision.decision,
          decisionStatus:
            decision.status,
          policyDecision:
            body.policyDecision ||
            body.opportunity?.policy?.decision,
          policyChecked:
            policyGate.checks.policyChecked,
          policyAllowed:
            policyGate.checks.policyAllowed,
          policyGateDecision:
            policyGate.decision,
          humanApprovalRequired:
            policyGate.checks.humanApprovalRequired,
          humanApprovalGranted:
            policyGate.checks.humanApprovalGranted,
          acceptanceFinal:
            policyGate.checks.acceptanceDecisionFinal,
          allowed:
            policyGate.allowed,
          blocked:
            policyGate.decision === "block",
          approvalRequired:
            policyGate.decision ===
            "approval_required",
          clarificationRequired:
            policyGate.decision ===
            "clarification_required",
          workExecutionAllowed:
            policyGate.governance
              .workExecutionAllowed,
          paymentAllowed:
            policyGate.governance
              .paymentAllowed,
          paymentTransferAuthorized:
            policyGate.governance
              .paymentTransferAuthorized,
          contractSigningAllowed:
            policyGate.governance
              .contractSigningAllowed,
          externalActionPerformed:
            policyGate.governance
              .externalActionPerformed
        };

        recordAcceptanceEvaluated(
          auditContext
        );

        recordPolicyGated(
          auditContext
        );

        if (
          policyGate.decision ===
          "approval_required"
        ) {
          recordApprovalRequired(
            auditContext
          );
        } else if (
          policyGate.decision ===
          "block"
        ) {
          recordAcceptanceBlocked(
            auditContext
          );
        }

        return res.json({
          ok: true,
          decision,
          policyGate
        });
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.post(
    "/api/work-acceptances",
    ...auth,
    (req, res) => {
      try {
        const body =
          req.body || {};

        const decision =
          evaluateAcceptanceDecision(
            body
          );

        const policyGate =
          evaluateWorkAcceptancePolicyGate({
            ...body,
            acceptanceDecision:
              decision
          });

        const auditContext = {
          acceptanceId:
            body.acceptanceId,
          opportunityId:
            body.opportunityId ||
            body.opportunity?.opportunityId,
          proposalId:
            body.proposalId ||
            body.proposal?.proposalId,
          clientResponseId:
            body.clientResponseId ||
            body.clientResponse?.clientResponseId,
          requirementsId:
            body.requirementsId ||
            body.requirements?.requirementsId,
          decision:
            decision.decision,
          decisionStatus:
            decision.status,
          policyDecision:
            body.policyDecision ||
            body.opportunity?.policy?.decision,
          policyChecked:
            policyGate.checks.policyChecked,
          policyAllowed:
            policyGate.checks.policyAllowed,
          policyGateDecision:
            policyGate.decision,
          humanApprovalRequired:
            policyGate.checks.humanApprovalRequired,
          humanApprovalGranted:
            policyGate.checks.humanApprovalGranted,
          acceptanceFinal:
            policyGate.checks.acceptanceDecisionFinal,
          allowed:
            policyGate.allowed,
          blocked:
            policyGate.decision === "block",
          approvalRequired:
            policyGate.decision ===
            "approval_required",
          clarificationRequired:
            policyGate.decision ===
            "clarification_required",
          workExecutionAllowed:
            policyGate.governance
              .workExecutionAllowed,
          paymentAllowed:
            policyGate.governance
              .paymentAllowed,
          paymentTransferAuthorized:
            policyGate.governance
              .paymentTransferAuthorized,
          contractSigningAllowed:
            policyGate.governance
              .contractSigningAllowed,
          externalActionPerformed:
            policyGate.governance
              .externalActionPerformed
        };

        recordAcceptanceEvaluated(
          auditContext
        );

        recordPolicyGated(
          auditContext
        );

        if (
          decision.decision !==
          "accept"
        ) {
          if (
            policyGate.decision ===
            "approval_required"
          ) {
            recordApprovalRequired(
              auditContext
            );
          } else if (
            policyGate.decision ===
            "block" ||
            decision.decision ===
            "reject"
          ) {
            recordAcceptanceBlocked(
              auditContext
            );
          }

          return res.status(400).json({
            ok: false,
            error:
              "Work acceptance cannot be created until the acceptance decision is accept.",
            decision,
            policyGate
          });
        }

        if (
          !isPolicyGateAllowed(
            policyGate
          )
        ) {
          if (
            policyGate.decision ===
            "approval_required"
          ) {
            recordApprovalRequired(
              auditContext
            );
          } else if (
            policyGate.decision ===
            "block"
          ) {
            recordAcceptanceBlocked(
              auditContext
            );
          }

          return res.status(400).json({
            ok: false,
            error:
              "Work acceptance is blocked by the policy gate.",
            decision,
            policyGate
          });
        }

        const acceptance =
          createStoredWorkAcceptance(
            body
          );

        recordAcceptanceCreated({
          ...auditContext,
          acceptanceId:
            acceptance.acceptanceId,
          decision:
            acceptance.acceptanceDecision?.decision,
          decisionStatus:
            acceptance.status,
          acceptanceFinal:
            true,
          allowed:
            true
        });

        return res.status(201).json({
          ok: true,
          acceptance,
          policyGate
        });
      } catch (error) {
        if (
          error.code ===
          "DUPLICATE_WORK_ACCEPTANCE"
        ) {
          return res.status(409).json({
            ok: false,
            error:
              error.message,
            code:
              error.code,
            existingAcceptance:
              error.existingAcceptance
          });
        }

        return res.status(400).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.get(
    "/api/work-acceptances",
    ...auth,
    (req, res) => {
      try {
        const acceptances =
          listWorkAcceptances({
            opportunityId:
              req.query.opportunityId,
            proposalId:
              req.query.proposalId,
            status:
              req.query.status
          });

        return res.json({
          ok: true,
          count:
            acceptances.length,
          acceptances
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.get(
    "/api/work-acceptances/:acceptanceId",
    ...auth,
    (req, res) => {
      try {
        const acceptance =
          getWorkAcceptance(
            req.params.acceptanceId
          );

        if (!acceptance) {
          return res.status(404).json({
            ok: false,
            error:
              "Work acceptance not found."
          });
        }

        return res.json({
          ok: true,
          acceptance
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  app.patch(
    "/api/work-acceptances/:acceptanceId",
    ...auth,
    (req, res) => {
      try {
        const existing =
          getWorkAcceptance(
            req.params.acceptanceId
          );

        if (!existing) {
          return res.status(404).json({
            ok: false,
            error:
              "Work acceptance not found."
          });
        }

        const updated =
          updateWorkAcceptance(
            req.params.acceptanceId,
            req.body || {}
          );

        validateWorkAcceptance(
          updated
        );

        recordAcceptanceUpdated({
          acceptanceId:
            updated.acceptanceId,
          opportunityId:
            updated.opportunityId,
          proposalId:
            updated.proposalId,
          decision:
            updated.acceptanceDecision?.decision,
          decisionStatus:
            updated.status,
          acceptanceFinal:
            updated.status ===
            "accepted",
          allowed:
            updated.status ===
            "accepted"
        });

        return res.json({
          ok: true,
          acceptance:
            updated
        });
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error:
            error.message
        });
      }
    }
  );

  return {
    registered: true,
    routes: [
      "POST /api/work-acceptances/evaluate",
      "POST /api/work-acceptances",
      "GET /api/work-acceptances",
      "GET /api/work-acceptances/:acceptanceId",
      "PATCH /api/work-acceptances/:acceptanceId"
    ],
    workExecutionImplemented: false,
    paymentTransferImplemented: false,
    contractSigningImplemented: false,
    externalActionImplemented: false
  };
}

module.exports =
  registerWorkAcceptanceRoutes;
