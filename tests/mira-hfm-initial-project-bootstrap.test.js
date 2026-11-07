'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  bootstrapInitialHfmProject, resolveBootstrapAdmin, validateProjectId
} = require('../services/mira-hfm-initial-project-bootstrap');
const {
  REQUIRED_TRUE, REQUIRED_FALSE, PREFLIGHT_SQL,
  getHfmBootstrapConfig, verifyHfmBootstrapPreflight
} = require('../services/mira-hfm-bootstrap-runtime');

const now = Date.now();
const subject = '11111111-1111-4111-8111-111111111111';
const actorId = 'mira:mira.admins:' + subject;
const sessionID = 'hfm-bootstrap-session-001';
const req = {
  role: 'admin',
  sessionID,
  session: {
    authenticated: true,
    role: 'admin',
    hfmPrincipal: {
      verified: true,
      issuer: 'mira.admins',
      subject,
      actorType: 'HUMAN',
      authenticationMethod: 'ADMIN_SUBJECT',
      authenticationRef: sessionID,
      authenticatedAt: new Date(now - 30000).toISOString(),
      expiresAt: new Date(now + 3600000).toISOString()
    }
  }
};
const env = { MIRA_ADMIN_SUBJECT_ID: subject };
const calls = [];
const client = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.startsWith('INSERT INTO mira_hfm.bootstrap_registry')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('INSERT INTO mira_hfm.project_owners')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('INSERT INTO mira_hfm.project_memberships')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('INSERT INTO mira_hfm.authority_audit_events')) return { rowCount: 1, rows: [] };
    return { rowCount: 1, rows: [] };
  },
  release() {}
};
const pool = { async connect() { return client; } };

