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
    proposedChange: txt(input.proposedChange, 'proposedChange', 8000), evidence,
    evidenceDigest: digest(evidence), status: 'PENDING_HUMAN_REVIEW', trustState: 'UNTRUSTED',
    approvalRequired: true, automaticPromotion: false, automaticExecution: false,
    canonicalMemoryWrites: 0, selfModificationAllowed: false };
  p.proposalDigest = digest(p);
  return Object.freeze(p);
}
function createLearningEvolutionBridge({ proposalStore, auditWriter } = {}) {
  if (!obj(proposalStore) || proposalStore.projectIsolated !== true || proposalStore.createOnly !== true ||
      proposalStore.immutableVersions !== true || proposalStore.readAfterWrite !== true ||
      typeof proposalStore.putIfAbsent !== 'function' || typeof proposalStore.get !== 'function') {
    fail('Proposal store capability contract is not satisfied.', 'HFM_LEARNING_STORE_CAPABILITY_REQUIRED');
  }
  if (typeof auditWriter !== 'function') fail('Durable auditWriter is required.', 'HFM_LEARNING_AUDIT_REQUIRED');
  return Object.freeze({ async submit(input) {
    const p = buildProposal(input);
    const put = await proposalStore.putIfAbsent(p.projectId, p.proposalId, p);
    if (!put || put.created !== true) fail('Proposal ID conflict; overwrite is forbidden.', 'HFM_LEARNING_PROPOSAL_CONFLICT');
    const readback = await proposalStore.get(p.projectId, p.proposalId);
    if (!readback || readback.proposalDigest !== p.proposalDigest || readback.evidenceDigest !== p.evidenceDigest) {
      const e = new Error('Read-after-write verification failed.'); e.code = 'HFM_LEARNING_READBACK_FAILED'; e.stateCommitted = true; throw e;
    }
    try {
      await auditWriter({ event: 'HFM_LEARNING_PROPOSAL_STAGED', projectId: p.projectId,
        proposalId: p.proposalId, proposalDigest: p.proposalDigest, status: p.status, canonicalMemoryWrites: 0 });
    } catch (cause) {
      const e = new Error('Proposal staged but audit failed; reconcile before retry.');
      e.code = 'HFM_LEARNING_AUDIT_FAILED'; e.stateCommitted = true; e.cause = cause; throw e;
    }
    return { projectId: p.projectId, proposalId: p.proposalId, proposalDigest: p.proposalDigest,
      status: p.status, trustState: p.trustState, approvalRequired: true,
      automaticExecution: false, canonicalMemoryWrites: 0 };
  } });
}
module.exports = { buildProposal, createLearningEvolutionBridge, SCHEMA, VERSION, MAX_EVIDENCE };
