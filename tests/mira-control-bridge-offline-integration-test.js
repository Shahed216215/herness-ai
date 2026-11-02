'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const source = fs.readFileSync('scripts/mira-control-agent.js', 'utf8');
const configPath = path.join(
  process.env.HOME || '',
  '.config', 'mira-control-agent', 'allowed-submitter'
);

const allowed = fs.readFileSync(configPath, 'utf8').trim();
assert.match(allowed, /^[A-Za-z0-9-]{1,39}$/,
  'Configured authorized username must be valid');

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);

  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  assert.notEqual(end, -1, `${name} boundary must exist`);

  return source.slice(start, end);
}

const prefix = 'MIRA_CONTROL_TASK_V1\n';
const safeTaskSource = extractFunction('safeTask', 'issueComments');
const safeTask = new Function('TASK_PREFIX',
  `${safeTaskSource}\nreturn safeTask;`)(prefix);

const bridgeSource = extractFunction('bridgeOnce', 'main');

function runCase(issue) {
  const commentsPosted = [];
  const output = [];
  const state = {};

  function mockRun(bin, args) {
    assert.equal(bin, 'gh', 'Unexpected executable');
    assert.ok(Array.isArray(args), 'Arguments must be an array');

    if (args[0] === 'auth' && args[1] === 'status') return '';

    if (args[0] === 'issue' && args[1] === 'list') {
      assert.ok(args.some(value => typeof value === 'string' && value.includes('author')),
        'Issue listing must request author data');
      return JSON.stringify([issue]);
    }

    if (args[0] === 'issue' && args[1] === 'comment') {
      commentsPosted.push(args.slice());
      return '';
    }

    throw new Error('Unexpected mocked command: ' + args.join(' '));
  }

  const mockConsole = {
    log: (...args) => output.push(args.join(' '))
  };

  const bridgeOnce = new Function(
    'run', 'fs', 'path', 'HOME_STATE', 'REPO',
    'loadState', 'saveState', 'issueComments',
    'safeTask', 'crypto', 'gitStatus', 'inventory', 'console',
    'MAX_COMMENT',
    `${bridgeSource}\nreturn bridgeOnce;`
  )(
    mockRun,
    fs,
    path,
    path.dirname(configPath),
    'offline-test/repository',
    () => state,
    value => Object.assign(state, value),
    () => [],
    safeTask,
    crypto,
    () => 'MOCK_GIT_STATUS',
    () => 'MOCK_INVENTORY',
    mockConsole,
    4500
  );

  bridgeOnce();

  return { commentsPosted, output };
}

const validBody = prefix + JSON.stringify({
  task_id: 'offline_integration_01',
  action: 'status'
});

const cases = [
  {
    name: 'authorized author with valid task posts only mocked comment',
    issue: {
      number: 901001,
      body: validBody,
      labels: [{ name: 'mira-control-task' }],
      author: { login: allowed }
    },
    expectedComments: 1
  },
  {
    name: 'unauthorized author is ignored',
    issue: {
      number: 901002,
      body: validBody,
      labels: [{ name: 'mira-control-task' }],
      author: { login: '__unauthorized_offline_test__' }
    },
    expectedComments: 0
  },
  {
    name: 'missing author is ignored',
    issue: {
      number: 901003,
      body: validBody,
      labels: [{ name: 'mira-control-task' }]
    },
    expectedComments: 0
  },
  {
    name: 'unknown command field is rejected',
    issue: {
      number: 901004,
      body: prefix + JSON.stringify({
        task_id: 'offline_bad_command',
        action: 'status',
        command: 'touch SHOULD_NOT_EXIST'
      }),
      labels: [{ name: 'mira-control-task' }],
      author: { login: allowed }
    },
    expectedComments: 0
  },
  {
    name: 'unknown metadata field is rejected',
    issue: {
      number: 901005,
      body: prefix + JSON.stringify({
        task_id: 'offline_bad_metadata',
        action: 'inventory',
        metadata: { source: 'untrusted' }
      }),
      labels: [{ name: 'mira-control-task' }],
      author: { login: allowed }
    },
    expectedComments: 0
  }
];

let failures = 0;

for (const test of cases) {
  try {
    const result = runCase(test.issue);
    assert.equal(result.commentsPosted.length, test.expectedComments);
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${test.name}: ${error.message}`);
  }
}

console.log(`CASES=${cases.length}`);
console.log(`FAILED=${failures}`);
console.log('REAL_GITHUB_REQUESTS=0');
console.log('REAL_COMMENTS_POSTED=0');
console.log('LIVE_BRIDGE=NOT_RUN');

if (failures) process.exitCode = 1;