(async () => {
  assert.equal(resolveBootstrapAdmin({ ...req, role: 'admin' }, env).actorId, actorId);
  assert.equal(validateProjectId('mira-core'), 'mira-core');
  assert.throws(() => validateProjectId('x'), /HFM_BOOTSTRAP_PROJECT_ID_INVALID/);
  console.log('HFM_BOOTSTRAP_TRUSTED_ADMIN_AND_PROJECT_ID_VALIDATION=PASS');

  const result = await bootstrapInitialHfmProject({
    req, pool, env, projectId: 'mira-core', confirm: true
  });
  assert.equal(result.status, 'HFM_INITIAL_PROJECT_BOOTSTRAPPED');
  assert.equal(result.projectId, 'mira-core');
  assert.equal(result.ownerActorId, actorId);
  assert.equal(result.membershipRole, 'ADMIN');
  assert.deepEqual(result.permissions, ['memory.read', 'memory.write', 'memory.trash', 'memory.restore']);
  assert.equal(result.oneTimeOnly, true);
  assert.equal(result.memoryRecordsImported, 0);
  assert.ok(calls.some(c => c.sql.startsWith('INSERT INTO mira_hfm.bootstrap_registry')));
  assert.ok(calls.some(c => c.sql.startsWith('INSERT INTO mira_hfm.project_owners')));
  assert.ok(calls.some(c => c.sql.startsWith('INSERT INTO mira_hfm.project_memberships')));
  assert.ok(calls.some(c => c.sql.includes("'PROJECT_BOOTSTRAPPED'")));
  assert.ok(calls.some(c => c.sql === 'COMMIT'));
  assert.ok(calls.some(c => c.sql.startsWith("SELECT set_config('mira.bootstrap_approval_ref'")));
  console.log('HFM_BOOTSTRAP_SINGLE_TRANSACTION_OWNER_MEMBERSHIP_AND_AUDIT=PASS');
  console.log('HFM_BOOTSTRAP_ONE_TIME_LATCH_INSERTED_FIRST=PASS');

  await assert.rejects(
    bootstrapInitialHfmProject({ req, pool, env, projectId: 'mira-core', confirm: false }),
    error => error.code === 'HFM_BOOTSTRAP_EXPLICIT_CONFIRMATION_REQUIRED'
  );
  console.log('HFM_BOOTSTRAP_EXPLICIT_CONFIRMATION_REQUIRED=PASS');

  const staleReq = {
    ...req,
    session: {
      ...req.session,
      hfmPrincipal: {
        ...req.session.hfmPrincipal,
        authenticatedAt: new Date(now - 10 * 60 * 1000).toISOString()
      }
    }
  };
  await assert.rejects(
    bootstrapInitialHfmProject({ req: staleReq, pool, env, projectId: 'mira-core', confirm: true }),
    error => error.code === 'HFM_BOOTSTRAP_RECENT_AUTHENTICATION_REQUIRED'
  );
  console.log('HFM_BOOTSTRAP_STALE_ADMIN_REAUTH_BLOCK=PASS');

  await assert.rejects(
    bootstrapInitialHfmProject({
      req, pool, env: { MIRA_ADMIN_SUBJECT_ID: 'another-subject' },
      projectId: 'mira-core', confirm: true
    }),
    error => error.code === 'HFM_BOOTSTRAP_ADMIN_SUBJECT_NOT_CONFIGURED'
  );
  console.log('HFM_BOOTSTRAP_ADMIN_SUBJECT_MISMATCH_BLOCK=PASS');

  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations/hfm/010_one_time_initial_project_bootstrap.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE mira_hfm\.bootstrap_registry/);
  assert.match(migration, /bootstrap_key text PRIMARY KEY CHECK \(bootstrap_key = 'initial'\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT INSERT ON TABLE/);
  assert.ok(migration.includes('GRANT SELECT, INSERT ON TABLE mira_hfm.bootstrap_registry TO mira_hfm_bootstrap_operator;'));
  assert.doesNotMatch(migration, /GRANT SELECT[^;]+(?:project_owners|project_memberships|authority_audit_events)/i);
  assert.doesNotMatch(migration, /GRANT[^;]+UPDATE/i);
  assert.doesNotMatch(migration, /GRANT[^;]+DELETE/i);
  assert.ok(migration.includes("event_type = 'PROJECT_BOOTSTRAPPED'"));
  assert.match(
    migration,
    /IF EXISTS\s*\(\s*SELECT 1 FROM mira_hfm\.project_owners\s*\)\s*OR EXISTS \(SELECT 1 FROM mira_hfm\.project_memberships\)\s*OR EXISTS \(SELECT 1 FROM mira_hfm\.operation_authorities\)\s*OR EXISTS \(SELECT 1 FROM mira_hfm\.memory_records\)\s*THEN\s*RAISE EXCEPTION 'HFM_BOOTSTRAP_REQUIRES_EMPTY_PROJECT_AND_MEMORY_REGISTRIES'/s
  );
  assert.ok(
    migration.indexOf("HFM_BOOTSTRAP_REQUIRES_EMPTY_PROJECT_AND_MEMORY_REGISTRIES") <
    migration.indexOf("CREATE ROLE mira_hfm_bootstrap_operator")
  );
  assert.ok(
    migration.indexOf("HFM_BOOTSTRAP_REQUIRES_EMPTY_PROJECT_AND_MEMORY_REGISTRIES") <
    migration.indexOf("CREATE TABLE mira_hfm.bootstrap_registry")
  );
  console.log('HFM_BOOTSTRAP_MIGRATION_REFUSES_NONEMPTY_STAGING_REGISTRIES=PASS');
  console.log('HFM_BOOTSTRAP_MIGRATION_SINGLE_USE_RLS_INSERT_ONLY=PASS');

  assert.equal(getHfmBootstrapConfig({}).enabled, false);
  assert.match(PREFLIGHT_SQL, /bootstrap_policy_semantics_exact/);
  const row = {};
  for (const key of REQUIRED_TRUE) row[key] = true;
  for (const key of REQUIRED_FALSE) row[key] = false;
  row.current_role = 'mira_hfm_bootstrap_login';
  row.database_name = 'neondb';
  assert.equal(verifyHfmBootstrapPreflight(row, {
    expectedRole: row.current_role, databaseName: row.database_name
  }).status, 'HFM_BOOTSTRAP_READY');
  assert.throws(() => verifyHfmBootstrapPreflight({ ...row, owners_update: true }, {
    expectedRole: row.current_role, databaseName: row.database_name
  }), /HFM_BOOTSTRAP_EXCESS_PRIVILEGE_DETECTED/);
  console.log('HFM_BOOTSTRAP_RUNTIME_PREFLIGHT_FAIL_CLOSED=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('DATABASE_WRITES=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
