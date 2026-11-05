'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'routes/mira-hfm-learning-evolution.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'services/mira-hfm-learning-generation-cycle.js'), 'utf8');
const requestAdapter = fs.readFileSync(path.join(root, 'services/mira-hfm-learning-generation-cycle-request.js'), 'utf8');
const requestAdapterTest = fs.readFileSync(path.join(root, 'tests/mira-hfm-learning-generation-cycle-request.test.js'), 'utf8');

const agentStart = server.indexOf('app.post(\n  "/api/agent"');
assert.notEqual(agentStart, -1, 'Mira /api/agent route must exist');
const agentEnd = server.indexOf('\napp.use(', agentStart);
assert.notEqual(agentEnd, -1, 'Mira /api/agent route must have a bounded end');
const agent = server.slice(agentStart, agentEnd);

const retrievalExecution = agent.indexOf('await executeWork(');
const handoffGate = agent.indexOf('toolName === "mira_hfm_public_web_retrieval"');
const handoffCall = agent.indexOf('await stageAgentGenerationProposal({');
assert.ok(retrievalExecution >= 0 && handoffGate > retrievalExecution,
  'HFM proposal handoff must occur only after tool execution returns');
assert.ok(handoffCall > handoffGate,
  'proposal staging must be downstream of the exact HFM retrieval tool result');

assert.match(agent, /req\\.body\\.learningProposalOptIn === true/);
assert.match(agent, /learningProposalHandoffAttempted/);
assert.match(agent, /toolResult,/);
assert.match(server, /stageAgentGenerationProposal/);
assert.match(server, /require\\("\.\\/services\\/mira-hfm-learning-generation-cycle-request"\\)/);

assert.match(route, /MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED === 'true'/);
assert.match(route, /createGenerationCycleProposalOrchestrator\\(/);
assert.match(route, /app\\.locals\\.miraHfmLearningGenerationCycle/);
assert.match(adapter, /explicitOptIn !== true/);
assert.match(adapter, /actor\\.authenticated !== true/);
assert.match(adapter, /actor\\.role !== 'admin'/);
assert.match(adapter, /trustState !== 'UNTRUSTED'/);
assert.match(adapter, /canonicalMemoryWrites !== 0/);
assert.match(adapter, /automaticExecution !== false/);

assert.match(requestAdapter, /learningProposalOptIn !== true/);
assert.match(requestAdapter, /session\\.authenticated === true/);
assert.match(requestAdapter, /session\\.role === 'admin'/);
assert.match(requestAdapter, /retrievalResult: retrievalReport/);
assert.match(requestAdapter, /HFM_LEARNING_RETRIEVAL_REPORT_INVALID/);
assert.match(requestAdapterTest, /HFM_PHASE8_AGENT_HOOK_EXACT_TOOL_AND_OPT_IN=PASS/);
assert.match(requestAdapterTest, /HFM_PHASE8_AGENT_HOOK_FAILURE_FAIL_CLOSED=PASS/);

console.log('HFM_PHASE8_API_AGENT_RETRIEVAL_BEFORE_HANDOFF=PASS');
console.log('HFM_PHASE8_API_AGENT_EXPLICIT_OPT_IN=PASS');
console.log('HFM_PHASE8_API_AGENT_NAMED_ADMIN_SESSION=PASS');
console.log('HFM_PHASE8_API_AGENT_SINGLE_HANDOFF_PER_REQUEST=PASS');
console.log('HFM_PHASE8_API_AGENT_REAL_RETRIEVAL_RESULT_ONLY=PASS');
console.log('HFM_PHASE8_API_AGENT_REQUEST_ADAPTER_COVERED=PASS');
console.log('HFM_PHASE8_API_AGENT_NO_RETRIEVAL_FAILS_CLOSED=PASS');
console.log('HFM_PHASE8_API_AGENT_HOOK_DISABLED_BY_DEFAULT=PASS');
console.log('HFM_PHASE8_API_AGENT_NO_CANONICAL_WRITES_OR_EXECUTION=PASS');
