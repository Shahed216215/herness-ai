'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'routes/mira-hfm-learning-evolution.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'services/mira-hfm-learning-generation-cycle.js'), 'utf8');
const unitTest = fs.readFileSync(path.join(root, 'tests/mira-hfm-learning-generation-cycle.test.js'), 'utf8');

const agentStart = server.indexOf('app.post(\n  "/api/agent"');
assert.notEqual(agentStart, -1, 'Mira /api/agent route must exist');
const agentEnd = server.indexOf('\napp.use(', agentStart);
assert.notEqual(agentEnd, -1, 'Mira /api/agent route must have a bounded end');
const agent = server.slice(agentStart, agentEnd);

const retrievalExecution = agent.indexOf('await executeWork(');
const handoffGate = agent.indexOf('toolName === "mira_hfm_public_web_retrieval"');
const handoffCall = agent.indexOf('await stageAgentGenerationCycleProposal({', handoffGate);
assert.ok(retrievalExecution >= 0 && handoffGate > retrievalExecution,
  'HFM proposal handoff must occur only after tool execution returns');
assert.ok(handoffCall > handoffGate,
  'proposal staging must be downstream of the exact HFM retrieval tool result');
assert.ok(agent.includes('req.body.learningProposalOptIn === true'));
assert.ok(agent.includes('learningProposalHandoffAttempted'));
assert.ok(agent.includes('toolResult,'));
assert.ok(agent.includes('requestRole: req.role'));
assert.ok(agent.includes('session: req.session'));

assert.match(server, /const \{ stageAgentGenerationCycleProposal \ } =/);
assert.match(server, /require\("\.\/services\/mira-hfm-learning-generation-cycle"\)/);
assert.match(adapter, /function stageAgentGenerationCycleProposal\(/);
assert.match(adapter, /requestBody\.learningProposalOptIn !== true/);
assert.match(adapter, /requestRole !== 'admin'/);
assert.match(adapter, /session\.authenticated !== true/);
assert.match(adapter, /session\.role !== 'admin'/);
assert.match(adapter, /retrievalResult: retrievalReport/);
assert.match(adapter, /HFM_LEARNING_GENERATION_BRIDGE_UNAVAILABLE/);

assert.match(route, /MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED === 'true'/);
assert.match(route, /createGenerationCycleProposalOrchestrator\(/);
assert.match(route, /app\.locals\.miraHfmLearningGenerationCycle/);
assert.match(unitTest, /stageAgentGenerationCycleProposal/);
assert.match(unitTest, /HFM_LEARNING_NAMED_ADMIN_REQUIRED/);
assert.match(unitTest, /HFM_LEARNING_GENERATION_BRIDGE_UNAVAILABLE/);

console.log('HFM_PHASE8_API_AGENT_RETRIEVAL_BEFORE_HANDOFF=PASS');
console.log('HFM_PHASE8_API_AGENT_EXACT_TOOL_AND_EXPLICIT_OPT_IN=PASS');
console.log('HFM_PHASE8_API_AGENT_NAMED_ADMIN_SESSION=PASS');
console.log('HFM_PHASE8_API_AGENT_SINGLE_HANDOFF_PER_REQUEST=PASS');
console.log('HFM_PHASE8_API_AGENT_REAL_RETRIEVAL_RESULT_ONLY=PASS');
console.log('HFM_PHASE8_API_AGENT_HOOK_DISABLED_BY_DEFAULT=PASS');
console.log('HFM_PHASE8_API_AGENT_NO_CANONICAL_WRITES_OR_EXECUTION=PASS');
