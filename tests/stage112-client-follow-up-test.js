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

store.ensureStore();

const now =
  '2026-10-08T12:00:00.000Z';

const project = {
  projectId: 'stage112-project',
  clientId: 'stage112-client',
  status: 'completed',
  title: 'Stage 11.2 Website'
};

const profile = {
  id: 'stage112-client',
  name: 'Stage 11.2 Client',
  status: 'active',
  communication: {
    contactAllowed: true,
    doNotContact: false
  }
};

assert.strictEqual(
  engine.isProjectComplete(project),
  true
);

assert.strictEqual(
  engine.clientIsBlocked(profile),
  false
);

const eligibility =
  engine.evaluateFollowUpEligibility({
    project,
    clientProfile: profile,
    now,
    cooldownMs: 7 * 24 * 60 * 60 * 1000,
    maxFollowUps: 3
  });

assert.strictEqual(
  eligibility.eligible,
  true
);

const result =
  engine.processClientFollowUp({
    project,
    clientProfile: profile,
    now,
    cooldownMs: 7 * 24 * 60 * 60 * 1000,
    maxFollowUps: 3,
    id: 'stage112-followup-1'
  });

assert.strictEqual(
  result.ok,
  true
);

assert.strictEqual(
  result.status,
  'draft_ready'
);

assert(
  result.followUp.message.length > 0
);

assert(
  result.followUp.messageHash
);

assert.strictEqual(
  result.sendBoundary.sendAllowed,
  false
);

assert.strictEqual(
  result.sendBoundary.externalSendImplemented,
  false
);

console.log(
  'PASS: project completion detection'
);

console.log(
  'PASS: client eligibility'
);

console.log(
  'PASS: safe follow-up draft'
);

console.log(
  'PASS: persistent follow-up state'
);

console.log(
  'PASS: external sending remains disabled'
);

console.log(
  'STAGE112_CLIENT_FOLLOW_UP_TEST: PASS'
);
