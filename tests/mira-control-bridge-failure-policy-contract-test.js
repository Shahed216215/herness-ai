'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const source = fs.readFileSync('scripts/mira-control-agent.js', 'utf8');

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  assert.notEqual(end, -1, `Missing boundary ${nextName}`);
  return source.slice(start, end);
}

const prefix = 'MIRA_CONTROL_TASK_V1\n';
const configPath = path.join(
  process.env.HOME || '',
  '.config', 'mira-control-agent', 'allowed-submitter'
);
const allowed = fs.readFileSync(configPath, 'utf8').trim();
assert.match(allowed, /^[A-Za-z0-9-]{1,39}$/);

const safeTask = new Function(
  'TASK_PREFIX',
  `${extractFunction('safeTask', 'issueComments')}\nreturn safeTask;`
)(prefix);

const bridgeSource = extractFunction('bridgeOnce', 'main');
const body = prefix + JSON.stringify({
  task_id: 'failure_policy_01',
  action: 'status'
});

function simulate({ actionFails = false, commentFails = false } = {}) {
  const state = {};
  const comments = [];
  const logs = [];
  const digest = crypto.createHash('sha256')
    .update('990201:' + body).digest('hex').slice(0, 24);

  function mockRun(bin, args) {
    assert.equal(bin, 'gh');
    if (args[0] === 'auth' && args[1] === 'status') return '';
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{
        number: 990201,
        body,
        labels: [{ name: 'mira-control-task' }],
        author: { login: allowed }
      }]);
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      return JSON.stringify({ comments: [] });
    }
    if (args[0] === 'issue' && args[1] === 'comment') {
      if (commentFails) throw new Error('MOCK_COMMENT_FAILURE');
      comments.push(args[args.indexOf('--body') + 1]);
      return '';
    }
    throw new Error('UNEXPECTED_MOCK_COMMAND');
  }

  const bridge = new Function(
    'run', 'fs', 'path', 'HOME_STATE', 'REPO',
    'loadState', 'saveState', 'issueComments',
    'safeTask', 'crypto', 'gitStatus', 'inventory', 'console',
    'MAX_COMMENT',
    `${bridgeSource}\nreturn bridgeOnce;`
  )(
    mockRun, fs, path, path.dirname(configPath), 'offline/test',
    () => ({ ...state }),
    next => Object.assign(state, next),
    () => [],
    safeTask, crypto,
    () => {
      if (actionFails) throw new Error('COMMAND_FAILED');
      return 'MOCK_STATUS_OK';
    },
    () => 'MOCK_INVENTORY_OK',
    { log: (...a) => logs.push(a.join(' ')) },
    4500
  );

  let error = null;
  try { bridge(); } catch (e) { error = String(e.message || e); }
  return { state, comments, logs, error, digest };
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

check('successful action is commented and marked done', () => {
  const r = simulate();
  assert.equal(r.error, null);
  assert.equal(r.comments.length, 1);
  assert.equal(r.state[r.digest], 'done');
  assert.equal(r.logs.some(x => x.includes('BRIDGE_CHECK=PASS')), true);
});

check('action failure is explicitly represented in the comment', () => {
  const r = simulate({ actionFails: true });
  assert.equal(r.error, null);
  assert.equal(r.comments.length, 1);
  assert.match(r.comments[0], /TASK_FAILED=ACTION_FAILED/);
});

check('failed action is recorded as failed, not done', () => {
  const r = simulate({ actionFails: true });
  assert.equal(r.error, null);
  assert.equal(r.comments.length, 1);
  assert.match(r.comments[0], /TASK_FAILED=ACTION_FAILED/);
  assert.equal(r.state[r.digest], 'failed');
});

check('failed action must NOT report bridge success', () => {
  const r = simulate({ actionFails: true });
  assert.equal(r.logs.some(x => x.includes('BRIDGE_CHECK=PASS')), false);
});

check('comment failure is not marked done', () => {
  const r = simulate({ commentFails: true });
  assert.match(r.error || '', /MOCK_COMMENT_FAILURE/);
  assert.equal(r.state[r.digest], undefined);
  assert.equal(r.logs.some(x => x.includes('BRIDGE_CHECK=PASS')), false);
});

console.log(`CASES=4`);
console.log(`FAILED=${failed}`);
console.log('NETWORK_REQUESTS=0');
console.log('LIVE_GITHUB_BRIDGE=NOT_RUN');
console.log('REAL_COMMENTS_POSTED=0');
console.log('SOURCE_PATCHED=NO');
console.log('POLICY=FAILED_ACTION_NOT_DONE');
if (failed) process.exitCode = 1;
