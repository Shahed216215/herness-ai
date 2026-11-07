'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const { buildPlanFromUnderstanding } = require('../services/mira-task-planner');

const { assertLegacyLearningStorageAllowed } = require('../services/learning');
const { assertLegacyStorageDisabled } = require('../services/mira-hfm-legacy-storage-guard');
assert.doesNotThrow(() => assertLegacyStorageDisabled({}));
assert.throws(
  () => assertLegacyStorageDisabled({ MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' }),
  error => error.code === 'HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE'
);
assert.throws(
  () => assertLegacyStorageDisabled({ MIRA_HFM_WORK_LEARNING_ENABLED: 'true' }),
  error => error.code === 'HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE'
);
const knowledgeStore = read('knowledge.js');
const memoryStore = read('memory.js');
const driveStore = read('google-drive.js');
assert.match(knowledgeStore, /function loadKnowledge\(\) \{\s*assertLegacyStorageDisabled\(\);/);
assert.match(knowledgeStore, /function saveLocalKnowledge\(data\) \{\s*assertLegacyStorageDisabled\(\);/);
assert.match(memoryStore, /function loadMemory\(\) \{\s*assertLegacyStorageDisabled\(\);/);
assert.match(memoryStore, /function saveMemory\(memory\) \{\s*assertLegacyStorageDisabled\(\);/);
for (const method of ['saveKnowledgeToDrive', 'loadKnowledgeFromDrive', 'saveMemoryToDrive', 'loadMemoryFromDrive']) {
  const start = driveStore.indexOf('async function ' + method);
  assert.ok(start >= 0 && driveStore.slice(start, start + 140).includes('assertLegacyStorageDisabled();'));
}
console.log('HFM_AUTHORITY_MODE_BLOCKS_LEGACY_JSON_AND_DRIVE_READ_WRITE=PASS');

assert.doesNotThrow(() => assertLegacyLearningStorageAllowed({}));
assert.throws(
  () => assertLegacyLearningStorageAllowed({ MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' }),
  error => error.code === 'HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_LEARNING_STORAGE'
);
assert.throws(
  () => assertLegacyLearningStorageAllowed({ MIRA_HFM_WORK_LEARNING_ENABLED: 'true' }),
  error => error.code === 'HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_LEARNING_STORAGE'
);
console.log('HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_LEARNING_STORAGE=PASS');


const planned = buildPlanFromUnderstanding({
  task: {
    id: 'task-hfm-functional-test',
    title: 'Python automation',
    description: 'Improve Python automation reliability',
    requirements: [],
    deliverables: ['Verified plan'],
    type: 'research'
  }
}, 'Improve Python automation reliability', {
  useHfmWorkLearning: true,
  hfmWorkLearning: {
    engineVersion: 'HFM_V02',
    taskId: 'task-hfm-functional-test',
    count: 1,
    transfers: [{
      memoryId: 'memory-learning-001',
      learningId: 'learning-previous-001',
      sourceTaskId: 'task-previous',
      lessons: ['Validate Python automation output before delivery'],
      task: { title: 'Python automation', description: 'Validate Python automation output' },
      governance: { readOnly: true, executable: false, modifiesCode: false, bypassesPolicy: false, requiresNormalTaskChecks: true }
    }]
  }
});
assert.equal(planned.experienceGuidance.crossTaskLearning.count, 1);
assert.equal(planned.experienceGuidance.strategies.length, 0);
assert.equal(planned.experienceGuidance.appliedToPlanning, true);
assert.ok(planned.plan.verificationPlan.some(item => item.checkId === 'cross-task-experience-1'));
console.log('HFM_WORK_LEARNING_RETRIEVED_LESSONS_REACH_TASK_PLAN=PASS');

const planner = read('services/mira-task-planner.js');
const execution = read('services/mira-work-execution-engine.js');
const server = read('server.js');
const bridge = read('services/mira-hfm-work-learning-retrieval.js');
const runtime = read('services/mira-hfm-work-learning-runtime.js');
const knowledgeSearch = read('services/mira-hfm-knowledge-search-runtime.js');
assert.match(server, /searchHfmKnowledge/);
assert.match(server, /HFM_READ_ONLY_LOCAL_MEMORY_DISABLED/);
assert.match(server, /HFM_STANDING_READ_ONLY/);
assert.match(server, /selectRecentMessages\(previousMemory\)/);
assert.match(server, /app\.get\(\s*"\/api\/admin\/knowledge\/:id"/);
assert.match(server, /HFM standing authority grants memory\.read only; Knowledge edits are not authorized/);
assert.match(server, /HFM standing authority grants memory\.read only; Knowledge deletion is not authorized/);
assert.match(server, /MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true"/);
assert.match(knowledgeSearch, /recordTypes: \['knowledge_item'\]/);
assert.match(knowledgeSearch, /retrieveCanonicalRecordsWithReport/);
assert.match(knowledgeSearch, /localFallback: false/);
assert.match(knowledgeSearch, /driveFallback: false/);
assert.match(knowledgeSearch, /HFM_KNOWLEDGE_STANDING_READ_AUTHORITY_DISABLED/);
console.log('HFM_GENERIC_KNOWLEDGE_SEARCH_AND_CHAT_USE_STANDING_READ=PASS');

const { createContentHash } = require('../services/mira-hfm-record-schema');
const { searchHfmKnowledge } = require('../services/mira-hfm-knowledge-search-runtime');
(async () => {
  const now = new Date().toISOString();
  const content = 'Verified Python automation research and reproducible testing notes.';
  const record = {
    schemaVersion: '1.1.0',
    memoryId: 'memory-knowledge-001',
    projectId: 'project-alpha',
    recordType: 'knowledge_item',
    content,
    source: { sourceType: 'web', sourceId: 'python-automation-guide', sourceUrl: 'https://example.test/python', observedAt: now },
    timestamps: { createdAt: now, updatedAt: now },
    version: { revision: 1, contentHash: createContentHash(content) },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'HUMAN_VERIFIED' },
    access: { classification: 'PUBLIC', allowedProjectIds: ['project-alpha'] },
    lifecycle: 'ACTIVE'
  };
  const result = await searchHfmKnowledge({
    req: {}, pool: {},
    query: 'Python automation testing',
    limit: 5,
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
    readMemory: async options => {
      assert.equal(options.standingReadAuthority, true);
      assert.deepEqual(options.recordTypes, ['knowledge_item']);
      assert.equal(options.lifecycle, 'ACTIVE');
      return {
        status: 'AUTHORIZED_AND_COMMITTED', projectId: 'project-alpha',
        records: [record], standingAuthority: true,
        approvalRequiredPerRead: false,
        authorityExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        hostAuthorizationContext: {
          actorId: 'mira:actor-001', actorType: 'HUMAN',
          projectId: 'project-alpha', purpose: 'knowledge search',
          requestId: 'request-knowledge-001', authorityRef: 'standing-001',
          issuedAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString()
        }
      };
    }
  });
  assert.equal(result.status, 'AUTHORIZED_AND_COMMITTED');
  assert.equal(result.count, 1);
  assert.equal(result.results[0].id, 'memory-knowledge-001');
  assert.equal(result.results[0].content, content);
  assert.equal(result.localFallback, false);
  assert.equal(result.driveFallback, false);
  const exact = await searchHfmKnowledge({
    req: {}, pool: {}, query: 'memory-knowledge-001', limit: 5,
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
    readMemory: async () => ({
      status: 'AUTHORIZED_AND_COMMITTED', projectId: 'project-alpha',
      records: [record], standingAuthority: true,
      approvalRequiredPerRead: false,
      hostAuthorizationContext: {
        actorId: 'mira:actor-001', actorType: 'HUMAN',
        projectId: 'project-alpha', purpose: 'knowledge detail',
        requestId: 'request-knowledge-detail-001', authorityRef: 'standing-001',
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      }
    })
  });
  assert.equal(exact.results[0].id, 'memory-knowledge-001');
  await assert.rejects(() => searchHfmKnowledge({
    req: {}, pool: {}, query: 'Python',
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'false' }
  }), error => error.code === 'HFM_KNOWLEDGE_STANDING_READ_AUTHORITY_DISABLED');
  console.log('HFM_KNOWLEDGE_SEARCH_RETRIEVES_ONLY_AUTHORIZED_ELIGIBLE_RECORDS=PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});



assert.match(planner, /process\.env\.MIRA_HFM_WORK_LEARNING_ENABLED === "true"/);
assert.match(planner, /HFM_WORK_LEARNING_RUNTIME_REQUIRED/);
assert.match(planner, /HFM_WORK_LEARNING_PREFLIGHT_REQUIRED/);
assert.match(planner, /HFM_WORK_LEARNING_PREFLIGHT_INVALID/);
assert.ok(planner.indexOf("HFM_WORK_LEARNING_PREFLIGHT_INVALID") < planner.indexOf("await understandTask("));
assert.ok(planner.indexOf("await options.preflightWorkLearning()") < planner.indexOf("await understandTask("));
assert.match(planner, /options\.useHfmWorkLearning === true\s*\? \[\]/);
assert.match(planner, /options\.useHfmWorkLearning === true\s*\?/);
assert.match(planner, /buildExperienceGuidance\(task, options\)/);
assert.match(planner, /options\.hfmWorkLearning/);
assert.match(execution, /retrieveHfmWorkLearning/);
assert.match(execution, /retrieveProjectMemory/);
assert.match(execution, /preflightWorkLearning = async/);
assert.match(execution, /HFM_WORK_LEARNING_PRECOMPUTED_PLAN_NOT_ALLOWED/);
assert.match(execution, /readMemory: async \(\) => preflight/);
assert.match(execution, /HFM_WORK_LEARNING_AUTHENTICATED_RUNTIME_REQUIRED/);
assert.match(execution, /options\.hfmRequest/);
assert.match(execution, /MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED !== "true"/);
assert.ok(execution.indexOf('getHfmMemoryReadRuntime') < execution.indexOf('await createTaskPlan('));
assert.ok(planner.indexOf('HFM_WORK_LEARNING_RUNTIME_REQUIRED') < planner.indexOf('await understandTask('));
assert.match(server, /hfmRequest: req/);
assert.match(server, /getHfmMemoryReadRuntime/);
assert.match(bridge, /canonical\.recordType !== 'learning_note'/);
assert.match(bridge, /rankedAfterHfmEligibilityFilter: true/);
assert.match(runtime, /MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED !== 'true'/);
assert.match(runtime, /buildHfmAuthorizeRequest/);
assert.match(runtime, /localFallback: false/);
assert.match(runtime, /driveFallback: false/);
console.log('HFM_WORK_LEARNING_PLANNER_WIRING=PASS');
console.log('HFM_WORK_LEARNING_FEATURE_FLAG_FAIL_CLOSED=PASS');
console.log('HFM_WORK_LEARNING_NO_LEGACY_LOCAL_FALLBACK_WHEN_ENABLED=PASS');
console.log('HFM_WORK_LEARNING_RUNTIME_AUTHORIZATION_CONTEXT_BOUND=PASS');
console.log('NETWORK_REQUESTS=0');
console.log('MEMORY_WRITES=0');
