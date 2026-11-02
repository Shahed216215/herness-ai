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
assert.match(allowed, /^[A-Za-z0-9-]{1,39}$/);

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  assert.notEqual(end, -1, `Missing boundary ${nextName}`);
  return source.slice(start, end);
}

const prefix = 'MIRA_CONTROL_TASK_V1\n';
const safeTaskSource = extractFunction('safeTask', 'issueComments');
const safeTask = new Function(
  'TASK_PREFIX', `${safeTaskSource}\nreturn safeTask;`
)(prefix);
const bridgeSource = extractFunction('bridgeOnce', 'main');

function makeIssue(number, body, author = allowed) {
  return {
    number,
    body,
    labels: [{ name: 'mira-control-task' }],
    author: author ? { login: author } : undefined
  };
}

const body = prefix + JSON.stringify({
  task_id: 'recovery_test_01',
  action: 'status'
});

function runBridge({
  issues,
  initialState = {},
  existingComments = {},
  failCommentFor = [],
  failSave = false
}) {
  const persistedState = { ...initialState };
  const postedComments = [];
  const savedSnapshots = [];
  const logs = [];

  function mockRun(bin, args) {
    assert.equal(bin, 'gh', 'Unexpected executable');
    assert.ok(Array.isArray(args));

    if (args[0] === 'auth' && args[1] === 'status') return '';

    if (args[0] === 'issue' && args[1] === 'list') {
      assert.ok(args.some(
        value => typeof value === 'string' && value.includes('author')
      ), 'Issue list must request author data');
      return JSON.stringify(issues);
    }

    if (args[0] === 'issue' && args[1] === 'comment') {
      const number = Number(args[2]);
      if (failCommentFor.includes(number)) {
        throw new Error('MOCK_COMMENT_FAILURE');
      }
      postedComments.push({ number, args: [...args] });
      return '';
    }

    throw new Error('Unexpected mocked command: ' + args.join(' '));
  }

  function saveState(state) {
    if (failSave) throw new Error('MOCK_STATE_SAVE_FAILURE');
    Object.assign(persistedState, state);
    savedSnapshots.push({ ...state });
  }

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
    () => ({ ...persistedState }),
    saveState,
    number => existingComments[number] || [],
    safeTask,
    crypto,
    () => 'MOCK_GIT_STATUS',
    () => 'MOCK_INVENTORY',
    { log: (...args) => logs.push(args.join(' ')) },
    4500
  );

  let error = null;
  try {
    bridgeOnce();
  } catch (e) {
    error = String(e.message || e);
  }

  return { persistedState, postedComments, savedSnapshots, logs, error };
}

const digestFor = issue => crypto.createHash('sha256')
  .update(String(issue.number) + ':' + issue.body)
  .digest('hex').slice(0, 24);

const cases = [
  {
    name: 'duplicate issue in one batch is commented once',
    run: () => {
      const issue = makeIssue(901101, body);
      const result = runBridge({ issues: [issue, issue] });
      assert.equal(result.error, null);
      assert.equal(result.postedComments.length, 1);
      assert.equal(result.logs.some(x => x.includes('TASKS_PROCESSED=1')), true);
    }
  },
  {
    name: 'same body on different issue numbers is processed separately',
    run: () => {
      const result = runBridge({
        issues: [makeIssue(901102, body), makeIssue(901103, body)]
      });
      assert.equal(result.error, null);
      assert.equal(result.postedComments.length, 2);
      assert.deepEqual(
        result.postedComments.map(x => x.number).sort(),
        [901102, 901103]
      );
    }
  },
  {
    name: 'already processed digest is not commented again',
    run: () => {
      const issue = makeIssue(901104, body);
      const result = runBridge({
        issues: [issue],
        initialState: { [digestFor(issue)]: 'done' }
      });
      assert.equal(result.error, null);
      assert.equal(result.postedComments.length, 0);
    }
  },
  {
    name: 'existing result marker prevents duplicate comment',
    run: () => {
      const issue = makeIssue(901105, body);
      const marker = `MIRA_CONTROL_RESULT:${digestFor(issue)}`;
      const result = runBridge({
        issues: [issue],
        existingComments: {
          901105: [{ body: `old text\n${marker}\nprevious result` }]
        }
      });
      assert.equal(result.error, null);
      assert.equal(result.postedComments.length, 0);
      assert.equal(result.persistedState[digestFor(issue)], 'done');
    }
  },
  {
    name: 'comment failure does not persist task as done',
    run: () => {
      const issue = makeIssue(901106, body);
      const result = runBridge({
        issues: [issue],
        failCommentFor: [901106]
      });
      assert.match(result.error || '', /MOCK_COMMENT_FAILURE/);
      assert.equal(result.persistedState[digestFor(issue)], undefined);
      assert.equal(result.savedSnapshots.length, 0);
    }
  },
  {
    name: 'state save failure is surfaced and not reported as success',
    run: () => {
      const issue = makeIssue(901107, body);
      const result = runBridge({
        issues: [issue],
        failSave: true
      });
      assert.match(result.error || '', /MOCK_STATE_SAVE_FAILURE/);
      assert.equal(result.logs.some(x => x.includes('BRIDGE_CHECK=PASS')), false);
      assert.equal(result.postedComments.length, 1);
    }
  }
];

let failed = 0;
for (const test of cases) {
  try {
    test.run();
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${test.name}: ${error.message}`);
  }
}

console.log(`CASES=${cases.length}`);
console.log(`FAILED=${failed}`);
console.log('REAL_GITHUB_REQUESTS=0');
console.log('REAL_COMMENTS_POSTED=0');
console.log('LIVE_BRIDGE=NOT_RUN');

if (failed) process.exitCode = 1;
