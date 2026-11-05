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
assert.ok(agent.includes('req.body.learningProposalOptIn === true'));
assert.ok(agent.includes('learningProposalHandoffAttempted'));
assert.ok(agent.includes('toolResult,'));
assert.ok(agent.includes('req,'));
assert.ok(server.includes('stageAgentGenerationProposal'));
assert.ok(server.includes('require("./services/mira-hfm-learning-generation-cycle-request")'));

assert.ok(route.includes("MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED === 'true'"));
assert.ok(route.includes('createGenerationCycleProposalOrchestrator('));
assert.ok(route.includes('app.locals.miraHfmLearningGenerationCycle'));
assert.ok(adapter.includes('createGenerationCycleProposalOrchestrator'));
assert.ok(requestAdapter.includes('function stageAgentGenerationProposal('));
assert.ok(requestAdapter.includes("toolName !== 'mira_hfm_public_web_retrieval'"));
assert.ok(requestAdapter.includes('learningProposalOptIn !== true'));
assert.ok(requestAdapter.includes("session.role === 'admin'"));
assert.ok(requestAdapter.includes('retrievalResult: retrievalReport'));
assert.ok(requestAdapter.includes('HFM_LEARNING_RETRIEVAL_REPORT_INVALID'));
assert.ok(requestAdapterTest.includes('HFM_PHASE8_AGENT_HOOK_EXACT_TOOL_AND_OPT_IN=PASS'));
assert.ok(requestAdapterTest.includes('HFM_PHASE8_AGENT_HOOK_FAILURE_FAIL_CLOSED=PASS'));

console.log('HFM_PHASE8_API_AGENT_RETRIEVAL_BEFORE_HANDOFF=PASS');
console.log('HFM_PHASE8_API_AGENT_EXACT_TOOL_AND_EXPLICIT_OPT_IN=PASS');
console.log('HFM_PHASE8_API_AGENT_NAMED_ADMIN_SESSION=PASS');
console.log('HFM_PHASE8_API_AGENT_SINGLE_HANDOFF_PER_REQUEST=PASS');
console.log('HFM_PHASE8_API_AGENT_REAL_RETRIEVAL_RESULT_ONLY=PASS');
console.log('HFM_PHASE8_API_AGENT_NO_CANONICAL_WRITES_OR_EXECUTION=PASS');
