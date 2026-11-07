'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const register = require('../routes/mira-hfm-daily-knowledge');

test('daily draft identity is deterministic and scoped to project plus local date', () => {
  const first = register.dailyRecordId('hfm_0123456789abcdef0123456789abcdef', '2026-11-07');
  const second = register.dailyRecordId('hfm_0123456789abcdef0123456789abcdef', '2026-11-07');
  const otherDay = register.dailyRecordId('hfm_0123456789abcdef0123456789abcdef', '2026-11-08');
  const otherProject = register.dailyRecordId('hfm_1123456789abcdef0123456789abcdef', '2026-11-07');
  assert.equal(first, second);
  assert.notEqual(first, otherDay);
  assert.notEqual(first, otherProject);
  assert.match(first, /^daily-post-[0-9a-f]{32}$/);
});

test('daily generation uses only the server active project when no project is supplied', () => {
  assert.equal(register.projectFor({}, {}, { activeProjectId: 'hfm_0123456789abcdef0123456789abcdef' }), 'hfm_0123456789abcdef0123456789abcdef');
  assert.throws(() => register.projectFor({}, {}, { activeProjectId: null }), /HFM_ACTIVE_PROJECT_REQUIRED/);
  assert.throws(() => register.projectFor({}, { projectId: 'other-project' }, { activeProjectId: null }), /HFM_ACTIVE_PROJECT_REQUIRED/);
});

test('daily generation endpoint is authenticated, authority-gated, private-only and never auto-publishes', () => {
  const routes = [];
  const app = { post: (path, ...handlers) => routes.push({ path, handlers }) };
  const auth = (_req, _res, next) => next();
  register(app, auth);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, '/api/hfm/daily-knowledge/generate');
  assert.equal(routes[0].handlers[0], auth);
  const source = fs.readFileSync(require.resolve('../routes/mira-hfm-daily-knowledge'), 'utf8');
  assert.match(source, /executeWithConsumedAuthority/);
  assert.match(source, /saveDailyKnowledgePost/);
  assert.match(source, /classification = 'PROJECT_PRIVATE'/);
  assert.match(source, /record_type IN \('daily_activity','learning_note'\)/);
  assert.doesNotMatch(source, /graph\.facebook\.com|access_token|facebook\.com\/login/i);
});

