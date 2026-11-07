'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeFacebookUrl,
  extractImportedContent,
  redactSensitiveText,
  buildKnowledgeRecord,
  tokenize
} = require('../services/mira-hfm-facebook-knowledge');
const { validateCanonicalRecord } = require('../services/mira-hfm-record-schema');

test('accepts only HTTPS Facebook Page and Group URLs without credentials or fragments', () => {
  assert.equal(normalizeFacebookUrl('https://m.facebook.com/example.page/?ref=share'), 'https://www.facebook.com/example.page');
  assert.equal(normalizeFacebookUrl('https://www.facebook.com/permalink.php?story_fbid=123456&id=789&__tn__=R'), 'https://www.facebook.com/permalink.php?id=789&story_fbid=123456');
  assert.throws(() => normalizeFacebookUrl('http://facebook.com/example'), /HFM_FACEBOOK_SOURCE_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeFacebookUrl('https://facebook.com.evil.example/page'), /HFM_FACEBOOK_SOURCE_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeFacebookUrl('https://user:pass@facebook.com/page'), /HFM_FACEBOOK_SOURCE_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeFacebookUrl('https://facebook.com/page#private'), /HFM_FACEBOOK_SOURCE_URL_NOT_ALLOWED/);
});

test('redacts common contact and amount patterns before persistence', () => {
  const result = redactSensitiveText('Contact test@example.com or +880 1712-345678. Paid BDT 1500.');
  assert.equal(result.redacted, true);
  assert.doesNotMatch(result.content, /test@example\.com|1712-345678|BDT 1500/);
});

test('creates PUBLIC source-attributed v1.1 knowledge record with explicit unverified provenance', () => {
  const record = buildKnowledgeRecord({
    memoryId: 'fbk_test_00000001',
    projectId: 'project-001',
    sourceType: 'facebook_page',
    sourceId: 'Example Page',
    sourceUrl: 'https://www.facebook.com/example.page',
    content: 'বাংলাদেশে প্রযুক্তি শিক্ষা ও AI নিয়ে আলোচনা',
    collectionMethod: 'manual_copy',
    publicContentConfirmed: true,
    now: '2026-11-07T00:00:00.000Z'
  });
  assert.equal(validateCanonicalRecord(record).valid, true);
  assert.equal(record.access.classification, 'PUBLIC');
  assert.equal(record.lifecycle, 'ACTIVE');
  assert.equal(record.trust.status, 'SOURCE_RECORDED');
  assert.equal(record.integrity.status, 'UNVERIFIED');
  assert.equal(record.provenance.verificationStatus, 'SOURCE_RECORDED');
  assert.deepEqual(record.access.allowedProjectIds, ['project-001']);
});


test('rejects knowledge import until user confirms the source is public and authorized', () => {
  assert.throws(() => buildKnowledgeRecord({
    projectId: 'project-001',
    sourceType: 'facebook_page',
    content: 'Public post text'
  }), /HFM_KNOWLEDGE_PUBLIC_CONTENT_CONFIRMATION_REQUIRED/);
});

test('rejects unsupported source kinds and invalid content', () => {
  assert.throws(() => buildKnowledgeRecord({
    projectId: 'project-001', sourceType: 'facebook_group_private', publicContentConfirmed: true,
    content: 'content'
  }), /HFM_KNOWLEDGE_SCOPE_OR_SOURCE_INVALID/);
  assert.throws(() => buildKnowledgeRecord({
    projectId: 'project-001', sourceType: 'manual', publicContentConfirmed: true,
    content: ''
  }), /HFM_KNOWLEDGE_CONTENT_INVALID/);
});


