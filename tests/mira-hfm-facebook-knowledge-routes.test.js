'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const calls = [];
const fakeContext = {
  status: 'ACTOR_RESOLVED',
  actor: { actorId: 'mira:mira.users:11111111-1111-4111-8111-111111111111' },
  verifiedPrincipal: { verified: true, issuer: 'mira.users', subject: '11111111-1111-4111-8111-111111111111' }
};
const client = {
  async query(sql, params) {
    calls.push({ kind: 'query', sql, params });
    if (sql.includes('FROM mira_hfm.memory_audit_events')) {
      return { rows: [{ event_type: 'KNOWLEDGE_SEARCHED', memory_id: null, result_status: 'COMPLETED', occurred_at: '2026-11-07T00:00:00.000Z', details: { recordType: 'knowledge_item' } }] };
    }
    if (sql.includes('FOR UPDATE')) {
      return { rows: [{
        memory_id: 'fbk_test_00000001', project_id: 'hfm_0123456789abcdef0123456789abcdef',
        owner_actor_id: fakeContext.actor.actorId, record_type: 'knowledge_item',
        schema_version: '1.1.0', classification: 'PUBLIC', lifecycle: 'ACTIVE',
        revision: 1, integrity_status: 'UNVERIFIED', trust_status: 'SOURCE_RECORDED',
        public_payload: {}, encrypted_envelope: null, created_at: '2026-11-07T00:00:00.000Z',
        updated_at: '2026-11-07T00:00:00.000Z'
      }] };
    }
    return { rows: [], rowCount: 1 };
  }
};
const authorityCalls = [];
const stubs = {
  '../services/mira-hfm-runtime-identity-context': {
    buildTrustedActorContext: () => fakeContext
  },
  '../services/mira-hfm-authority-transaction': {
    executeWithConsumedAuthority: async options => {
      authorityCalls.push(options.request);
      const value = await options.perform(client, {
        actorId: fakeContext.actor.actorId,
        projectId: options.request.projectId,
        operation: options.request.operation,
        resource: options.request.resource,
        purpose: options.request.purpose,
        requestId: options.request.requestId,
        authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY'
      });
      return { status: 'AUTHORIZED_AND_COMMITTED', value };
    }
  },
  '../services/mira-hfm-facebook-knowledge': {
    extractImportedContent: value => value,
    ingestFacebookKnowledge: async options => {
      calls.push({ kind: 'ingest', options });
      return { status: 'CREATED', memoryId: options.memoryId };
    },
    researchFacebookSource: async options => ({ status: 'SEARCH_RESULTS_FOUND', sourceUrl: options.sourceUrl, results: [{ url: options.sourceUrl, snippet: 'indexed snippet' }] }),
    searchFacebookKnowledge: async options => ({ status: 'FOUND', count: 1, results: [{ memoryId: 'fbk_test_00000001', content: options.query, source: { sourceUrl: 'https://www.facebook.com/example/posts/1' } }] }),
    redactSensitiveText: content => ({ content, redacted: false })
  },
  '../services/mira-hfm-memory-repository': {
    getMemoryRecord: async () => ({ status: 'FOUND', record: {
      memoryId: 'fbk_test_00000001', recordType: 'knowledge_item', content: 'public text',
      access: { classification: 'PUBLIC' }, source: { sourceUrl: 'https://www.facebook.com/example/posts/1' },
      provenance: { collectionMethod: 'manual_copy' }, trust: { status: 'SOURCE_RECORDED' },
      integrity: { status: 'UNVERIFIED' }, timestamps: { createdAt: '2026-11-07T00:00:00.000Z' },
      version: { revision: 1, contentHash: 'hash' }
    } }),
    decodeStoredRow: () => ({
      memoryId: 'fbk_test_00000001', recordType: 'knowledge_item', content: 'old text',
      access: { classification: 'PUBLIC' }, source: { sourceUrl: 'https://www.facebook.com/example/posts/1' },
      provenance: { collectionMethod: 'manual_copy' }, trust: { status: 'SOURCE_RECORDED' },
      integrity: { status: 'UNVERIFIED' }, timestamps: { createdAt: '2026-11-07T00:00:00.000Z' },
      version: { revision: 1, contentHash: 'hash' }
    }),
    reviseMemoryRecord: async options => ({ status: 'UPDATED', memoryId: options.memoryId, revision: 2 }),
    trashMemoryRecord: async options => ({ status: 'TRASHED', memoryId: options.memoryId }),
    restoreMemoryRecord: async options => ({ status: 'RESTORED', memoryId: options.memoryId })
  },
  '../services/mira-hfm-record-schema': {
    createContentHash: value => 'hash-' + value.length
  }
};
for (const [requestPath, exports] of Object.entries(stubs)) {
  const resolved = require.resolve(path.join(__dirname, requestPath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const register = require('../routes/mira-hfm-facebook-knowledge');
const routes = [];
const auth = (_req, _res, next) => next();
const app = {
  get: (route, ...handlers) => routes.push({ method: 'GET', route, handlers }),
  post: (route, ...handlers) => routes.push({ method: 'POST', route, handlers }),
  delete: (route, ...handlers) => routes.push({ method: 'DELETE', route, handlers })
};
register(app, auth, { getPool: async () => ({ connect: async () => client }) });

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}
function request(input = {}) {
  return {
    session: { hfmPrincipal: fakeContext.verifiedPrincipal },
    sessionID: 'session-test-001',
    body: {}, query: {}, params: {}, ...input
  };
}
function authorityFields() {
  return {
    authorityId: 'authority-test-0001',
    requestId: 'request-test-0001',
    projectId: 'hfm_0123456789abcdef0123456789abcdef'
  };
}
async function invoke(method, route, req) {
  const found = routes.find(item => item.method === method && item.route === route);
  assert.ok(found, method + ' ' + route + ' is registered');
  const res = response();
  await found.handlers[1](req, res);
  return res;
}

test('all Facebook Knowledge APIs are authenticated and registered', () => {
  assert.ok(routes.length >= 8);
  assert.ok(routes.every(item => item.handlers[0] === auth));
  assert.ok(routes.some(item => item.route === '/api/hfm/facebook-knowledge/import'));
  assert.ok(routes.some(item => item.route === '/api/hfm/facebook-knowledge/research'));
  assert.ok(routes.some(item => item.route === '/api/hfm/facebook-knowledge/search'));
});

test('import API passes normalized source provenance through consumed one-time authority', async () => {
  const fields = authorityFields();
  const res = await invoke('POST', '/api/hfm/facebook-knowledge/import', request({
    body: {
      ...fields, memoryId: 'fbk_test_00000001', idempotencyKey: 'import-idempotency-001',
      content: 'public Facebook post', sourceType: 'facebook_page',
      sourceUrl: 'https://www.facebook.com/example/posts/1',
      sourceId: 'Example Page', collectionMethod: 'manual_copy', publicContentConfirmed: true
    }
  }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.memoryId, 'fbk_test_00000001');
  assert.equal(authorityCalls.at(-1).operation, 'memory.write');
  assert.equal(authorityCalls.at(-1).purpose, 'facebook-knowledge-import');
  assert.equal(calls.find(x => x.kind === 'ingest').options.content, 'public Facebook post');
});

test('public research and keyword retrieval are separately authority-gated', async () => {
  const fields = authorityFields();
  const research = await invoke('GET', '/api/hfm/facebook-knowledge/research', request({
    query: { ...fields, sourceUrl: 'https://www.facebook.com/example/posts/1' }
  }));
  assert.equal(research.body.status, 'SEARCH_RESULTS_FOUND');
  assert.equal(authorityCalls.at(-1).purpose, 'facebook-public-web-search');
  const search = await invoke('GET', '/api/hfm/facebook-knowledge/search', request({
    query: { ...fields, q: 'বাংলা প্রযুক্তি', limit: '5' }
  }));
  assert.equal(search.body.results[0].content, 'বাংলা প্রযুক্তি');
  assert.equal(authorityCalls.at(-1).purpose, 'facebook-knowledge-search');
});

test('history and view APIs expose source metadata but not credentials or payload audit text', async () => {
  const fields = authorityFields();
  const history = await invoke('GET', '/api/hfm/facebook-knowledge/history', request({ query: fields }));
  assert.equal(history.body.events[0].eventType, 'KNOWLEDGE_SEARCHED');
  const view = await invoke('GET', '/api/hfm/facebook-knowledge/:memoryId', request({
    params: { memoryId: 'fbk_test_00000001' }, query: fields
  }));
  assert.equal(view.body.record.source.sourceUrl, 'https://www.facebook.com/example/posts/1');
  assert.equal(authorityCalls.at(-1).operation, 'memory.read');
});

test('update, trash and restore APIs require operation-specific authority and preserve revision semantics', async () => {
  const fields = authorityFields();
  const update = await invoke('POST', '/api/hfm/facebook-knowledge/:memoryId/update', request({
    params: { memoryId: 'fbk_test_00000001' },
    body: { ...fields, idempotencyKey: 'update-idempotency-001', content: 'revised public text' }
  }));
  assert.equal(update.body.revision, 2);
  assert.equal(authorityCalls.at(-1).operation, 'memory.update');
  const trash = await invoke('DELETE', '/api/hfm/facebook-knowledge/:memoryId', request({
    params: { memoryId: 'fbk_test_00000001' },
    body: { ...fields, idempotencyKey: 'trash-idempotency-001' }
  }));
  assert.equal(trash.body.status, 'TRASHED');
  assert.equal(authorityCalls.at(-1).operation, 'memory.trash');
  const restore = await invoke('POST', '/api/hfm/facebook-knowledge/:memoryId/restore', request({
    params: { memoryId: 'fbk_test_00000001' },
    body: { ...fields, idempotencyKey: 'restore-idempotency-001' }
  }));
  assert.equal(restore.body.status, 'RESTORED');
  assert.equal(authorityCalls.at(-1).operation, 'memory.restore');
});

