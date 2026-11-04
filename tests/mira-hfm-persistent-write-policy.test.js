'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const policyPath = path.join(__dirname, '..', 'services', 'mira-tool-execution-policy.js');
const enginePath = path.join(__dirname, '..', 'services', 'mira-work-execution-engine.js');
const policySource = fs.readFileSync(policyPath, 'utf8');
const engineSource = fs.readFileSync(enginePath, 'utf8');
assert.match(engineSource, /require\(["']\.\/mira-tool-execution-policy["']\)/,
  'execution engine must use the shared authority policy');

const sandbox = { module: { exports: {} } };
vm.runInNewContext(policySource, sandbox, { filename: 'mira-tool-execution-policy.js' });
const { TOOL_POLICIES, checkToolSafety } = sandbox.module.exports;
assert.ok(TOOL_POLICIES && typeof checkToolSafety === 'function');

for (const name of ['memory_save', 'knowledge_save', 'learning_save']) {
  const policy = TOOL_POLICIES[name];
  assert.ok(policy, name + ' policy exists');
  assert.equal(policy.operation, 'file_modify');
  assert.equal(policy.autonomous, false);
  assert.equal(policy.humanApprovalRequired, true);
  assert.equal(policy.explicitConfirmation, true);

  const decision = checkToolSafety(name, { content: 'isolated test fixture' });
  assert.equal(decision.passed, false, name + ' must be denied');
  assert.match(decision.reason, /explicit human approval/i);
  console.log('MIRA_HFM_' + name.toUpperCase() + '_RUNTIME_POLICY_DENIAL=PASS');
}

const unknown = checkToolSafety('unregistered_persistent_writer', {});
assert.equal(unknown.passed, false, 'unknown tools must fail closed');
console.log('MIRA_HFM_UNKNOWN_TOOL_POLICY_DENIAL=PASS');
console.log('MIRA_HFM_PERSISTENT_WRITE_AUTONOMOUS_EXECUTION=DENIED');
console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
console.log('NETWORK_REQUESTS=0');
console.log('EXTERNAL_ACTIONS=0');
console.log('TESTS_FAILED=0');
