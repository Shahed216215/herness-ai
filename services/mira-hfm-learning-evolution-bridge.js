'use strict';
const crypto = require('node:crypto');
const SCHEMA = 'MIRA_HFM_LEARNING_EVOLUTION_PROPOSAL';
const VERSION = '1.0.0';
const MAX_EVIDENCE = 100;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
function fail(message, code = 'HFM_LEARNING_INVALID') { const e = new Error(message); e.code = code; throw e; }
function obj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function id(v, n) { if (typeof v !== 'string' || !ID_RE.test(v)) fail(n + ' is invalid.'); return v; }
function txt(v, n, max = 12000) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail(n + ' is invalid.');
  return v.trim();
}
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (obj(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function digest(v) { return crypto.createHash('sha256').update(canonical(v), 'utf8').digest('hex'); }
function normalizeEvidence(r, projectId) {
  if (!obj(r)) fail('Evidence must be an object.');
  const evidenceId = id(r.evidenceId, 'evidenceId');
  if (id(r.projectId, 'evidence.projectId') !== projectId) fail('Cross-project evidence is forbidden.', 'HFM_LEARNING_PROJECT_MISMATCH');
  const trustState = txt(r.trustState, 'trustState', 64).toUpperCase();
  if (!['UNVERIFIED','PENDING_REVIEW','SOURCE_RECORDED','TRUSTED'].includes(trustState)) fail('Unsupported trustState.');
  const content = txt(r.content, 'evidence.content');
  return { evidenceId, projectId, sourceType: txt(r.sourceType, 'sourceType', 64), trustState,
    sourceRef: txt(r.sourceRef, 'sourceRef', 512), content,
    contentSha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex') };
}
function buildProposal(input = {}) {
  if (!obj(input)) fail('input must be an object.');
  const projectId = id(input.projectId, 'projectId');
  const proposalId = id(input.proposalId, 'proposalId');
  if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > MAX_EVIDENCE) fail('evidence count is invalid.');
  const evidence = input.evidence.map(r => normalizeEvidence(r, projectId));
  const ids = evidence.map(r => r.evidenceId);
  if (new Set(ids).size !== ids.length) fail('Duplicate evidenceId values are forbidden.');
  const createdAt = input.createdAt || new Date().toISOString();
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== createdAt) fail('createdAt must be canonical ISO.');
  const p = { schema: SCHEMA, version: VERSION, proposalId, projectId, createdAt,
    title: txt(input.title, 'title', 240), rationale: txt(input.rationale, 'rationale', 4000),
    evidenceOrigin: input.evidenceOrigin === undefined ? 'EXPLICITLY_SUPPLIED_EVIDENCE' : txt(input.evidenceOrigin, 'evidenceOrigin', 120),
    proposedChange: txt(input.proposedChange, 'proposedChange', 8000), evidence,
    evidenceDigest: digest(evidence), status: 'PENDING_HUMAN_REVIEW', trustState: 'UNTRUSTED',
    approvalRequired: true, automaticPromotion: false, automaticExecution: false,
    canonicalMemoryWrites: 0, selfModificationAllowed: false };
  p.proposalDigest = digest(p);
  return Object.freeze(p);
}
function hasProductionIntegrationCapabilities({ proposalStore, auditWriter, productionIntegrationReady } = {}) {
  return productionIntegrationReady === true &&
    obj(proposalStore) &&
    proposalStore.projectIsolated === true &&
    proposalStore.createOnly === true &&
    proposalStore.immutableVersions === true &&
    proposalStore.readAfterWrite === true &&
    proposalStore.durable === true &&
    proposalStore.crossInstanceAtomicCreate === true &&
    typeof proposalStore.putIfAbsent === 'function' &&
    typeof proposalStore.get === 'function' &&
    typeof proposalStore.putReviewIfAbsent === 'function' &&
    typeof proposalStore.getReview === 'function' &&
    typeof auditWriter === 'function' &&
    auditWriter.durable === true;
}

function createLearningEvolutionBridge({ proposalStore, auditWriter } = {}) {
  if (!obj(proposalStore) || proposalStore.projectIsolated !== true || proposalStore.createOnly !== true ||
      proposalStore.immutableVersions !== true || proposalStore.readAfterWrite !== true ||
      typeof proposalStore.putIfAbsent !== 'function' || typeof proposalStore.get !== 'function' ||
      typeof proposalStore.putReviewIfAbsent !== 'function' || typeof proposalStore.getReview !== 'function') {
    fail('Proposal store capability contract is not satisfied.', 'HFM_LEARNING_STORE_CAPABILITY_REQUIRED');
  }
  if (typeof auditWriter !== 'function') fail('Durable auditWriter is required.', 'HFM_LEARNING_AUDIT_REQUIRED');
  return Object.freeze({ async submit(input, context = {}) {
    const p = buildProposal(input);
    const put = await proposalStore.putIfAbsent(p.projectId, p.proposalId, p);
    if (!put || typeof put.created !== 'boolean') {
      fail('Proposal store returned an invalid create-only result.', 'HFM_LEARNING_STORE_RESULT_INVALID');
    }
    const readback = await proposalStore.get(p.projectId, p.proposalId);
    if (!readback || readback.proposalDigest !== p.proposalDigest || readback.evidenceDigest !== p.evidenceDigest) {
      const e = new Error('Read-after-write verification failed or immutable proposal ID conflicts.');
      e.code = put.created ? 'HFM_LEARNING_READBACK_FAILED' : 'HFM_LEARNING_PROPOSAL_CONFLICT';
      e.stateCommitted = put.created === true;
      throw e;
    }
    if (!put.created && auditWriter.idempotent !== true) {
      fail('Proposal ID already exists; idempotent audit reconciliation is not available.', 'HFM_LEARNING_PROPOSAL_CONFLICT');
    }
    try {
      await auditWriter({ event: 'HFM_LEARNING_PROPOSAL_STAGED', projectId: p.projectId,
        proposalId: p.proposalId, proposalDigest: p.proposalDigest, status: p.status,
        createdAt: p.createdAt, canonicalMemoryWrites: 0,
        actorRole: typeof context.actorRole === 'string' ? context.actorRole.slice(0, 64) : 'unknown',
        actorId: typeof context.actorId === 'string' && context.actorId.trim() ? context.actorId.trim().slice(0, 128) : 'unknown' });
    } catch (cause) {
      const e = new Error('Proposal staged but audit failed; reconcile before retry.');
      e.code = 'HFM_LEARNING_AUDIT_FAILED'; e.stateCommitted = true; e.cause = cause; throw e;
    }
    return { projectId: p.projectId, proposalId: p.proposalId, proposalDigest: p.proposalDigest,
      status: p.status, trustState: p.trustState, approvalRequired: true,
      automaticExecution: false, canonicalMemoryWrites: 0,
      idempotentRetry: put.created === false };
  },
  async review(projectId, proposalId, input = {}, context = {}) {
    const safeProjectId = id(projectId, 'projectId');
    const safeProposalId = id(proposalId, 'proposalId');
    const proposal = await proposalStore.get(safeProjectId, safeProposalId);
    if (!proposal) fail('HFM_LEARNING_PROPOSAL_NOT_FOUND', 'Proposal was not found.');
    const existing = await proposalStore.getReview(safeProjectId, safeProposalId);
    if (existing) fail('HFM_LEARNING_REVIEW_CONFLICT', 'An immutable human review already exists for this proposal.');
    if (!obj(input) || !['APPROVE_FOR_MANUAL_HANDOFF', 'REJECT'].includes(input.decision))
      fail('HFM_LEARNING_REVIEW_INVALID', 'Review decision must be APPROVE_FOR_MANUAL_HANDOFF or REJECT.');
    if (context.actorRole !== 'admin') fail('HFM_LEARNING_REVIEW_ACTOR_REQUIRED', 'A named system administrator is required.');
    const actorId = txt(context.actorId, 'actorId', 128);
    const reason = txt(input.reason, 'reason', 2000);
    const reviewedAt = input.reviewedAt || new Date().toISOString();
    const reviewDate = new Date(reviewedAt);
    if (!Number.isFinite(reviewDate.getTime()) || reviewDate.toISOString() !== reviewedAt)
      fail('HFM_LEARNING_REVIEW_INVALID', 'reviewedAt must be a canonical ISO timestamp.');
    const review = {
      schema: 'MIRA_HFM_LEARNING_PROPOSAL_REVIEW',
      version: '1.0.0',
      projectId: safeProjectId,
      proposalId: safeProposalId,
      proposalDigest: proposal.proposalDigest,
      decision: input.decision,
      status: input.decision === 'REJECT' ? 'REJECTED' : 'APPROVED_FOR_MANUAL_HANDOFF',
      reason,
      actorRole: 'admin',
      actorId,
      reviewedAt,
      trustState: 'UNTRUSTED',
      canonicalMemoryWrites: 0,
      automaticExecution: false
    };
    review.reviewDigest = digest(review);
    const stored = await proposalStore.putReviewIfAbsent(safeProjectId, safeProposalId, review);
    if (!stored || stored.created !== true)
      fail('HFM_LEARNING_REVIEW_CONFLICT', 'A review already exists; review records cannot be overwritten.');
    const readback = await proposalStore.getReview(safeProjectId, safeProposalId);
    if (!readback || readback.reviewDigest !== review.reviewDigest ||
        readback.proposalDigest !== proposal.proposalDigest ||
        readback.reviewDigest !== digest(Object.fromEntries(Object.entries(readback).filter(([key]) => key !== 'reviewDigest')))) {
      const error = new Error('Review read-after-write verification failed.');
      error.code = 'HFM_LEARNING_REVIEW_READBACK_FAILED';
      error.stateCommitted = true;
      throw error;
    }
    try {
      await auditWriter({
        event: 'HFM_LEARNING_PROPOSAL_REVIEWED',
        projectId: safeProjectId,
        proposalId: safeProposalId,
        proposalDigest: proposal.proposalDigest,
        reviewDigest: review.reviewDigest,
        decision: review.decision,
        status: review.status,
        actorRole: 'admin',
        actorId,
        canonicalMemoryWrites: 0,
        automaticExecution: false
      });
    } catch (cause) {
      const error = new Error('Review persisted but audit emission failed; reconcile before retry.');
      error.code = 'HFM_LEARNING_REVIEW_AUDIT_FAILED';
      error.stateCommitted = true;
      error.cause = cause;
      throw error;
    }
    return { projectId: safeProjectId, proposalId: safeProposalId,
      proposalDigest: proposal.proposalDigest, reviewDigest: review.reviewDigest,
      decision: review.decision, status: review.status, trustState: 'UNTRUSTED',
      canonicalMemoryWrites: 0, automaticExecution: false };
  },
  async get(projectId, proposalId) {
    const safeProjectId = id(projectId, 'projectId');
    const safeProposalId = id(proposalId, 'proposalId');
    const stored = await proposalStore.get(safeProjectId, safeProposalId);
    if (!stored) return null;
    if (stored.projectId !== safeProjectId || stored.proposalId !== safeProposalId ||
        stored.evidenceDigest !== digest(stored.evidence) ||
        stored.proposalDigest !== digest(Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'proposalDigest')))) {
      fail('Stored proposal integrity verification failed.', 'HFM_LEARNING_STORED_INTEGRITY_FAILED');
    }
    const review = await proposalStore.getReview(safeProjectId, safeProposalId);
    if (review) {
      if (review.proposalDigest !== stored.proposalDigest ||
          review.reviewDigest !== digest(Object.fromEntries(Object.entries(review).filter(([key]) => key !== 'reviewDigest'))) ||
          review.trustState !== 'UNTRUSTED' || review.canonicalMemoryWrites !== 0 ||
          review.automaticExecution !== false) {
        fail('HFM_LEARNING_STORED_REVIEW_INTEGRITY_FAILED', 'Stored human review failed integrity or governance checks.');
      }
    }
    return Object.freeze({ ...stored, review: review || null });
  } });
}
module.exports = { buildProposal, createLearningEvolutionBridge, hasProductionIntegrationCapabilities, SCHEMA, VERSION, MAX_EVIDENCE };
