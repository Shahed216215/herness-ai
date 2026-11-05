'use strict';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SECRET_ASSIGNMENT = /(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|authorization|private[_ -]?key|credential)\s*[:=]\s*[^\s,;]+/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i;
const COMMON_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/i;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail('HFM_LEARNING_LEGACY_INVALID', label + ' is invalid.');
  }
  return value.trim();
}
function safeEvidenceText(value) {
  const content = text(value, 'legacy evidence content', 12000);
  if (SECRET_ASSIGNMENT.test(content) || BEARER_VALUE.test(content) || COMMON_TOKEN.test(content)) {
    fail('HFM_LEARNING_LEGACY_SECRET_SUSPECTED', 'Legacy learning evidence may contain a secret; it was not imported.');
  }
  return content;
}

/**
 * Convert one integrity-verified legacy Learning Engine record into a
 * human-reviewable HFM proposal input. The project assignment is explicit.
 * This function does not read or modify legacy storage and never marks the
 * resulting evidence as trusted.
 */
function fromLegacyLearningRecord(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('HFM_LEARNING_LEGACY_INVALID', 'Input must be an object.');
  }
  const projectId = text(input.projectId, 'projectId', 128);
  const proposalId = text(input.proposalId, 'proposalId', 128);
  const record = input.record;
  const integrity = input.integrity;
  if (!ID_RE.test(projectId) || !ID_RE.test(proposalId) ||
      !record || typeof record !== 'object' || Array.isArray(record) ||
      typeof record.learningId !== 'string' || !ID_RE.test(record.learningId) ||
      !integrity || integrity.found !== true || integrity.valid !== true ||
      integrity.learningId !== record.learningId ||
      Number(integrity.schemaVersion) !== Number(record.schemaVersion)) {
    fail('HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED', 'A matching, integrity-verified legacy Learning Engine record is required.');
  }

  const raw = [];
  for (const lesson of Array.isArray(record.lessons) ? record.lessons.slice(0, 50) : []) {
    if (typeof lesson === 'string' && lesson.trim()) raw.push({ kind: 'lesson', content: lesson });
  }
  for (const item of Array.isArray(record.knowledgeCandidates) ? record.knowledgeCandidates.slice(0, 50) : []) {
    if (item && typeof item === 'object' && typeof item.lesson === 'string' && item.lesson.trim()) {
      raw.push({ kind: 'knowledge_candidate', content: item.lesson });
    }
  }
  for (const item of Array.isArray(record.skillUpdateCandidates) ? record.skillUpdateCandidates.slice(0, 50) : []) {
    if (item && typeof item === 'object' && typeof item.improvement === 'string' && item.improvement.trim()) {
      raw.push({ kind: 'skill_candidate', content: item.improvement });
    }
  }
  if (raw.length < 1 || raw.length > 100) {
    fail('HFM_LEARNING_LEGACY_INVALID', 'Legacy record must contain 1–100 bounded lesson or improvement candidates.');
  }

  const evidence = raw.map((item, index) => ({
    evidenceId: 'legacy-' + record.learningId + '-' + String(index + 1).padStart(3, '0'),
    projectId,
    sourceType: 'LEGACY_WORK_LEARNING_' + item.kind.toUpperCase(),
    trustState: 'UNVERIFIED',
    sourceRef: 'mira://legacy-learning/' + encodeURIComponent(record.learningId) + '/' + item.kind + '/' + (index + 1),
    content: safeEvidenceText(item.content)
  }));

  return {
    projectId,
    proposalId,
    title: text(input.title, 'title', 240),
    rationale: text(input.rationale, 'rationale', 4000),
    proposedChange: text(input.proposedChange, 'proposedChange', 8000),
    evidence,
    evidenceOrigin: 'LEGACY_LEARNING_ENGINE_INTEGRITY_VERIFIED_UNTRUSTED'
  };
}

function proposalEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('HFM_LEARNING_LEGACY_INVALID', 'Input must be an object.');
  }
  const projectId = text(input.projectId, 'projectId', 128);
  const proposalId = text(input.proposalId, 'proposalId', 128);
  if (!ID_RE.test(projectId) || !ID_RE.test(proposalId)) {
    fail('HFM_LEARNING_LEGACY_INVALID', 'Project or proposal ID format is invalid.');
  }
  return {
    projectId, proposalId,
    title: text(input.title, 'title', 240),
    rationale: text(input.rationale, 'rationale', 4000),
    proposedChange: text(input.proposedChange, 'proposedChange', 8000)
  };
}

