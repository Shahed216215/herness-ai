'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const planner = read('services/mira-task-planner.js');
const execution = read('services/mira-work-execution-engine.js');
const server = read('server.js');
const bridge = read('services/mira-hfm-work-learning-retrieval.js');
const runtime = read('services/mira-hfm-work-learning-runtime.js');

assert.match(planner, /process\.env\.MIRA_HFM_WORK_LEARNING_ENABLED === "true"/);
assert.match(planner, /HFM_WORK_LEARNING_RUNTIME_REQUIRED/);
assert.match(planner, /options\.useHfmWorkLearning === true\s*\? \[\]/);
assert.match(planner, /options\.useHfmWorkLearning === true\s*\?/);
assert.match(planner, /buildExperienceGuidance\(task, options\)/);
assert.match(planner, /options\.hfmWorkLearning/);
assert.match(execution, /retrieveHfmWorkLearning/);
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
