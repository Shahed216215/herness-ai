'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const { buildPlanFromUnderstanding } = require('../services/mira-task-planner');
const { resolveHfmReadToolContext, resolveHfmWriteToolContext } = require('../services/mira-work-execution-engine');

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

const registerKnowledgeImprovementRoutes = require('../routes/knowledge-improvements');
const registeredKnowledgeRoutes = new Map();
const fakeApp = {
  get: (route, ...handlers) => registeredKnowledgeRoutes.set('GET ' + route, handlers[handlers.length - 1]),
  post: (route, ...handlers) => registeredKnowledgeRoutes.set('POST ' + route, handlers[handlers.length - 1])
};
registerKnowledgeImprovementRoutes(fakeApp, () => (_req, _res, next) => next && next(), {
  SYSTEM_ADMIN: 'system-admin', AUDIT_LOG: 'audit-log'
});
const previousStandingFlag = process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
const previousWorkFlag = process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
try {
  for (const [method, route] of [
    ['GET', '/api/admin/knowledge-improvements'],
    ['GET', '/api/admin/knowledge-improvements/:id'],
    ['POST', '/api/admin/knowledge-improvements/:id/approve'],
    ['POST', '/api/admin/knowledge-improvements/:id/reject'],
    ['POST', '/api/admin/knowledge-improvements/:id/apply']
  ]) {
    const handler = registeredKnowledgeRoutes.get(method + ' ' + route);
    assert.equal(typeof handler, 'function', method + ' ' + route + ' registered');
    let statusCode = 200;
    let payload;
    const response = {
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; return this; }
    };
    handler({ params: { id: 'legacy-proposal' }, role: 'admin' }, response);
    assert.equal(statusCode, 403, method + ' ' + route + ' blocked in HFM mode');
    assert.equal(payload.code, 'HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_KNOWLEDGE_IMPROVEMENTS');
  }
  console.log('HFM_AUTHORITY_MODE_BLOCKS_LEGACY_KNOWLEDGE_IMPROVEMENT_ROUTES=PASS');
