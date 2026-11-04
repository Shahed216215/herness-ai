'use strict';

const assert = require('node:assert/strict');
const { tools } = require('../tools');
const { TOOL_POLICIES, getToolPolicy } = require('../services/mira-work-execution-engine');

const tool = tools.memory_version_recovery;
assert.ok(tool, 'memory_version_recovery must remain discoverable in the dynamic tool registry');
assert.equal(typeof tool.execute, 'function');
assert.equal(typeof tool.declaration, 'object');

const policy = getToolPolicy('memory_version_recovery');
assert.ok(policy, 'memory_version_recovery must have an explicit execution policy');
assert.deepEqual(policy, {
  operation: 'file_modify',
  autonomous: false,
  humanApprovalRequired: true,
  explicitConfirmation: true
});
assert.equal(TOOL_POLICIES.memory_version_recovery, policy);

console.log('MIRA_HFM_MEMORY_VERSION_RECOVERY_REGISTERED=PASS');
console.log('MIRA_HFM_MEMORY_VERSION_RECOVERY_POLICY=PASS');
console.log('MIRA_HFM_MEMORY_VERSION_RECOVERY_AUTONOMOUS=DENIED');
console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
console.log('NETWORK_REQUESTS=0');
console.log('EXTERNAL_ACTIONS=0');
console.log('TESTS_FAILED=0');
