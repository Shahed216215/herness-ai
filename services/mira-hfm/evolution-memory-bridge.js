'use strict';

const { validateCanonicalRecord, verifyContentHash } = require('./core');
const { executeGovernedWrite } = require('./write-coordinator');

/*
 * Evolution integration boundary. This is a governed caller only:
 * it owns no provider, storage path, fallback, or independent writer.
 */
async function executeEvolutionMemoryWrite(input) {
  const fail = (status, reason) => ({ ok: false, status, reason });
  if (!input || !input.proposal || !input.approval || !input.recoveryPoint ||
      !input.record || !input.context || !input.operation ||
      !input.provider || !input.audit || !input.registry) {
    return fail('VALIDATION_FAILED', 'EVOLUTION_WRITE_DEPENDENCIES_REQUIRED');
  }

  const { proposal, approval, recoveryPoint, record, context } = input;
  const candidate = validateCanonicalRecord(record);
  if (!candidate.valid) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'CANONICAL_RECORD_INVALID', errors: candidate.errors };
  }

  if (proposal.status !== 'APPROVED' ||
      typeof proposal.proposalId !== 'string' || !proposal.proposalId.trim() ||
      proposal.projectId !== record.projectId ||
      proposal.memoryId !== record.memoryId ||
      !Number.isSafeInteger(proposal.expectedRevision) || proposal.expectedRevision < 1 ||
      record.version.revision !== proposal.expectedRevision + 1) {
    return fail('NOT_APPROVED', 'EVOLUTION_PROPOSAL_OR_REVISION_INVALID');
  }

  if (approval.status !== 'APPROVED' || approval.approved !== true ||
      typeof approval.approver !== 'string' || !approval.approver.trim() ||
      approval.approver !== context.actor ||
      typeof approval.evidenceReference !== 'string' || !approval.evidenceReference.trim() ||
      typeof approval.policyDecisionId !== 'string' || !approval.policyDecisionId.trim() ||
      approval.policyDecisionId !== proposal.policyDecisionId ||
      approval.policyDecisionId !== context.policyDecisionId) {
    return fail('NOT_APPROVED', 'EVOLUTION_APPROVAL_EVIDENCE_INVALID');
  }

  const preState = recoveryPoint.record;
  const preStateValidation = validateCanonicalRecord(preState);
  if (recoveryPoint.status !== 'VERIFIED' || recoveryPoint.verified !== true ||
      !preStateValidation.valid || !verifyContentHash(preState).valid ||
      preState.projectId !== record.projectId ||
      preState.memoryId !== record.memoryId ||
      preState.version.revision !== proposal.expectedRevision ||
      recoveryPoint.projectId !== record.projectId ||
      recoveryPoint.memoryId !== record.memoryId ||
      recoveryPoint.revision !== proposal.expectedRevision ||
      recoveryPoint.contentHash !== preState.version.contentHash ||
      typeof recoveryPoint.evidenceReference !== 'string' || !recoveryPoint.evidenceReference.trim()) {
    return fail('RECOVERY_REQUIRED', 'VERIFIED_PRESTATE_RECOVERY_POINT_REQUIRED');
  }

  if (context.projectId !== proposal.projectId || context.action !== 'write') {
    return fail('NOT_APPROVED', 'EVOLUTION_CONTEXT_SCOPE_MISMATCH');
  }

  const governedContext = Object.assign({}, context, {
    evolutionProposalId: proposal.proposalId,
    approvalEvidenceReference: approval.evidenceReference,
    recoveryPointEvidenceReference: recoveryPoint.evidenceReference
  });

  const result = await executeGovernedWrite({
    record, context: governedContext, operation: input.operation,
    provider: input.provider, audit: input.audit,
    registry: input.registry, expectedRevision: proposal.expectedRevision
  });

  return Object.assign({}, result, {
    evolutionProposalId: proposal.proposalId,
    approvalEvidenceReference: approval.evidenceReference,
    recoveryPointEvidenceReference: recoveryPoint.evidenceReference,
    canonicalWriter: 'MIRA_HFM_GOVERNED_WRITE_COORDINATOR'
  });
}

module.exports = { executeEvolutionMemoryWrite };