test('public search fallback uses a fixed web-search endpoint and filters non-Facebook results', async () => {
  const calledUrls = [];
  let requestBody = null;
  const result = await require('../services/mira-hfm-facebook-knowledge').researchFacebookSource({
    sourceUrl: 'https://facebook.com/example.page',
    apiKey: 'synthetic-test-key',
    fetchImpl: async (url, options) => {
      calledUrls.push(url);
      requestBody = JSON.parse(options.body);
      if (url === 'https://api.tavily.com/extract') return { ok: true, json: async () => ({ results: [] }) };
      return {
        ok: true,
        json: async () => ({
          results: [
            { title: 'Public post', url: 'https://www.facebook.com/example.page/posts/123', content: 'Indexed public snippet' },
            { title: 'Outside domain', url: 'https://evil.example/post', content: 'Must be excluded' }
          ]
        })
      };
    }
  });
  assert.deepEqual(calledUrls, ['https://api.tavily.com/extract', 'https://api.tavily.com/search']);
  assert.equal(requestBody.include_domains[0], 'facebook.com');
  assert.equal(result.status, 'SEARCH_RESULTS_FOUND');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].verificationStatus, 'SOURCE_RECORDED');
});


test('public extraction returns exact Facebook source content without login or Facebook API', async () => {
  const result = await require('../services/mira-hfm-facebook-knowledge').researchFacebookSource({
    sourceUrl: 'https://www.facebook.com/example.page/posts/123',
    apiKey: 'synthetic-test-key',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.tavily.com/extract');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.urls, ['https://www.facebook.com/example.page/posts/123']);
      return {
        ok: true,
        json: async () => ({
          results: [{
            url: 'https://www.facebook.com/example.page/posts/123',
            title: 'Public post title',
            raw_content: 'Publicly extractable post text'
          }]
        })
      };
    }
  });
  assert.equal(result.status, 'PUBLIC_CONTENT_RETRIEVED');
  assert.equal(result.results[0].content, 'Publicly extractable post text');
  assert.equal(result.results[0].verificationStatus, 'SOURCE_REACHABLE');
});

test('missing web-search provider returns manual-import fallback without making a request', async () => {
  const result = await require('../services/mira-hfm-facebook-knowledge').researchFacebookSource({
    sourceUrl: 'https://www.facebook.com/example.page',
    apiKey: ''
  });
  assert.equal(result.status, 'SEARCH_PROVIDER_NOT_CONFIGURED');
  assert.equal(result.fallback, 'MANUAL_IMPORT_REQUIRED');
  assert.deepEqual(result.results, []);
});
test('tokenizer handles Bengali and English Unicode terms', () => {
  assert.deepEqual(tokenize('AI প্রযুক্তি এবং Python'), ['ai', 'প্রযুক্তি', 'এবং', 'python']);
});

test('extracts text from Facebook JSON export without storing unrelated metadata', () => {
  const content = extractImportedContent(JSON.stringify({
    data: [{ post: { message: 'বাংলা পোস্টের লেখা', created_time: '2026-11-07T00:00:00Z' } }],
    account: { name: 'Example' }
  }), { fileName: 'facebook-export.json', mimeType: 'application/json' });
  assert.equal(content, 'বাংলা পোস্টের লেখা');
  assert.equal(content.includes('created_time'), false);
});

test('extracts readable text from HTML exports and removes scripts and markup', () => {
  const content = extractImportedContent('<html><body><article><p>Public post text &amp; details</p><script>secret()</script></article></body></html>', {
    fileName: 'facebook-export.html', mimeType: 'text/html'
  });
  assert.match(content, /Public post text & details/);
  assert.doesNotMatch(content, /secret\(\)|<p>|<script>/);
});

test('rejects malformed or non-text JSON exports', () => {
  assert.throws(() => extractImportedContent('{bad json', { fileName: 'export.json' }), /HFM_IMPORT_JSON_INVALID/);
  assert.throws(() => extractImportedContent('{"created_time":"today"}', { fileName: 'export.json' }), /HFM_IMPORT_JSON_NO_TEXT/);
});

