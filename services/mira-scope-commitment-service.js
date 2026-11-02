'use strict';

const {
  evaluateScopeAndCommitment
} = require('./mira-scope-commitment-guard');

const {
  enforceApprovalBoundary
} = require('./mira-scope-commitment-enforcement');

const {
  validateApproval
} = require('./mira-approval-validation-guard');

const {
  validateApprovalProvenance
} = require('./mira-approval-provenance-guard');

const {
  validateApprovalAuthority
} = require('./mira-approval-authority-guard');

const {
  validateApprovalReplay
} = require('./mira-approval-replay-guard');

function evaluateClientRequest(input = {}) {
  const analysis = evaluateScopeAndCommitment({
    requestId: input.requestId || null,
    request: input.request || input.clientRequest || '',
    existingScope: input.existingScope || [],
    requestedScope: input.requestedScope || [],
    commitmentTypes: input.commitmentTypes || []
  });

  const protectedAction =
    analysis.scopeChanged === true ||
    analysis.commitmentTypes.some(
      (type) => type !== 'none'
    );

  let approvalValidation = {
    valid: false,
    reason: 'Approval not required'
  };

  let provenanceValidation = {
    valid: false,
    reason: 'Approval not required'
  };

  let authorityValidation = {
    valid: false,
    reason: 'Approval not required'
  };

  let replayValidation = {
    valid: false,
    reason: 'Approval not required'
  };

  if (protectedAction) {
    approvalValidation = validateApproval({
      requestId: analysis.requestId,
      requestedScope: analysis.requestedScope,
      commitmentTypes: analysis.commitmentTypes,
      approval: input.approval
    });

    if (approvalValidation.valid) {
      provenanceValidation =
        validateApprovalProvenance({
          approval: input.approval,
          nowMs: Number.isFinite(input.nowMs)
            ? input.nowMs
            : (
                typeof input.now === 'string' &&
                Number.isFinite(Date.parse(input.now))
                  ? Date.parse(input.now)
                  : undefined
              ),
          maxAgeMs: input.maxAgeMs
        });
    }

    if (
      approvalValidation.valid &&
      provenanceValidation.valid
    ) {
      authorityValidation =
        validateApprovalAuthority({
          approval: input.approval,
          commitmentTypes: analysis.commitmentTypes,
          approverRoles:
            input.approverRoles ||
            input.approval.approverRoles,
          authorityRules: input.authorityRules
        });
    }

    if (
      approvalValidation.valid &&
      provenanceValidation.valid &&
      authorityValidation.valid
    ) {
      replayValidation =
        validateApprovalReplay({
          approval: input.approval,
          usedApprovalIds: input.usedApprovalIds,
          revokedApprovalIds: input.revokedApprovalIds
        });
    }
  }

  const approvalGranted =
    protectedAction &&
    approvalValidation.valid === true &&
    provenanceValidation.valid === true &&
    authorityValidation.valid === true &&
    replayValidation.valid === true;

  const enforcement = enforceApprovalBoundary({
    scopeChanged: analysis.scopeChanged === true,
    commitmentTypes: analysis.commitmentTypes,
    approvalGranted
  });

  const reasons = [
    ...enforcement.reasons
  ];

  if (
    protectedAction &&
    approvalValidation.valid === false
  ) {
    reasons.push(
      `Approval validation failed: ${approvalValidation.reason}`
    );
  }

  if (
    protectedAction &&
    approvalValidation.valid === true &&
    provenanceValidation.valid === false
  ) {
    reasons.push(
      `Approval provenance failed: ${provenanceValidation.reason}`
    );
  }

  if (
    protectedAction &&
    approvalValidation.valid === true &&
    provenanceValidation.valid === true &&
    authorityValidation.valid === false
  ) {
    reasons.push(
      `Approval authority failed: ${authorityValidation.reason}`
    );
  }

  if (
    protectedAction &&
    approvalValidation.valid === true &&
    provenanceValidation.valid === true &&
    authorityValidation.valid === true &&
    replayValidation.valid === false
  ) {
    reasons.push(
      `Approval replay guard failed: ${replayValidation.reason}`
    );
  }

  return Object.freeze({
    requestId: analysis.requestId,
    request:
      input.request ||
      input.clientRequest ||
      '',

    existingScope: analysis.existingScope,
    requestedScope: analysis.requestedScope,

    scopeType: analysis.scopeType,
    scopeChanged: analysis.scopeChanged,
    commitmentTypes: [...analysis.commitmentTypes],

    protectedAction,

    analysisDecision: analysis.decision,

    approvalGranted,

    approvalValidation: {
      valid: approvalValidation.valid,
      reason: approvalValidation.reason
    },

    provenanceValidation: {
      valid: provenanceValidation.valid,
      reason: provenanceValidation.reason
    },

    authorityValidation: {
      valid: authorityValidation.valid,
      reason: authorityValidation.reason
    },

    replayValidation: {
      valid: replayValidation.valid,
      reason: replayValidation.reason
    },

    allowed: enforcement.allowed,
    blocked: enforcement.blocked,
    approvalRequired: enforcement.approvalRequired,
    approvalStatus: enforcement.approvalStatus,
    decision: enforcement.decision,

    reasons,

    createdAt: analysis.createdAt
  });
}

module.exports = Object.freeze({
  evaluateClientRequest
});
