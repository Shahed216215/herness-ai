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
    dependencies: { '../memory': { addMemory: true } },
    args: { content: 'isolated fixture' }
  },
  {
    name: 'knowledge_save',
    file: 'knowledge-save.js',
    dependencies: { '../knowledge': { addKnowledge: true } },
    args: { title: 'fixture', url: 'https://example.invalid', content: 'isolated fixture' }
  },
  {
    name: 'learning_save',
    file: 'learning-save.js',
    dependencies: { '../services/learning': { learnFromContent: true } },
    args: { content: 'isolated fixture' }
  },
  {
    name: 'firewall_defense',
    file: 'firewall-defense.js',
    dependencies: { '../firewall-defense': {
      getStatus: true, setEnabled: true, createInspection: true,
      createProposal: true, decideProposal: true, clearPendingProposal: true
    } },
    args: { action: 'enable' }
  },
  {
    name: 'memory_restore',
    file: 'memory-restore.js',
    dependencies: { '../services/mira-local-memory-store': { restoreMemory: true } },
    args: { confirm: true }
  },
  {
    name: 'memory_version_recovery',
    file: 'memory-version-recovery.js',
    dependencies: { '../services/mira-state-version-recovery': {
      listVersions: true, verifyVersion: true, restoreVersion: true
    } },
    args: { action: 'restore', target: 'memory', versionFile: 'fixture', confirm: true }
  },
  {
    name: 'knowledge_cleanup',
    file: 'knowledge-cleanup.js',
    dependencies: {
      '../knowledge': { getKnowledge: true, replaceKnowledge: true },
      '../google-drive': { saveKnowledgeToDrive: true },
      '../services/mira-knowledge-duplicate-assessment': {
        findDuplicateGroups: true, removeExactDuplicateCopies: true
      }
    },
    args: { action: 'remove' }
  },
];

(async () => {
  for (const item of cases) {
    const source = fs.readFileSync(path.join(root, 'tools', item.file), 'utf8');
    const calls = { writer: 0 };
    const dependencyExports = Object.fromEntries(
      Object.entries(item.dependencies).map(([request, methods]) => [
        request,
        Object.fromEntries(Object.keys(methods).map(key => [
          key,
          (...args) => {
            calls.writer += 1;
            throw new Error('PERSISTENT_WRITER_WAS_CALLED');
          }
        ]))
      ])
    );

    const sandbox = {
      module: { exports: {} },
      require(request) {
        if (Object.prototype.hasOwnProperty.call(dependencyExports, request)) return dependencyExports[request];
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

  console.log('MIRA_HFM_HUMAN_ONLY_WRAPPER_INVOCATIONS=0');
  console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('EXTERNAL_ACTIONS=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