test('redacts credential fields and blocks restricted client or financial record markers', () => {
  const clean = redactSensitiveText('Public post mentions api_key=abcd1234 and password:hello123.');
  assert.match(clean.content, /REDACTED_CREDENTIAL/);
  assert.doesNotMatch(clean.content, /abcd1234|hello123/);
  const jsonCredential = redactSensitiveText('{"api_key":"json-secret-value"}');
  assert.match(jsonCredential.content, /REDACTED_CREDENTIAL/);
  assert.doesNotMatch(jsonCredential.content, /json-secret-value/);
  assert.throws(() => redactSensitiveText('{"client_record": {"name":"Private Client"}}'), /HFM_KNOWLEDGE_RESTRICTED_CONTENT_BLOCKED/);
  assert.throws(() => redactSensitiveText('bank_account: 123456789'), /HFM_KNOWLEDGE_RESTRICTED_CONTENT_BLOCKED/);
  assert.throws(() => redactSensitiveText('-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'), /HFM_KNOWLEDGE_RESTRICTED_CONTENT_BLOCKED/);
});

test('knowledge ingestion rejects missing or mismatched consumed authority before database writes', async () => {
  const { ingestFacebookKnowledge } = require('../services/mira-hfm-facebook-knowledge');
  await assert.rejects(() => ingestFacebookKnowledge({
    client: { query: async () => { throw new Error('SHOULD_NOT_QUERY'); } },
    context: { projectId: 'project-001', operation: 'memory.write', resource: 'memory:fbk_test_00000001' },
    memoryId: 'fbk_test_00000001', content: 'public post',
    sourceType: 'manual', publicContentConfirmed: true
  }), /HFM_KNOWLEDGE_CONSUMED_AUTHORITY_REQUIRED/);
});

test('knowledge ingestion detects content-hash duplicates before creating a record', async () => {
  const { ingestFacebookKnowledge } = require('../services/mira-hfm-facebook-knowledge');
  const calls = [];
  const result = await ingestFacebookKnowledge({
    client: { query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ memory_id: 'fbk_existing_0001' }] };
    } },
    context: {
      authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY', operation: 'memory.write',
      projectId: 'project-001', resource: 'memory:fbk_test_00000001', requestId: 'req-duplicate-001'
    },
    memoryId: 'fbk_test_00000001', content: 'same public post',
    sourceType: 'manual', sourceId: 'Example', collectionMethod: 'manual_copy',
    publicContentConfirmed: true, idempotencyKey: 'import-duplicate-001'
  });
  assert.equal(result.status, 'DUPLICATE');
  assert.equal(result.memoryId, 'fbk_existing_0001');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /contentHash/);
});

test('knowledge ingestion persists new source-attributed records only through the repository writer', async () => {
  const { ingestFacebookKnowledge } = require('../services/mira-hfm-facebook-knowledge');
  const modulePath = require.resolve('../services/mira-hfm-memory-repository');
  const original = require.cache[modulePath];
  let saved = null;
  require.cache[modulePath] = {
    id: modulePath, filename: modulePath, loaded: true,
    exports: {
      createMemoryRecord: async options => {
        saved = options;
        return { status: 'CREATED', memoryId: options.record.memoryId };
      }
    }
  };
  try {
    const result = await ingestFacebookKnowledge({
      client: { query: async () => ({ rows: [] }) },
      context: {
        authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY', operation: 'memory.write',
        projectId: 'project-001', resource: 'memory:fbk_test_00000002', requestId: 'req-import-002'
      },
      memoryId: 'fbk_test_00000002', content: 'বাংলা প্রযুক্তি পোস্ট',
      sourceType: 'facebook_page', sourceId: 'Example Page',
      sourceUrl: 'https://www.facebook.com/example.page/posts/2',
      collectionMethod: 'manual_copy', publicContentConfirmed: true,
      idempotencyKey: 'import-idempotency-002', now: '2026-11-07T00:00:00.000Z'
    });
    assert.equal(result.status, 'CREATED');
    assert.equal(saved.record.source.sourceUrl, 'https://www.facebook.com/example.page/posts/2');
    assert.equal(saved.record.provenance.collectionMethod, 'manual_copy');
    assert.equal(saved.record.access.classification, 'PUBLIC');
    assert.equal(saved.context.authorityContext, 'HFM_CONSUMED_ONE_TIME_AUTHORITY');
  } finally {
    if (original) require.cache[modulePath] = original;
    else delete require.cache[modulePath];
  }
});

