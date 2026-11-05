'use strict';

const assert = require('node:assert/strict');
const {
  createSupabaseResearchArchiveStore,
  archiveFacebookResearchEvidenceWithProvider,
  searchFacebookResearchMemoryWithProvider,
  validateConfig
} = require('../services/mira-facebook-research-memory-provider');

const pageId = '118056109579206';
const env = {
  MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND: 'supabase',
  SUPABASE_URL: 'https://fixture-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key-not-a-real-secret-000000'
};
const evidence = [{
  evidenceId: 'fbweb-fixture-001',
  pageId,
  title: 'Online canel public Page fixture ' + pageId,
  snippet: 'Synthetic offline fixture about a public Page archive.',
  sourceUrl: 'https://www.facebook.com/' + pageId,
  sourceType: 'FACEBOOK_PAGE_PROFILE',
  observedAt: '2026-11-05T00:00:00.000Z',
  publishedAt: null,
  identityBinding: 'PAGE_ID_PRESENT_IN_INDEXED_RESULT',
  trustStatus: 'SOURCE_RECORDED',
  integrityStatus: 'UNVERIFIED',
  lifecycle: 'PENDING_REVIEW'
}];

function fakeDatabase() {
  const rows = new Map();
  const calls = [];
  async function request(rawUrl, config) {
    const url = new URL(rawUrl);
    calls.push({ method: config.method, url: url.toString(), headers: config.headers });
    assert.equal(url.hostname, 'fixture-project.supabase.co');
    assert.equal(config.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(config.headers.Authorization, 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY);
    if (config.method === 'POST') {
      for (const row of config.data) if (!rows.has(row.archive_id)) rows.set(row.archive_id, { ...row, payload: JSON.parse(JSON.stringify(row.payload, Object.keys(row.payload).sort())) });
      return { status: 201, data: [] };
    }
    assert.equal(config.method, 'GET');
    const page = url.searchParams.get('page_id')?.replace(/^eq\./, '');
    const archive = url.searchParams.get('archive_id')?.replace(/^eq\./, '');
    let result = [...rows.values()].filter(row => row.page_id === page);
    if (archive) result = result.filter(row => row.archive_id === archive);
    const limit = Number(url.searchParams.get('limit') || 1000);
    return { status: 200, data: result.slice(0, limit).map(row => {
      const selected = url.searchParams.get('select') || '';
      if (selected === 'archive_id') return { archive_id: row.archive_id };
      if (selected === 'payload') return { payload: row.payload };
      return row;
    }) };
  }
  return { rows, calls, request };
}

(async () => {
  assert.equal(validateConfig(env).baseUrl, 'https://fixture-project.supabase.co');
  assert.throws(() => validateConfig({ ...env, SUPABASE_URL: 'http://fixture-project.supabase.co' }), /HTTPS Supabase/);
  assert.throws(() => validateConfig({ ...env, SUPABASE_URL: 'https://evil.test' }), /HTTPS Supabase/);
  assert.throws(() => validateConfig({ ...env, SUPABASE_URL: 'https://user:pass@fixture-project.supabase.co' }), /HTTPS Supabase/);
  assert.throws(() => validateConfig({ ...env, SUPABASE_URL: 'https://fixture-project.supabase.co/#fragment' }), /HTTPS Supabase/);
  assert.throws(() => validateConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }), /SUPABASE_SERVICE_ROLE_KEY/);

  const db = fakeDatabase();
  const store = createSupabaseResearchArchiveStore({ env, request: db.request });
  const first = await store.archive({ pageId, pageName: 'Online canel', evidence });
  assert.equal(first.status, 'ARCHIVE_WRITE_VERIFIED');
  assert.equal(first.storedCount, 1);
  assert.equal(first.duplicateCount, 0);
  assert.equal(first.canonicalMemoryWrite, false);
  assert.equal(db.rows.size, 1);

  const duplicate = await store.archive({ pageId, pageName: 'Online canel', evidence });
  assert.equal(duplicate.status, 'ARCHIVE_WRITE_VERIFIED');
  assert.equal(duplicate.storedCount, 0);
  assert.equal(duplicate.duplicateCount, 1);
  assert.equal(db.rows.size, 1);

  const found = await store.lookup({ pageId, query: 'public Page fixture', limit: 5 });
  assert.equal(found.status, 'RESEARCH_MEMORY_FOUND');
  assert.equal(found.resultCount, 1);
  assert.equal(found.results[0].integrityStatus, 'UNVERIFIED');
  assert.equal(found.results[0].canonicalMemoryWrite, false);
  assert.equal(found.results[0].sourceUrl, evidence[0].sourceUrl);

  const otherPage = await store.lookup({ pageId: '999999999', query: '' });
  assert.equal(otherPage.status, 'NO_RESEARCH_MEMORY_MATCH');
  assert.equal(otherPage.resultCount, 0);

  const storedRow = db.rows.values().next().value;
  storedRow.payload.snippet = 'tampered after verified write';
  await assert.rejects(() => store.archive({ pageId, pageName: 'Online canel', evidence }), /identity or digest mismatch/);

  let remoteCalls = 0;
  await assert.rejects(
    () => archiveFacebookResearchEvidenceWithProvider(
      { pageId, pageName: 'Online canel', evidence },
      { env: { MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND: 'supabase' }, request: async () => { remoteCalls++; } }
    ),
    /SUPABASE_URL/
  );
  assert.equal(remoteCalls, 0);

  const localDir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mira-supa-local-'));
  require('node:fs').chmodSync(localDir, 0o700);
  assert.equal(require('node:fs').existsSync(localDir), true);
  const localEnv = { MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND: 'local', MIRA_FACEBOOK_RESEARCH_MEMORY_DIR: localDir };
  const local = await archiveFacebookResearchEvidenceWithProvider({ pageId, pageName: 'Online canel', evidence }, { env: localEnv });
  assert.equal(local.status, 'ARCHIVE_WRITE_VERIFIED');
  const localLookup = await searchFacebookResearchMemoryWithProvider({ pageId, query: 'public Page' }, { env: localEnv });
  assert.equal(localLookup.status, 'RESEARCH_MEMORY_FOUND');

  assert.ok(db.calls.some(call => call.method === 'POST' && call.url.includes('on_conflict=archive_id')));
  assert.ok(db.calls.every(call => !JSON.stringify(call).includes('Authorization:')));
  console.log('SUPABASE_CONFIG_VALIDATION_PASS=PASS');
  console.log('SUPABASE_IMMUTABLE_WRITE_READBACK_PASS=PASS');
  console.log('SUPABASE_JSONB_KEY_ORDER_INDEPENDENT_DIGEST_PASS=PASS');
  console.log('SUPABASE_IDEMPOTENT_DUPLICATE_PASS=PASS');
  console.log('SUPABASE_PAGE_ISOLATION_PASS=PASS');
  console.log('SUPABASE_UNTRUSTED_LOOKUP_PASS=PASS');
  console.log('SUPABASE_TAMPERED_READBACK_REJECTED_PASS=PASS');
  console.log('SUPABASE_MISSING_CONFIG_FAIL_CLOSED_PASS=PASS');
  console.log('LOCAL_BACKEND_COMPATIBILITY_PASS=PASS');
  console.log('LIVE_NETWORK_REQUESTS=0');
  console.log('CANONICAL_MEMORY_WRITES=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
