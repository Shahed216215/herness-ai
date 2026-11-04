'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const policySource = fs.readFileSync(path.join(root, 'services', 'mira-tool-execution-policy.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'tools', 'index.js'), 'utf8');
const runnerSource = fs.readFileSync(path.join(root, 'services', 'tool-runner.js'), 'utf8');

const policySandbox = { module: { exports: {} } };
vm.runInNewContext(policySource, policySandbox, { filename: 'mira-tool-execution-policy.js' });
const checkToolSafety = policySandbox.module.exports.checkToolSafety;
assert.equal(typeof checkToolSafety, 'function');

const executeMatch = indexSource.match(/async function executeTool\(name, args\) \{[\s\S]*?\n\}/);
assert.ok(executeMatch, 'executeTool entrypoint not found');
assert.match(indexSource, /checkToolSafety\(name, args\)/, 'registry must call shared authority policy');
assert.match(runnerSource, /return await executeTool\(name, args\)/, 'tool-runner must delegate to guarded registry entrypoint');

const calls = [];
const tools = {
  memory_save: { execute: async () => { calls.push('memory_save'); return 'WRITE_EXECUTED'; } },
  knowledge_save: { execute: async () => { calls.push('knowledge_save'); return 'WRITE_EXECUTED'; } },
  learning_save: { execute: async () => { calls.push('learning_save'); return 'WRITE_EXECUTED'; } },
  calculator: { execute: async () => { calls.push('calculator'); return 'CALCULATED'; } }
};

const executeTool = vm.runInNewContext('(' + executeMatch[0] + ')', {
  tools,
  checkToolSafety,
  JSON
});

(async () => {
  for (const name of ['memory_save', 'knowledge_save', 'learning_save']) {
    const raw = await executeTool(name, { content: 'isolated fixture' });
    const result = JSON.parse(raw);
    assert.equal(result.success, false, name + ' must be blocked at registry boundary');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.code, 'TOOL_POLICY_DENIED');
    assert.match(result.reason, /explicit human approval/i);
    assert.equal(calls.includes(name), false, name + ' wrapper must not be invoked');
    console.log('MIRA_HFM_' + name.toUpperCase() + '_REGISTRY_ENTRYPOINT_DENIED=PASS');
  }

  assert.equal(await executeTool('calculator', {}), 'CALCULATED');
  assert.equal(calls.includes('calculator'), true, 'eligible tool should remain executable');
  assert.equal(await executeTool('unknown_tool', {}), 'Tool "unknown_tool" not found.');
  console.log('MIRA_HFM_TOOL_REGISTRY_GUARD_RUNTIME=PASS');
  console.log('MIRA_HFM_RESTRICTED_WRAPPER_INVOCATIONS=0');
  console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('EXTERNAL_ACTIONS=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
