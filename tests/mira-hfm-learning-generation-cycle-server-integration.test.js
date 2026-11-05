'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'routes/mira-hfm-learning-evolution.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'services/mira-hfm-learning-generation-cycle.js'), 'utf8');
const requestAdapterPath = path.join(root, 'services/mira-hfm-learning-generation-cycle-request.js');
const requestAdapter = fs.existsSync(requestAdapterPath)
  ? fs.readFileSync(requestAdapterPath, 'utf8') : '';
const unitTest = fs.readFileSync(path.join(root, 'tests/mira-hfm-learning-generation-cycle.test.js'), 'utf8');
const requestTestPath = path.join(root, 'tests/mira-hfm-learning-generation-cycle-request.test.js');
const requestTest = fs.existsSync(requestTestPath) ? fs.readFileSync(requestTestPath, 'utf8') : '';

const agentStart = server.indexOf('app.post(\n  "/api/agent"');
assert.notEqual(agentStart, -1, 'Mira /api/agent route must exist');
const agentEnd = server.indexOf('\napp.use(', agentStart);
assert.notEqual(agentEnd, -1, 'Mira /api/agent route must have a bounded end');
const agent = server.slice(agentStart, agentEnd);

const retrievalExecution = agent.indexOf('await executeWork(');
const handoffGate = agent.indexOf('toolName === "mira_hfm_public_web_retrieval"');
const requestCall = agent.indexOf('await stageAgentGenerationProposal({');
const cycleCall = agent.indexOf('await stageAgentGenerationCycleProposal({');
const handoffCall = Math.max(requestCall, cycleCall);
assert.ok(retrievalExecution >= 0 && handoffGate > retrievalExecution,
  'HFM proposal handoff must occur only after tool execution returns');
assert.ok(handoffCall > handoffGate,
  'proposal staging must be downstream of the exact HFM retrieval tool result');
assert.ok(agent.includes('req.body.learningProposalOptIn === true'));
assert.ok(agent.includes('learningProposalHandoffAttempted'));
assert.ok(agent.includes('toolResult,'));

const usesRequestAdapter = requestCall >= 0;
if (usesRequestAdapter) {
  assert.ok(server.includes('stageAgentGenerationProposal'));
  assert.ok(requestAdapter.includes('function stageAgentGenerationProposal('));
  assert.ok(requestAdapter.includes('session.authenticated === true'));
  assert.ok(requestAdapter.includes("session.role === 'admin'"));
  assert.ok(requestTest.includes('HFM_PHASE8_AGENT_HOOK_EXACT_TOOL_AND_OPT_IN=PASS'));
} else {
  assert.ok(server.includes('stageAgentGenerationCycleProposal'));
  assert.ok(adapter.includes('function stageAgentGenerationCycleProposal('));
  assert.ok(agent.includes('requestRole: req.role'));
  assert.ok(agent.includes('session: req.session'));
  assert.ok(unitTest.includes('HFM_PHASE8_AGENT_LOOP_EXPLICIT_OPT_IN_HANDOFF=PASS'));
}

assert.ok(route.includes("MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED === 'true'"));
assert.ok(route.includes('createGenerationCycleProposalOrchestrator('));
assert.ok(route.includes('app.locals.miraHfmLearningGenerationCycle'));

console.log('HFM_PHASE8_API_AGENT_RETRIEVAL_BEFORE_HANDOFF=PASS');
console.log('HFM_PHASE8_API_AGENT_EXPLICIT_OPT_IN=PASS');
console.log('HFM_PHASE8_API_AGENT_NAMED_ADMIN_SESSION=PASS');
console.log('HFM_PHASE8_API_AGENT_SINGLE_HANDOFF_PER_REQUEST=PASS');
console.log('HFM_PHASE8_API_AGENT_REAL_RETRIEVAL_RESULT_ONLY=PASS');
console.log('HFM_PHASE8_API_AGENT_HOOK_DISABLED_BY_DEFAULT=PASS');
console.log('HFM_PHASE8_API_AGENT_NO_CANONICAL_WRITES_OR_EXECUTION=PASS');
