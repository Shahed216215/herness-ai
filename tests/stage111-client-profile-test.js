'use strict';

const assert = require('assert');
const fs = require('fs');

const store = require('../client-profile-store');
const service = require('../services/client-profile-service');

function reset() {
  if (fs.existsSync(store.STORE_FILE)) {
    fs.unlinkSync(store.STORE_FILE);
  }
  store.ensureStore();
}

reset();

const id = `stage111-${Date.now()}`;

const created = service.createClientProfile({
  id,
  name: 'Test Client',
  requirements: [
    { id: 'r1', text: 'Build website' }
  ],
  communication: {
    preferences: ['email'],
    notes: ['Weekly update']
  },
  previousWork: [
    { id: 'w1', title: 'Previous website' }
  ],
  feedback: [
    { id: 'f1', rating: 5, text: 'Good work' }
  ],
  scope: {
    included: ['frontend'],
    excluded: ['hosting'],
    constraints: ['deadline']
  },
  activeProjects: [
    { id: 'p1', title: 'Current project' }
  ],
  completedProjects: [
    { id: 'p0', title: 'Old project' }
  ]
});

assert.strictEqual(created.id, id);
assert.strictEqual(created.requirements.length, 1);
assert.strictEqual(created.communication.preferences[0], 'email');
assert.strictEqual(created.scope.excluded[0], 'hosting');
assert.strictEqual(created.activeProjects[0].id, 'p1');
assert.strictEqual(created.completedProjects[0].id, 'p0');

service.addRequirement(id, { id: 'r2', text: 'Add contact form' });
service.addCommunicationNote(id, 'Client prefers concise updates.');
service.addFeedback(id, { id: 'f2', text: 'Revision requested' });
service.addPreviousWork(id, { id: 'w2', title: 'Logo work' });

const linked = service.linkProject(
  id,
  { id: 'p2', title: 'Second project' },
  'active'
);

assert(linked.activeProjects.some(item => item.id === 'p2'));

const completed = service.linkProject(
  id,
  { id: 'p2', title: 'Second project', result: 'delivered' },
  'completed'
);

assert(!completed.activeProjects.some(item => item.id === 'p2'));
assert(completed.completedProjects.some(item => item.id === 'p2'));

const fetched = service.getClientProfile(id);
assert(fetched);
assert.strictEqual(fetched.id, id);
assert(fetched.updatedAt);

const list = service.listClientProfiles();
assert(list.some(item => item.id === id));

console.log('STAGE111_CLIENT_PROFILE_TEST: PASS');
