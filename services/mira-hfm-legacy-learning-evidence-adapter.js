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

module.exports = { fromLegacyLearningRecord };