const registerAutonomousLearningRoutes = require('../routes/autonomous-learning');
let autonomousRouter;
registerAutonomousLearningRoutes({
  use: (_path, router) => { autonomousRouter = router; }
}, () => (_req, _res, next) => next && next(), {
  SYSTEM_ADMIN: 'system-admin'
});
const autonomousGuard = autonomousRouter.stack[0].handle;
const oldStanding = process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
const oldWork = process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
try {
  process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
  delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  let denied = false;
  autonomousGuard({}, {
    status(code) { assert.equal(code, 403); return this; },
    json(payload) {
      denied = true;
      assert.equal(payload.code, 'HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_AUTONOMOUS_LEARNING');
      return this;
    }
  }, () => assert.fail('router must deny HFM mode'));
  assert.equal(denied, true);
  delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  process.env.MIRA_HFM_WORK_LEARNING_ENABLED = 'true';
  let workDenied = false;
  autonomousGuard({}, {
    status(code) { assert.equal(code, 403); return this; },
    json(payload) {
      workDenied = true;
      assert.equal(payload.code, 'HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_AUTONOMOUS_LEARNING');
      return this;
    }
  }, () => assert.fail('router must deny Work Learning mode'));
  assert.equal(workDenied, true);
  delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  let continued = false;
  autonomousGuard({}, {}, () => { continued = true; });
  assert.equal(continued, true);
  console.log('HFM_AUTHORITY_MODE_BLOCKS_LEGACY_AUTONOMOUS_LEARNING_ROUTER=PASS');

const registerLearningHistoryRoutes = require('../routes/learning-history');
let learningHistoryRouter;
registerLearningHistoryRoutes({
  use: (_path, router) => { learningHistoryRouter = router; }
}, () => (_req, _res, next) => next && next(), {
  SYSTEM_ADMIN: 'system-admin'
});
const lessonsLayer = learningHistoryRouter.stack.find(layer => layer.route && layer.route.path === '/lessons');
assert.ok(lessonsLayer, 'local lessons route registered');
const lessonsHandler = lessonsLayer.route.stack[lessonsLayer.route.stack.length - 1].handle;
const oldLessonStanding = process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
const oldLessonWork = process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
try {
  process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
  delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  let lessonDenied = false;
  lessonsHandler({ query: {} }, {
    status(code) { assert.equal(code, 403); return this; },
    json(payload) {
      lessonDenied = true;
      assert.equal(payload.code, 'HFM_READ_ONLY_AUTHORITY_BLOCKS_LOCAL_EXPERIENCE_LESSONS');
      return this;
    }
  });
  assert.equal(lessonDenied, true);
} finally {
  if (oldLessonStanding === undefined) delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  else process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = oldLessonStanding;
  if (oldLessonWork === undefined) delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  else process.env.MIRA_HFM_WORK_LEARNING_ENABLED = oldLessonWork;
}
console.log('HFM_AUTHORITY_MODE_BLOCKS_LOCAL_EXPERIENCE_LESSONS=PASS');

const registerMiraEvolutionRoutes = require('../routes/mira-evolution');
let miraEvolutionRouter;
registerMiraEvolutionRoutes({
  use: (...args) => { miraEvolutionRouter = args[args.length - 1]; }
}, () => (_req, _res, next) => next && next(), {
  SYSTEM_ADMIN: 'system-admin'
});
const evolutionGuard = miraEvolutionRouter.stack[0].handle;
const oldEvolutionStanding = process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
const oldEvolutionWork = process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
try {
  process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
  delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  let evolutionDenied = false;
  evolutionGuard({}, {
    status(code) { assert.equal(code, 403); return this; },
    json(payload) {
      evolutionDenied = true;
      assert.equal(payload.code, 'HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_EVOLUTION');
      return this;
    }
  }, () => assert.fail('legacy Evolution router must be blocked'));
  assert.equal(evolutionDenied, true);
} finally {
  if (oldEvolutionStanding === undefined) delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  else process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = oldEvolutionStanding;
  if (oldEvolutionWork === undefined) delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  else process.env.MIRA_HFM_WORK_LEARNING_ENABLED = oldEvolutionWork;
}
console.log('HFM_AUTHORITY_MODE_BLOCKS_LEGACY_EVOLUTION_ROUTER=PASS');


} finally {
  if (oldStanding === undefined) delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  else process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = oldStanding;
  if (oldWork === undefined) delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  else process.env.MIRA_HFM_WORK_LEARNING_ENABLED = oldWork;
}

} finally {
  if (previousStandingFlag === undefined) delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  else process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = previousStandingFlag;
  if (previousWorkFlag === undefined) delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  else process.env.MIRA_HFM_WORK_LEARNING_ENABLED = previousWorkFlag;
}


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
assert.match(server, /MIRA_HFM_WORK_LEARNING_ENABLED === "true"/);
assert.match(server, /HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_LEARNING_DIAGNOSTIC/);
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
const { tools, executeTool, executeHfmKnowledgeSearch } = require('../tools');
const { applyAutonomousLearningControlled } = require('../autonomous-learning-controlled-apply');
const { applyKnowledgeImprovementControlled } = require('../knowledge-controlled-apply');
const { verifyEvolutionState } = require('../knowledge-memory-evolution');
const legacyEvolution = read('knowledge-memory-evolution.js');
assert.match(legacyEvolution, /function readJsonFile\(filePath\) \{\s*assertLegacyStorageDisabled\(\);/);
assert.match(legacyEvolution, /function atomicWriteJson\(filePath, value\) \{\s*assertLegacyStorageDisabled\(\);/);
(async () => {
  const serverHeldReq = { serverHeld: true };
  const readerPool = { connect: async () => ({ release() {} }) };
  const standingOnlyContext = await resolveHfmReadToolContext({
    hfmRequest: serverHeldReq,
    getHfmMemoryReadRuntime: async () => ({ status: 'MEMORY_READ_READY', pool: readerPool })
  }, { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' });
  assert.equal(standingOnlyContext.runtime.status, 'MEMORY_READ_READY');
  assert.equal(standingOnlyContext.toolContext.req, serverHeldReq);
  assert.equal(standingOnlyContext.toolContext.pool, readerPool);
  assert.equal(standingOnlyContext.toolContext.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED, 'true');
  assert.deepEqual(await resolveHfmReadToolContext({}, {}), { runtime: null, toolContext: null });
  await assert.rejects(
    () => resolveHfmReadToolContext({}, { MIRA_HFM_WORK_LEARNING_ENABLED: 'true' }),
    /HFM_WORK_LEARNING_STANDING_AUTHORITY_DISABLED/
  );
  await assert.rejects(
    () => resolveHfmReadToolContext({}, { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' }),
    /HFM_STANDING_READ_AUTHENTICATED_RUNTIME_REQUIRED/
  );
  await assert.rejects(
    () => resolveHfmReadToolContext({
      hfmRequest: serverHeldReq,
      getHfmMemoryReadRuntime: async () => ({ status: 'DISABLED', pool: null })
    }, { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' }),
    /HFM_STANDING_READ_MEMORY_READER_NOT_READY/
  );
  const bothFlagsContext = await resolveHfmReadToolContext({
    hfmRequest: serverHeldReq,
    getHfmMemoryReadRuntime: async () => ({ status: 'MEMORY_READ_READY', pool: readerPool })
  }, {
    MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true',
    MIRA_HFM_WORK_LEARNING_ENABLED: 'true'
  });
  assert.equal(bothFlagsContext.toolContext.pool, readerPool);
  const writerPool = { connect: async () => ({ release() {} }) };
  const issuerPool = { connect: async () => ({ release() {} }) };
  const writeContext = await resolveHfmWriteToolContext({
    hfmRequest: serverHeldReq,
    getHfmMemoryWriterRuntime: async () => ({ status: 'MEMORY_WRITER_READY', pool: writerPool }),
    getHfmAuthorityIssuerRuntime: async () => ({ status: 'AUTHORITY_ISSUER_READY', pool: issuerPool })
  }, {
    MIRA_HFM_MEMORY_WRITE_ENABLED: 'true',
    MIRA_HFM_AUTHORITY_ISSUER_ENABLED: 'true'
  }, 'Remember this: my preferred learning format is Bengali.');
  assert.equal(writeContext.req, serverHeldReq);
  assert.equal(writeContext.writerPool, writerPool);
  assert.equal(writeContext.issuerPool, issuerPool);
  assert.match(writeContext.userIntent, /Remember this/);
  assert.equal(await resolveHfmWriteToolContext({}, {}), null);
  await assert.rejects(
    () => resolveHfmWriteToolContext({}, { MIRA_HFM_MEMORY_WRITE_ENABLED: 'true' }),
    /HFM_MEMORY_WRITE_AUTHENTICATED_RUNTIMES_REQUIRED/
  );
  await assert.rejects(
    () => resolveHfmWriteToolContext({
      hfmRequest: serverHeldReq,
      getHfmMemoryWriterRuntime: async () => ({ status: 'DISABLED', pool: null }),
      getHfmAuthorityIssuerRuntime: async () => ({ status: 'AUTHORITY_ISSUER_READY', pool: issuerPool })
    }, { MIRA_HFM_MEMORY_WRITE_ENABLED: 'true' }),
    /HFM_MEMORY_WRITER_NOT_READY/
  );
  await assert.rejects(
    () => resolveHfmWriteToolContext({
      hfmRequest: serverHeldReq,
      getHfmMemoryWriterRuntime: async () => ({ status: 'MEMORY_WRITER_READY', pool: writerPool }),
      getHfmAuthorityIssuerRuntime: async () => ({ status: 'DISABLED', pool: null })
    }, { MIRA_HFM_MEMORY_WRITE_ENABLED: 'true' }),
    /HFM_AUTHORITY_ISSUER_NOT_READY/
  );
  console.log('HFM_MEMORY_WRITE_CONTEXT_BINDS_VERIFIED_WRITER_AND_ISSUER=PASS');
  console.log('HFM_MEMORY_WRITE_CONTEXT_FAILS_CLOSED_WHEN_UNAVAILABLE=PASS');
  console.log('HFM_STANDING_READ_TOOL_CONTEXT_AVAILABLE_WITHOUT_WORK_LEARNING=PASS');
  console.log('HFM_STANDING_READ_CONTEXT_FAILS_CLOSED_WHEN_UNAVAILABLE=PASS');

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
  const oldToolStanding = process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  const oldToolWork = process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  try {
    process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
    delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
    for (const toolName of [
      'memory_save', 'memory_restore', 'memory_count',
      'knowledge_count', 'knowledge_save',
      'knowledge_restore', 'knowledge_backup', 'learning_save'
    ]) {
      await assert.rejects(
        () => executeTool(toolName, {}),
        error => error.code === 'HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_MEMORY_KNOWLEDGE_TOOL'
      );
    }
    await assert.rejects(
      () => executeTool('knowledge_search', {}, null),
      error => error.code === 'HFM_KNOWLEDGE_TOOL_HFM_CONTEXT_REQUIRED'
    );
    delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
    process.env.MIRA_HFM_WORK_LEARNING_ENABLED = 'true';
    await assert.rejects(
      () => executeTool('knowledge_search', {}),
      error => error.code === 'HFM_KNOWLEDGE_TOOL_HFM_CONTEXT_REQUIRED'
    );
  } finally {
    if (oldToolStanding === undefined) delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
    else process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = oldToolStanding;
    if (oldToolWork === undefined) delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
    else process.env.MIRA_HFM_WORK_LEARNING_ENABLED = oldToolWork;
  }
  console.log('HFM_AUTHORITY_MODE_BLOCKS_LEGACY_MEMORY_KNOWLEDGE_LEARNING_TOOLS=PASS');
  const oldDirectStanding = process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  const oldDirectWork = process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  try {
    process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
    delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  for (const [toolName, args] of [
    ['knowledge_backup', {}], ['knowledge_cleanup', { action: 'inspect' }],
    ['knowledge_count', {}], ['knowledge_improve', {}],
    ['knowledge_restore', { confirm: true }], ['knowledge_save', { title: 'x', content: 'x' }],
    ['knowledge_search', { query: 'Python' }], ['learning_save', { content: 'x' }],
    ['memory_count', {}], ['memory_restore', { confirm: true }],
    ['memory_save', { content: 'x' }]
  ]) {
    assert.equal(typeof tools[toolName]?.execute, 'function', toolName + ' tool is registered');
    await assert.rejects(
      () => tools[toolName].execute(args),
      error => error.code === 'HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE'
    );
  }
  await assert.rejects(
    () => applyAutonomousLearningControlled(),
    error => error.code === 'HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE'
  );
  await assert.rejects(
    () => applyKnowledgeImprovementControlled(),
    error => error.code === 'HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE'
  );
  } finally {
    if (oldDirectStanding === undefined) delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
    else process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = oldDirectStanding;
    if (oldDirectWork === undefined) delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
    else process.env.MIRA_HFM_WORK_LEARNING_ENABLED = oldDirectWork;
  }
  console.log('HFM_AUTHORITY_MODE_BLOCKS_DIRECT_LEGACY_TOOL_AND_CONTROLLED_APPLY_CALLS=PASS');
  const hfmToolContext = {
    hfmReadOnly: { req: { serverHeld: true }, pool: { connect: async () => ({}) }, env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' } }
  };
  let searchInput;
  const hfmToolResult = await executeHfmKnowledgeSearch(
    { query: 'Python automation' },
    hfmToolContext,
    async input => {
      searchInput = input;
      return {
        status: 'AUTHORIZED_AND_COMMITTED', standingAuthority: true,
        count: 1, results: [{ id: 'hfm-knowledge-1' }],
        localFallback: false, driveFallback: false
      };
    }
  );
  assert.equal(searchInput.req.serverHeld, true);
  assert.equal(searchInput.query, 'Python automation');
  assert.equal(searchInput.limit, 5);
  assert.equal(JSON.parse(hfmToolResult).source, 'HFM_V02_STANDING_READ');
  assert.equal(JSON.parse(hfmToolResult).localFallback, false);
  await assert.rejects(
    () => executeHfmKnowledgeSearch({ query: 'Python' }, null, async () => ({})),
    error => error.code === 'HFM_KNOWLEDGE_TOOL_HFM_CONTEXT_REQUIRED'
  );
  await assert.rejects(
    () => executeHfmKnowledgeSearch({ query: 'Python' }, hfmToolContext, async () => ({
      status: 'AUTHORIZED_AND_COMMITTED', standingAuthority: true,
      count: 1, results: [], localFallback: true, driveFallback: false
    })),
    error => error.code === 'HFM_KNOWLEDGE_TOOL_AUTHORIZED_READ_REQUIRED'
  );
  console.log('HFM_KNOWLEDGE_SEARCH_TOOL_USES_SERVER_HELD_STANDING_READ_CONTEXT=PASS');
  await assert.rejects(() => searchHfmKnowledge({
    req: {}, pool: {}, query: 'Python',
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'false' }
  }), error => error.code === 'HFM_KNOWLEDGE_STANDING_READ_AUTHORITY_DISABLED');
  console.log('HFM_KNOWLEDGE_SEARCH_RETRIEVES_ONLY_AUTHORIZED_ELIGIBLE_RECORDS=PASS');
  const oldEvolutionFlag = process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
  try {
    const blockedEvolutionRead = await verifyEvolutionState('knowledge');
    assert.equal(blockedEvolutionRead.ok, false);
    assert.equal(blockedEvolutionRead.status, 'integrity_check_failed');
    assert.match(blockedEvolutionRead.error, /HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE/);
  } finally {
    if (oldEvolutionFlag === undefined) delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
    else process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = oldEvolutionFlag;
  }
  console.log('HFM_AUTHORITY_MODE_BLOCKS_LEGACY_EVOLUTION_LOCAL_AND_DRIVE_STATE=PASS');
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
assert.match(execution, /toolContext: Object\.freeze/);
assert.match(execution, /resolveHfmReadToolContext/);
assert.match(execution, /resolveHfmWriteToolContext/);
assert.match(execution, /MIRA_HFM_MEMORY_WRITE_ENABLED/);
assert.match(execution, /hfmWrite: Object\.freeze/);
assert.match(execution, /if \(!standingReadEnabled && !workLearningEnabled\)/);
assert.match(execution, /hfmReadOnly: hfmToolContext/);
assert.match(execution, /options\.hfmRequest/);
assert.match(execution, /env\.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true"/);
assert.ok(execution.indexOf('getHfmMemoryReadRuntime') < execution.indexOf('await createTaskPlan('));
assert.ok(planner.indexOf('HFM_WORK_LEARNING_RUNTIME_REQUIRED') < planner.indexOf('await understandTask('));
assert.match(server, /hfmRequest: req/);
assert.match(server, /getHfmMemoryReadRuntime/);
assert.match(server, /getHfmMemoryWriterRuntime/);
assert.match(server, /getHfmAuthorityIssuerRuntime/);
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
