'use strict';

const fs = require('node:fs');
const path = require('node:path');
const storagePath = require('../../mira-storage');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const AUDIT_FILE = storagePath('data/specialist-audit.jsonl');

const REQUIRED_CAPABILITIES = Object.freeze({
  researcher: 'research',
  coder: 'code_review',
  data: 'data_analysis',
  writer: 'document_drafting',
  excel: 'spreadsheet_analysis',
  automation: 'workflow_planning'
});

function safeText(value, max = 500) {
  return typeof value === 'string'
    ? value.trim().slice(0, max)
    : '';
}

function digest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function makeEvidence(specialist, requestId, result) {
  const record = {
    specialist,
    requestId,
    resultDigest: digest(result),
    createdAt: new Date().toISOString()
  };

  return Object.freeze({
    ...record,
    evidenceDigest: digest(record)
  });
}

function verifyEvidence(result) {
  if (!result || typeof result !== 'object') return false;
  const { evidence, output, specialist, requestId } = result;

  if (!evidence || !output || typeof output !== 'object') return false;
  if (evidence.specialist !== specialist) return false;
  if (evidence.requestId !== requestId) return false;
  if (evidence.resultDigest !== digest(output)) return false;

  const { specialist: s, requestId: r,
    resultDigest, createdAt } = evidence;

  return evidence.evidenceDigest === digest({
    specialist: s,
    requestId: r,
    resultDigest,
    createdAt
  });
}

function appendAudit(event) {
  fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
  fs.appendFileSync(
    AUDIT_FILE,
    JSON.stringify(event) + '\n',
    { encoding: 'utf8', mode: 0o600 }
  );
}

const handlers = Object.freeze({
  researcher: async request => ({
    kind: 'research_plan',
    topic: request.task,
    steps: ['Identify reliable sources', 'Collect evidence',
      'Cross-check findings', 'Summarize with source references']
  }),

  coder: async request => ({
    kind: 'code_work_plan',
    task: request.task,
    steps: ['Inspect relevant files', 'Propose a minimal change',
      'Run approved tests', 'Report changed files and test evidence']
  }),

  data: async request => ({
    kind: 'data_analysis_plan',
    task: request.task,
    steps: ['Validate input schema', 'Check data quality',
      'Analyze supplied data', 'Report limitations']
  }),

  writer: async request => ({
    kind: 'document_draft',
    task: request.task,
    draft: '',
    note: 'Draft requested; source material is required for factual claims.'
  }),

  excel: async request => ({
    kind: 'spreadsheet_plan',
    task: request.task,
    steps: ['Inspect columns', 'Validate values',
      'Calculate requested summaries', 'Verify output']
  }),

  automation: async request => ({
    kind: 'workflow_plan',
    task: request.task,
    steps: ['Describe proposed actions', 'Check required permissions',
      'Request approval for side effects', 'Verify before reporting success'],
    executed: false
  })
});

function createSpecialistRuntime(options = {}) {
  const authorize = options.authorize;

  if (typeof authorize !== 'function') {
    throw new TypeError('A trusted Core authorize(request, specialist) function is required.');
  }

  const audit = typeof options.audit === 'function'
    ? options.audit
    : appendAudit;

  async function dispatch(input) {
    const startedAt = new Date().toISOString();
    let specialist = 'unknown';
    let requestId = '';

    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('INVALID_REQUEST');
      }

      specialist = safeText(input.specialist, 40);
      requestId = safeText(input.requestId, 100);
      const task = safeText(input.task, 2000);

      if (!requestId || !task) throw new Error('INVALID_REQUEST');

      const required = REQUIRED_CAPABILITIES[specialist];
      const handler = handlers[specialist];

      if (!required || !handler) throw new Error('UNKNOWN_SPECIALIST');

      // Permission must come from trusted Core policy, not the worker.
      const grant = await authorize(
        Object.freeze({ requestId, task }),
        specialist
      );

      if (!grant || grant.allowed !== true) {
        throw new Error('PERMISSION_DENIED');
      }

      if (!Array.isArray(grant.capabilities) ||
          !grant.capabilities.includes(required)) {
        throw new Error('CAPABILITY_DENIED');
      }

      // Workers only create bounded plans/drafts; no arbitrary shell execution.
      const output = await handler(Object.freeze({ requestId, task }));

      if (!output || typeof output !== 'object') {
        throw new Error('INVALID_WORKER_OUTPUT');
      }

      const evidence = makeEvidence(specialist, requestId, output);
      const result = Object.freeze({
        ok: true,
        specialist,
        requestId,
        output,
        evidence
      });

      if (!verifyEvidence(result)) throw new Error('EVIDENCE_INVALID');

      const verified = Object.freeze({
        ...result,
        verified: true
      });

      await audit({
        type: 'specialist.completed',
        requestId,
        specialist,
        approvedBy: safeText(grant.approvedBy, 100),
        grantId: safeText(grant.grantId, 100),
        evidenceDigest: evidence.evidenceDigest,
        startedAt,
        finishedAt: new Date().toISOString(),
        outcome: 'success'
      });

      return verified;
    } catch (error) {
      const code = safeText(error && error.message, 100) || 'EXECUTION_FAILED';

      try {
        await audit({
          type: 'specialist.rejected_or_failed',
          requestId,
          specialist,
          startedAt,
          finishedAt: new Date().toISOString(),
          outcome: 'failure',
          reason: code
        });
      } catch {
        // Fail closed if audit persistence is unavailable.
        return {
          ok: false,
          specialist,
          requestId,
          error: code,
          auditFailure: true
        };
      }

      return { ok: false, specialist, requestId, error: code };
    }
  }

  return Object.freeze({
    dispatch,
    verifyEvidence,
    specialists: Object.freeze(Object.keys(handlers)),
    requiredCapabilities: REQUIRED_CAPABILITIES
  });
}

module.exports = {
  createSpecialistRuntime,
  verifyEvidence,
  REQUIRED_CAPABILITIES
};
