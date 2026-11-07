'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const originalRouter = express.Router;
const registrations = [];
const router = {
  use(...handlers) { registrations.push({ type: 'use', handlers }); },
  get(routePath, ...handlers) { registrations.push({ type: 'get', routePath, handlers }); }
};
express.Router = () => router;
const registerLearningHistoryRoutes = require('../routes/learning-history');

const app = { use() {} };
try {
  registerLearningHistoryRoutes(app, () => (_req, _res, next) => next(), {
    SYSTEM_ADMIN: 'SYSTEM_ADMIN'
  });
} finally {
  express.Router = originalRouter;
}
const guardRegistration = registrations.find(item =>
  item.type === 'use' && typeof item.handlers[0] === 'function'
);
assert.ok(guardRegistration, 'global legacy history guard must be registered');
assert.ok(registrations.findIndex(item => item === guardRegistration) <
  registrations.findIndex(item => item.type === 'get'),
  'guard must precede every local history route');

const guard = guardRegistration.handlers[0];
const flags = [
  'MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED',
  'MIRA_HFM_WORK_LEARNING_ENABLED',
  'MIRA_HFM_MEMORY_READ_ENABLED',
  'MIRA_HFM_MEMORY_WRITE_ENABLED'
];
for (const flag of flags) {
  const previous = process.env[flag];
  process.env[flag] = 'true';
  let nextCalled = false;
  let statusCode;
  let responseBody;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; }
  };
  guard({}, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false, flag + ' must block local history');
  assert.equal(statusCode, 403);
  assert.equal(responseBody.code, 'HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_LEARNING_HISTORY');
  if (previous === undefined) delete process.env[flag];
  else process.env[flag] = previous;
}
console.log('HFM_ALL_MODES_BLOCK_LEGACY_LOCAL_LEARNING_HISTORY=PASS');

const previousValues = Object.fromEntries(flags.map(flag => [flag, process.env[flag]]));
for (const flag of flags) delete process.env[flag];
let allowedNext = false;
guard({}, { status() { throw new Error('unexpected block'); } }, () => { allowedNext = true; });
assert.equal(allowedNext, true);
for (const flag of flags) {
  if (previousValues[flag] === undefined) delete process.env[flag];
  else process.env[flag] = previousValues[flag];
}
console.log('LEGACY_LEARNING_HISTORY_UNCHANGED_OUTSIDE_HFM_MODE=PASS');
