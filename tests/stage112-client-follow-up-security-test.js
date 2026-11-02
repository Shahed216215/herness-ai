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

const project = {
  projectId: 'security-project',
  clientId: 'security-client',
  status: 'completed',
  title: 'Security Project'
};

const profile = {
  id: 'security-client',
  name: 'Security Client',
  status: 'active',
  communication: {
    contactAllowed: true
  }
};

const base = {
  project,
  clientProfile: profile,
  now: '2026-10-08T12:00:00.000Z',
  cooldownMs: 7 * 24 * 60 * 60 * 1000,
  maxFollowUps: 3
};

const first =
  engine.processClientFollowUp({
    ...base,
    id: 'security-followup-1'
  });

assert.strictEqual(
  first.ok,
  true
);

const cooldown =
  engine.evaluateFollowUpEligibility({
    ...base,
    now: '2026-10-09T12:00:00.000Z'
  });

assert.strictEqual(
  cooldown.eligible,
  false
);

assert.strictEqual(
  cooldown.status,
  'cooldown'
);

const notComplete =
  engine.evaluateFollowUpEligibility({
    ...base,
    project: {
      ...project,
      status: 'in_progress'
    }
  });

assert.strictEqual(
  notComplete.eligible,
  false
);

assert.strictEqual(
  notComplete.reason,
  'PROJECT_NOT_COMPLETE'
);

const blocked =
  engine.evaluateFollowUpEligibility({
    ...base,
    now: '2026-10-20T12:00:00.000Z',
    clientProfile: {
      ...profile,
      status: 'blocked'
    }
  });

assert.strictEqual(
  blocked.eligible,
  false
);

assert.strictEqual(
  blocked.reason,
  'CLIENT_BLOCKED'
);

const dnc =
  engine.evaluateFollowUpEligibility({
    ...base,
    now: '2026-10-20T12:00:00.000Z',
    clientProfile: {
      ...profile,
      communication: {
        contactAllowed: false
      }
    }
  });

assert.strictEqual(
  dnc.eligible,
  false
);

assert.strictEqual(
  dnc.reason,
  'CLIENT_BLOCKED'
);

const persisted =
  store.get('security-followup-1');

assert(persisted);

assert.strictEqual(
  persisted.attemptCount,
  0
);

assert(
  persisted.messageHash
);

assert.strictEqual(
  persisted.message.includes('Security Client'),
  true
);

console.log(
  'PASS: cooldown protection'
);

console.log(
  'PASS: incomplete-project blocking'
);

console.log(
  'PASS: blocked-client protection'
);

console.log(
  'PASS: do-not-contact protection'
);

console.log(
  'PASS: restart-safe persisted state'
);

console.log(
  'STAGE112_CLIENT_FOLLOW_UP_SECURITY_TEST: PASS'
);
