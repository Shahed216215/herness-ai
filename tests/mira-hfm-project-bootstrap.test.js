'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const projects = require('../routes/mira-hfm-projects');

const principal = {
  verified: true,
  issuer: 'mira.users',
  subject: '11111111-1111-4111-8111-111111111111',
  actorType: 'HUMAN',
  authenticationMethod: 'USER_SESSION',
  authenticationRef: 'project-create-session',
  authenticatedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
};

test('project bootstrap accepts only server-generated HFM project ID format', () => {
  assert.equal(projects.validateProjectId('hfm_0123456789abcdef0123456789abcdef'), 'hfm_0123456789abcdef0123456789abcdef');
  assert.throws(() => projects.validateProjectId('project-001'), /HFM_PROJECT_ID_INVALID/);
});

test('project bootstrap binds owner and membership to the verified session principal', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM mira_hfm.project_owners')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const result = await projects.createOwnedProject({
    pool: { connect: async () => client },
    verifiedPrincipal: principal,
    projectId: 'hfm_0123456789abcdef0123456789abcdef',
    sessionId: principal.authenticationRef
  });
  assert.equal(result.status, 'CREATED');
  const ownerInsert = calls.find(x => x.sql.startsWith('INSERT INTO mira_hfm.project_owners'));
  const membershipInsert = calls.find(x => x.sql.startsWith('INSERT INTO mira_hfm.project_memberships'));
  assert.ok(ownerInsert);
  assert.ok(membershipInsert);
  assert.equal(ownerInsert.params[1], 'mira:mira.users:' + principal.subject);
  assert.equal(membershipInsert.params[2], 'mira:mira.users:' + principal.subject);
  assert.deepEqual(JSON.parse(membershipInsert.params[3]), {
    operations: ['memory.read','memory.write','memory.update','memory.trash','memory.restore']
  });
  assert.ok(calls.some(x => x.sql.includes('pg_advisory_xact_lock(74291')));
  assert.ok(calls.some(x => x.sql.startsWith('COMMIT')));
});

test('project bootstrap is idempotent for the same active owner and membership', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM mira_hfm.project_owners')) {
        return { rows: [{ owner_actor_id: 'mira:mira.users:' + principal.subject, status: 'ACTIVE', revision: 1 }] };
      }
      if (sql.includes('FROM mira_hfm.project_memberships')) {
        return { rows: [{ membership_id: 'mbr_existing', status: 'ACTIVE', permissions: { operations: ['memory.read','memory.write','memory.update','memory.trash','memory.restore'] } }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const result = await projects.createOwnedProject({
    pool: { connect: async () => client },
    verifiedPrincipal: principal,
    projectId: 'hfm_0123456789abcdef0123456789abcdef'
  });
  assert.equal(result.status, 'ALREADY_EXISTS');
  assert.ok(calls.some(sql => sql.includes('FROM mira_hfm.project_memberships')));
  assert.equal(calls.some(sql => sql.startsWith('INSERT INTO mira_hfm.project_owners')), false);
});

test('project bootstrap fails closed when another owner already holds the ID', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('FROM mira_hfm.project_owners')) {
        return { rows: [{ owner_actor_id: 'mira:mira.users:22222222-2222-4222-8222-222222222222', status: 'ACTIVE', revision: 1 }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  await assert.rejects(() => projects.createOwnedProject({
    pool: { connect: async () => client },
    verifiedPrincipal: principal,
    projectId: 'hfm_0123456789abcdef0123456789abcdef'
  }), /HFM_PROJECT_ID_ALREADY_OWNED/);
});

test('project routes are authenticated and active project is read from server session', () => {
  const routes = [];
  const app = {
    post: (path, ...handlers) => routes.push({ method: 'POST', path, handlers }),
    get: (path, ...handlers) => routes.push({ method: 'GET', path, handlers })
  };
  const auth = (_req, _res, next) => next();
  projects.registerHfmProjectRoutes(app, auth, { getPool: async () => null });
  assert.deepEqual(routes.map(x => x.path), ['/api/hfm/projects/create','/api/hfm/projects/active']);
  assert.ok(routes.every(x => x.handlers[0] === auth));
});

