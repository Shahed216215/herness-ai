'use strict';

const assert = require('assert');
const fs = require('fs');

const store = require('../client-profile-store');
const service = require('../services/client-profile-service');

if (fs.existsSync(store.STORE_FILE)) fs.unlinkSync(store.STORE_FILE);

const id = `e2e-${Date.now()}`;

const profile = service.createClientProfile({
  id,
  name: 'E2E Client',
  requirements: [
    { id: 'req-1', text: 'Landing page' }
  ],
  communication: {
    preferences: ['email'],
    notes: []
  },
  previousWork: [],
  feedback: [],
  scope: {
    included: ['landing page'],
    excluded: ['domain registration'],
    constraints: ['mobile friendly']
  },
  activeProjects: [],
  completedProjects: []
});

assert(profile);

service.addCommunicationNote(id, 'Send progress summary.');
service.addFeedback(id, {
  id: 'fb-1',
  text: 'Please improve the CTA.'
});
service.addPreviousWork(id, {
  id: 'work-1',
  title: 'Earlier landing page'
});

service.linkProject(id, {
  id: 'project-1',
  title: 'Landing Page',
  status: 'active'
});

let current = service.getClientProfile(id);

assert.strictEqual(current.activeProjects.length, 1);
assert.strictEqual(current.completedProjects.length, 0);
assert.strictEqual(current.feedback.length, 1);
assert.strictEqual(current.previousWork.length, 1);

service.linkProject(
  id,
  {
    id: 'project-1',
    title: 'Landing Page',
    status: 'completed'
  },
  'completed'
);

current = service.getClientProfile(id);

assert.strictEqual(current.activeProjects.length, 0);
assert.strictEqual(current.completedProjects.length, 1);

service.updateClientProfile(id, {
  communication: {
    preferences: ['email', 'chat'],
    notes: ['Final communication preference']
  }
});

current = service.getClientProfile(id);

assert.deepStrictEqual(
  current.communication.preferences,
  ['email', 'chat']
);

const raw = fs.readFileSync(store.STORE_FILE, 'utf8');
const parsed = JSON.parse(raw);

assert(Array.isArray(parsed.profiles));
assert(parsed.profiles.some(item => item.id === id));

console.log('STAGE111_CLIENT_PROFILE_E2E: PASS');
