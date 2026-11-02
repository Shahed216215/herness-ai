'use strict';

const fs = require('fs');
const path = require('path');
const storagePath = require('../mira-storage');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'tests');
const STORE_FILE = process.env.MIRA_STAGE13_STORE ||
  storagePath('data/stage13-learning-governance.json');
const VERSION = 1;
const MAX_RECORDS = 5000;

function now() { return new Date().toISOString(); }
function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}
function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function text(value, field, max = 500) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field}_required`);
  }
  const result = value.trim();
  if (result.length > max) throw new Error(`${field}_too_long`);
  return result;
}
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field}_must_be_object`);
  }
  return value;
}
function initialStore() {
  return {
    version: VERSION, updatedAt: now(),
    events: [], feedback: [], failures: [], benchmarks: []
  };
}
function ensureStore() {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(
      STORE_FILE, JSON.stringify(initialStore(), null, 2) + '\n',
      { flag: 'wx' }
    );
  }
  return loadStore();
}
function loadStore() {
  if (!fs.existsSync(STORE_FILE)) return initialStore();
  const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  if (!store || store.version !== VERSION ||
      !Array.isArray(store.events) ||
      !Array.isArray(store.feedback) ||
      !Array.isArray(store.failures) ||
      !Array.isArray(store.benchmarks)) {
    throw new Error('STAGE13_STORE_SCHEMA_INVALID');
  }
  return store;
}
function saveStore(store) {
  store.updatedAt = now();
  const temp = `${STORE_FILE}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temp, STORE_FILE);
}
function recordHash(record) {
  const { recordHash: ignored, ...content } = record;
  return sha(JSON.stringify(content));
}
function eventPayload(event) {
  return {
    eventId: event.eventId,
    type: event.type,
    recordId: event.recordId,
    recordHash: event.recordHash,
    timestamp: event.timestamp,
    previousHash: event.previousHash
  };
}
function appendEvent(store, type, record) {
  if (store.events.length >= MAX_RECORDS) {
    throw new Error('STAGE13_EVENT_LIMIT_REACHED');
  }
  const previousHash = store.events.length
    ? store.events[store.events.length - 1].hash
    : 'GENESIS';
  const event = {
    eventId: id('evt'), type, recordId: record.id,
    recordHash: record.recordHash, timestamp: now(), previousHash
  };
  event.hash = sha(JSON.stringify(eventPayload(event)));
  store.events.push(event);
}
function persist(store, collection, type, record) {
  record.recordHash = recordHash(record);
  store[collection].push(record);
  appendEvent(store, type, record);
  saveStore(store);
  return record;
}

/* Only execute an existing JavaScript test under the project's tests/ folder.
   No shell is used; arbitrary commands and paths outside tests/ are rejected. */
function runLocalTest(testFile) {
  const rel = text(testFile, 'testFile', 300);
  if (path.isAbsolute(rel) || !rel.startsWith('tests/') || !rel.endsWith('.js')) {
    throw new Error('testFile_must_be_project_tests_js_path');
  }
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(TEST_ROOT + path.sep) || !fs.existsSync(full) ||
      !fs.statSync(full).isFile()) {
    throw new Error('testFile_not_found_or_outside_tests');
  }
  const real = fs.realpathSync(full);
  const realRoot = fs.realpathSync(TEST_ROOT);
  if (!real.startsWith(realRoot + path.sep)) {
    throw new Error('testFile_symlink_outside_tests_blocked');
  }

  const started = Date.now();
  const result = spawnSync(process.execPath, [real], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024
  });
  const exitCode = Number.isInteger(result.status) ? result.status : null;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const spawnError = result.error ? String(result.error.code || result.error.message) : null;
  return {
    testFile: path.relative(ROOT, real),
    passed: exitCode === 0 && !timedOut && !spawnError,
    exitCode, timedOut, spawnError,
    durationMs: Date.now() - started,
    stdoutHash: sha(result.stdout || ''),
    stderrHash: sha(result.stderr || ''),
    output: String(result.stdout || '').slice(-3000),
    errorOutput: String(result.stderr || '').slice(-3000),
    ranAt: now()
  };
}

function recordFeedback(input) {
  object(input, 'feedback');
  const record = {
    id: id('feedback'),
    clientFeedback: text(input.clientFeedback, 'clientFeedback', 2000),
    errorAnalysis: text(input.errorAnalysis, 'errorAnalysis', 1500),
    lesson: text(input.lesson, 'lesson', 1500),
    improvementProposal: text(input.improvementProposal, 'improvementProposal', 1500),
    sourceWorkId: typeof input.workId === 'string' ? input.workId.slice(0, 200) : '',
    status: 'proposal_pending_review',
    approvalRequired: true, autoApplied: false, createdAt: now()
  };
  return persist(ensureStore(), 'feedback', 'FEEDBACK_LESSON_PROPOSED', record);
}

function recordFailure(input) {
  object(input, 'failure');
  const failure = text(input.failure, 'failure', 1500);
  const rootCause = text(input.rootCause, 'rootCause', 1500);
  const correction = text(input.correction, 'correction', 1500);
  const testCase = text(input.testCase, 'testCase', 1500);

  // Never trust a caller-supplied testPassed boolean.
  const execution = runLocalTest(input.testFile);
  const preventionKnowledge = text(input.preventionKnowledge, 'preventionKnowledge', 1500);
  const record = {
    id: id('failure'), failure, rootCause, correction, testCase,
    preventionKnowledge, testExecution: execution,
    testPassed: execution.passed,
    status: execution.passed
      ? 'prevention_test_passed_pending_review'
      : 'prevention_test_failed',
    approvalRequired: true, autoApplied: false, createdAt: now()
  };
  return persist(ensureStore(), 'failures', 'FAILURE_LEARNING_RECORDED', record);
}

function recordBenchmark(input) {
  object(input, 'benchmark');
  const skill = text(input.skill, 'skill', 200);
  const evidenceReference = text(input.evidenceReference, 'evidenceReference', 1000);
  if (!Array.isArray(input.tests) || input.tests.length === 0 || input.tests.length > 200) {
    throw new Error('benchmark_tests_required');
  }
  if (typeof input.minimumScore !== 'number' ||
      !Number.isFinite(input.minimumScore) ||
      input.minimumScore < 0 || input.minimumScore > 1) {
    throw new Error('minimumScore_must_be_between_0_and_1');
  }

  const tests = input.tests.map((test, index) => {
    object(test, `test_${index}`);
    const name = text(test.name, `test_${index}_name`, 300);
    const execution = runLocalTest(test.testFile);
    return { name, testExecution: execution, passed: execution.passed };
  });
  const passedCount = tests.filter(test => test.passed).length;
  const score = passedCount / tests.length;
  const criteriaMet = score >= input.minimumScore && passedCount === tests.length;

  const record = {
    id: id('benchmark'), skill, tests, passedCount,
    totalTests: tests.length, score, minimumScore: input.minimumScore,
    criteriaMet, evidenceReference,
    status: criteriaMet ? 'benchmark_passed_evidence_recorded' : 'benchmark_failed',
    capabilityClaimAllowed: criteriaMet,
    expertClaimAllowed: false, profileVerificationChanged: false,
    approvalRequired: true, autoApplied: false, createdAt: now()
  };
  return persist(ensureStore(), 'benchmarks', 'SKILL_BENCHMARK_RECORDED', record);
}

function verifyIntegrity() {
  const store = loadStore();
  const failures = [];
  const records = new Map();

  for (const collection of ['feedback', 'failures', 'benchmarks']) {
    for (const record of store[collection]) {
      if (!record || !record.id) {
        failures.push({ collection, reason: 'record_id_missing' });
        continue;
      }
      if (!record.recordHash || record.recordHash !== recordHash(record)) {
        failures.push({ recordId: record.id, reason: 'record_content_hash_mismatch' });
      }
      records.set(record.id, record);
    }
  }

  let previousHash = 'GENESIS';
  for (let i = 0; i < store.events.length; i++) {
    const event = store.events[i];
    const record = records.get(event.recordId);
    if (event.previousHash !== previousHash) {
      failures.push({ index: i, reason: 'previous_hash_mismatch' });
    }
    if (event.hash !== sha(JSON.stringify(eventPayload(event)))) {
      failures.push({ index: i, reason: 'event_hash_mismatch' });
    }
    if (!record || event.recordHash !== record.recordHash) {
      failures.push({ index: i, reason: 'event_record_binding_mismatch' });
    }
    previousHash = event.hash;
  }

  if (store.events.length !== records.size) {
    failures.push({ reason: 'record_event_count_mismatch' });
  }
  return {
    ok: failures.length === 0,
    eventCount: store.events.length,
    recordCount: records.size,
    failures
  };
}

function getSummary() {
  const s = loadStore();
  return {
    feedbackRecords: s.feedback.length,
    failureRecords: s.failures.length,
    benchmarkRecords: s.benchmarks.length,
    pendingFeedbackReview: s.feedback.filter(x => x.status === 'proposal_pending_review').length,
    failedPreventionTests: s.failures.filter(x => !x.testPassed).length,
    passedBenchmarks: s.benchmarks.filter(x => x.criteriaMet).length,
    integrity: verifyIntegrity()
  };
}

module.exports = {
  VERSION, STORE_FILE, ensureStore, loadStore, saveStore,
  runLocalTest, recordFeedback, recordFailure, recordBenchmark,
  verifyIntegrity, getSummary
};
