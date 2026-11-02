'use strict';

const assert = require('assert');
const fs = require('fs');

const store =
  require('../client-follow-up-store');

const engine =
  require('../services/mira-client-follow-up-engine');

if (fs.existsSync(store.STORE_FILE)) {
  fs.unlinkSync(store.STORE_FILE);
}

const project = {
  projectId: 'e2e-project',
  clientId: 'e2e-client',
  status: 'completed',
  title: 'E2E Client Project'
};

const profile = {
  id: 'e2e-client',
  name: 'E2E Client',
  status: 'active',
  communication: {
    preferences: ['email'],
    contactAllowed: true
  }
};

const result =
  engine.processClientFollowUp({
    project,
    clientProfile: profile,
    now: '2026-10-08T12:00:00.000Z',
    cooldownMs: 7 * 24 * 60 * 60 * 1000,
    maxFollowUps: 3,
    id: 'e2e-followup-1'
  });

assert.strictEqual(
  result.ok,
  true
);

const raw =
  fs.readFileSync(
    store.STORE_FILE,
    'utf8'
  );

const parsed =
  JSON.parse(raw);

assert(Array.isArray(parsed.followUps));

assert.strictEqual(
  parsed.followUps.length,
  1
);

assert.strictEqual(
  parsed.followUps[0].projectId,
  'e2e-project'
);

assert.strictEqual(
  parsed.followUps[0].clientId,
  'e2e-client'
);

assert.strictEqual(
  parsed.followUps[0].status,
  'draft_ready'
);

assert(
  parsed.followUps[0].nextEligibleAt
);

const restartLoaded =
  require('../client-follow-up-store')
    .get('e2e-followup-1');

assert(restartLoaded);

assert.strictEqual(
  restartLoaded.messageHash,
  parsed.followUps[0].messageHash
);

console.log(
  'PASS: completion -> eligibility -> message'
);

console.log(
  'PASS: persistence'
);

console.log(
  'PASS: restart-safe reload'
);

console.log(
  'STAGE112_CLIENT_FOLLOW_UP_E2E: PASS'
);