function fromLegacyExperiences(input = {}) {
  const envelope = proposalEnvelope(input);
  if (!Array.isArray(input.experiences) || input.experiences.length < 1 || input.experiences.length > 10) {
    fail('HFM_LEARNING_LEGACY_INVALID', 'One to ten integrity-verified legacy experiences are required.');
  }
  const evidence = [];
  for (const entry of input.experiences) {
    const experience = entry && entry.experience;
    if (!entry || entry.integrityVerified !== true || !experience ||
        typeof experience !== 'object' || Array.isArray(experience) ||
        typeof experience.experienceId !== 'string' || !ID_RE.test(experience.experienceId) ||
        typeof experience.integrity !== 'string' || !/^[a-f0-9]{64}$/.test(experience.integrity) ||
        !experience.source || experience.source.learningId !== experience.experienceId ||
        experience.source.type !== 'work-learning-record') {
      fail('HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED', 'Each Experience Memory item must have verified integrity and a matching Learning Engine source.');
    }
    const items = [];
    for (const lesson of Array.isArray(experience.lesson) ? experience.lesson.slice(0, 30) : []) {
      if (typeof lesson === 'string' && lesson.trim()) items.push({ kind: 'lesson', content: lesson });
    }
    for (const change of Array.isArray(experience.feedback && experience.feedback.requestedChanges)
      ? experience.feedback.requestedChanges.slice(0, 20) : []) {
      if (typeof change === 'string' && change.trim()) items.push({ kind: 'feedback', content: change });
    }
    for (const reason of Array.isArray(experience.error && experience.error.reasons)
      ? experience.error.reasons.slice(0, 20) : []) {
      if (typeof reason === 'string' && reason.trim()) items.push({ kind: 'recovery_signal', content: reason });
    }
    for (const check of Array.isArray(experience.performance && experience.performance.failedChecks)
      ? experience.performance.failedChecks.slice(0, 20) : []) {
      if (typeof check === 'string' && check.trim()) items.push({ kind: 'qa_signal', content: check });
    }
    for (const item of items) {
      evidence.push({
        evidenceId: 'legacy-exp-' + experience.experienceId + '-' + String(evidence.length + 1).padStart(3, '0'),
        projectId: envelope.projectId,
        sourceType: 'LEGACY_EXPERIENCE_' + item.kind.toUpperCase(),
        trustState: 'UNVERIFIED',
        sourceRef: 'mira://legacy-experience/' + encodeURIComponent(experience.experienceId) + '/' + item.kind + '/' + (evidence.length + 1),
        content: safeEvidenceText(item.content)
      });
      if (evidence.length > 100) fail('HFM_LEARNING_LEGACY_INVALID', 'Legacy Experience evidence exceeds the proposal limit.');
    }
  }
  if (!evidence.length) fail('HFM_LEARNING_LEGACY_INVALID', 'Verified Experiences contain no reusable lesson, feedback, QA or recovery evidence.');
  return {
    ...envelope, evidence,
    evidenceOrigin: 'LEGACY_EXPERIENCE_RETRIEVAL_INTEGRITY_VERIFIED_UNTRUSTED'
  };
}

function fromLegacyConsolidatedKnowledge(input = {}) {
  const envelope = proposalEnvelope(input);
  const item = input.item;
  if (!input.storeIntegrity || input.storeIntegrity.valid !== true ||
      !item || typeof item !== 'object' || Array.isArray(item) ||
      typeof item.id !== 'string' || !ID_RE.test(item.id) ||
      typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint) ||
      typeof item.lesson !== 'string' || !item.lesson.trim() ||
      !Array.isArray(item.sourceRecords) || item.sourceRecords.length < 1 || item.sourceRecords.length > 100) {
    fail('HFM_LEARNING_LEGACY_INTEGRITY_REQUIRED', 'A store-integrity-verified consolidated knowledge item with source provenance is required.');
  }
  const content = safeEvidenceText(item.lesson);
  const evidence = [{
    evidenceId: 'legacy-knowledge-' + item.id,
    projectId: envelope.projectId,
    sourceType: 'LEGACY_KNOWLEDGE_CONSOLIDATION',
    trustState: 'UNVERIFIED',
    sourceRef: 'mira://legacy-consolidated-knowledge/' + encodeURIComponent(item.id) + '/' + item.fingerprint,
    content: content + '\nSource records: ' + item.sourceRecords.length
  }];
  return {
    ...envelope, evidence,
    evidenceOrigin: 'LEGACY_KNOWLEDGE_CONSOLIDATION_STORE_INTEGRITY_VERIFIED_UNTRUSTED'
  };
}

module.exports = { fromLegacyLearningRecord, fromLegacyExperiences, fromLegacyConsolidatedKnowledge };