test('keyword retrieval returns source evidence and audits only non-content metadata', async () => {
  const { searchFacebookKnowledge } = require('../services/mira-hfm-facebook-knowledge');
  const modulePath = require.resolve('../services/mira-hfm-memory-repository');
  const original = require.cache[modulePath];
  require.cache[modulePath] = {
    id: modulePath, filename: modulePath, loaded: true,
    exports: {
      decodeStoredRow: () => ({
        memoryId: 'fbk_search_0001', content: 'বাংলাদেশে AI প্রযুক্তি শিক্ষা',
        source: { sourceUrl: 'https://www.facebook.com/example.page/posts/1' },
        provenance: { collectionMethod: 'manual_copy', verificationStatus: 'SOURCE_RECORDED' },
        trust: { status: 'SOURCE_RECORDED' }, integrity: { status: 'UNVERIFIED' },
        version: { revision: 2 }
      }),
      digest: value => JSON.stringify(value)
    }
  };
  const queries = [];
  const client = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM mira_hfm.memory_records')) return { rows: [{ memory_id: 'fbk_search_0001' }] };
    if (sql.includes('SELECT event_hash')) return { rows: [] };
    return { rows: [], rowCount: 1 };
  } };
  try {
    const result = await searchFacebookKnowledge({
      client,
      context: {
        authorityContext: 'HFM_CONSUMED_ONE_TIME_AUTHORITY', operation: 'memory.read',
        projectId: 'project-001', resource: 'memory:project:project-001',
        actorId: 'mira:mira.users:11111111-1111-4111-8111-111111111111',
        requestId: 'search-request-001'
      },
      query: 'বাংলাদেশ AI', limit: 5
    });
    assert.equal(result.status, 'FOUND');
    assert.equal(result.results[0].source.sourceUrl, 'https://www.facebook.com/example.page/posts/1');
    assert.equal(result.results[0].revision, 2);
    const searchSql = queries.find(item => item.sql.includes('FROM mira_hfm.memory_records'));
    assert.ok(searchSql);
    assert.match(searchSql.sql, /integrity_status NOT IN \\('FAILED','QUARANTINED'\\)/);
    const lockIndex = queries.findIndex(item =>
      item.sql === 'SELECT pg_advisory_xact_lock(hashtext($1))' &&
      item.params[0] === 'project-001'
    );
    const previousHashIndex = queries.findIndex(item =>
      item.sql.includes('SELECT event_hash FROM mira_hfm.memory_audit_events')
    );
    const auditInsertIndex = queries.findIndex(item =>
      item.sql.includes('INSERT INTO mira_hfm.memory_audit_events')
    );
    assert.ok(lockIndex >= 0, 'search audit must acquire the project hash-chain lock');
    assert.ok(previousHashIndex > lockIndex, 'previous hash must be read after acquiring the lock');
    assert.ok(auditInsertIndex > previousHashIndex, 'audit event must be inserted after reading the locked chain head');
    assert.equal(JSON.stringify(queries[auditInsertIndex].params).includes('বাংলাদেশ AI'), false);
  } finally {
    if (original) require.cache[modulePath] = original;
    else delete require.cache[modulePath];
  }
});

test('extracts only post text columns from CSV exports with quoted commas and newlines', () => {
  const csv = `post_id,message,date
1,"বাংলা পোস্ট, AI নিয়ে আলোচনা","2026-11-07"
2,"দ্বিতীয় লাইন
এখানে","2026-11-08"`;
  const content = extractImportedContent(csv, {
    fileName: 'facebook-export.csv', mimeType: 'text/csv'
  });
  assert.match(content, /বাংলা পোস্ট, AI নিয়ে আলোচনা/);
  assert.ok(content.includes('দ্বিতীয় লাইন\nএখানে'));
  assert.doesNotMatch(content, /post_id|2026-11-07|2026-11-08/);
  assert.throws(() => extractImportedContent('id,date\n1,today', { fileName: 'export.csv' }), /HFM_IMPORT_CSV_NO_TEXT_COLUMN/);
  assert.throws(() => extractImportedContent('message\\n"unfinished', { fileName: 'export.csv' }), /HFM_IMPORT_CSV_INVALID/);
});
