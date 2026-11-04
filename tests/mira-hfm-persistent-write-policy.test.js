'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const engine = fs.readFileSync(path.join(__dirname, '..', 'services', 'mira-work-execution-engine.js'), 'utf8');
const policyStart = engine.indexOf('const TOOL_POLICIES = Object.freeze(');
assert.notEqual(policyStart, -1, 'TOOL_POLICIES declaration exists');
const policyEnd = engine.indexOf('\n});', policyStart);
assert.notEqual(policyEnd, -1, 'TOOL_POLICIES declaration closes');
const policySource = engine.slice(policyStart, policyEnd + '\n});'.length);

const checkStart = engine.indexOf('function checkToolSafety(toolName, args) {');
assert.notEqual(checkStart, -1, 'checkToolSafety function exists');
const checkEnd = engine.indexOf('\nfunction checkExpectedResult(', checkStart);
assert.notEqual(checkEnd, -1, 'checkToolSafety function boundary exists');
const checkSource = engine.slice(checkStart, checkEnd);

const harness = vm.runInNewContext(`
  ${policySource}
  function cleanText(value, max = 5000) {
    const text = value === undefined || value === null ? "" : String(value).trim();
    if (text.length > max) throw new Error("Value exceeds maximum length.");
    return text;
  }
  function getToolPolicy(toolName) {
    const normalized = cleanText(toolName, 200).toLowerCase();
    return TOOL_POLICIES[normalized] || null;
  }
  ${checkSource}
  ({ checkToolSafety })
`);

for (const name of ['memory_save', 'knowledge_save', 'learning_save']) {
  const start = engine.indexOf('  ' + name + ': {');
  assert.notEqual(start, -1, name + ' policy exists');
  const end = engine.indexOf('\n  },', start);
  assert.notEqual(end, -1, name + ' policy closes');
  const policy = engine.slice(start, end);
  for (const expected of [
    'operation: "file_modify"',
    'autonomous: false',
    'humanApprovalRequired: true',
    'explicitConfirmation: true'
  ]) assert.ok(policy.includes(expected), name + ' missing ' + expected);

  const decision = harness.checkToolSafety(name, { content: 'isolated test fixture' });
  assert.equal(decision.passed, false, name + ' must be denied');
  assert.match(decision.reason, /explicit human approval/i);
  console.log('MIRA_HFM_' + name.toUpperCase() + '_RUNTIME_POLICY_DENIAL=PASS');
}

const unknown = harness.checkToolSafety('unregistered_persistent_writer', {});
assert.equal(unknown.passed, false, 'unknown tools must fail closed');
console.log('MIRA_HFM_UNKNOWN_TOOL_POLICY_DENIAL=PASS');
console.log('MIRA_HFM_PERSISTENT_WRITE_AUTONOMOUS_EXECUTION=DENIED');
console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
console.log('NETWORK_REQUESTS=0');
console.log('EXTERNAL_ACTIONS=0');
console.log('TESTS_FAILED=0');
