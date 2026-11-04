'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const policySource = fs.readFileSync(path.join(root, 'services', 'mira-tool-execution-policy.js'), 'utf8');
const policySandbox = { module: { exports: {} } };
vm.runInNewContext(policySource, policySandbox, { filename: 'mira-tool-execution-policy.js' });
const policyModule = policySandbox.module.exports;

const cases = [
  {
    name: 'memory_save',
    file: 'memory-save.js',
    dependency: '../memory',
    dependencyExports: { addMemory: () => { throw new Error('PERSISTENT_WRITER_WAS_CALLED'); } },
    args: { content: 'isolated fixture' }
  },
  {
    name: 'knowledge_save',
    file: 'knowledge-save.js',
    dependency: '../knowledge',
    dependencyExports: { addKnowledge: async () => { throw new Error('PERSISTENT_WRITER_WAS_CALLED'); } },
    args: { title: 'fixture', url: 'https://example.invalid', content: 'isolated fixture' }
  },
  {
    name: 'learning_save',
    file: 'learning-save.js',
    dependency: '../services/learning',
    dependencyExports: { learnFromContent: async () => { throw new Error('PERSISTENT_WRITER_WAS_CALLED'); } },
    args: { content: 'isolated fixture' }
  }
];

(async () => {
  for (const item of cases) {
    const source = fs.readFileSync(path.join(root, 'tools', item.file), 'utf8');
    const calls = { writer: 0 };
    const dependencyExports = Object.fromEntries(
      Object.entries(item.dependencyExports).map(([key]) => [
        key,
        (...args) => {
          calls.writer += 1;
          throw new Error('PERSISTENT_WRITER_WAS_CALLED');
        }
      ])
    );

    const sandbox = {
      module: { exports: {} },
      require(request) {
        if (request === item.dependency) return dependencyExports;
        if (request === '../services/mira-tool-execution-policy') return policyModule;
        throw new Error('UNEXPECTED_REQUIRE:' + request);
      },
      JSON
    };

    vm.runInNewContext(source, sandbox, { filename: item.file });
    const resultText = await sandbox.module.exports.execute(item.args);
    const result = typeof resultText === 'string' ? JSON.parse(resultText) : resultText;

    assert.equal(result.success, false, item.name + ' must be denied');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.code, 'TOOL_POLICY_DENIED');
    assert.match(result.reason, /explicit human approval/i);
    assert.equal(calls.writer, 0, item.name + ' persistence dependency must not run');
    console.log('MIRA_HFM_' + item.name.toUpperCase() + '_DIRECT_WRAPPER_DENIED=PASS');
  }

  console.log('MIRA_HFM_PERSISTENT_WRAPPER_INVOCATIONS=0');
  console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('EXTERNAL_ACTIONS=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
