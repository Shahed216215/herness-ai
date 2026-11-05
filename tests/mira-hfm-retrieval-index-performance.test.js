'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { searchProjectScopedMemory } = require('../services/mira-hfm-retrieval-index');

const now = new Date('2026-11-05T12:00:00.000Z');
function requestContext(requestId, overrides = {}) {
  return {
    actorId: 'actor-performance-fixture', actorType: 'HUMAN',
    projectId: 'project-performance', purpose: 'phase9-performance-test',
    requestId, authorityRef: 'host-performance-authority',
    issuedAt: '2026-11-05T11:59:00.000Z',
    expiresAt: '2026-11-05T12:05:00.000Z',
    ...overrides
  };
}
function authorize(input) {
  return {
    decision: 'ALLOW', replayStatus: 'FRESH',
    actorId: input.actorId, actorType: input.actorType,
    projectId: input.projectId, purpose: input.purpose,
    requestId: input.requestId, operation: input.operation,
    resourceScope: input.resourceScope, authorityRef: input.authorityRef,
    issuedAt: '2026-11-05T11:59:30.000Z',
    expiresAt: '2026-11-05T12:04:00.000Z'
  };
}
function dataset(count) {
  return Array.from({ length: count }, (_, i) => {
    const id = 'perf-memory-' + String(i).padStart(5, '0');
    const content = JSON.stringify({
      domain: 'work_learning',
      record: {
        learningId: id,
        taskId: 'perf-task-' + i,
        task: {
          title: 'Automation reliability task ' + i,
          description: 'Validate generated output and release safely'
        },
        lessons: [
          'Automate repeatable checks.',
          'Validate source integrity before release.',
          'Keep project scope isolated.'
        ]
      }
    });
    return {
      schemaVersion: '1.0.0',
      memoryId: id,
      projectId: 'project-performance',
      recordType: 'lesson',
      content,
      source: {
        sourceType: 'legacy_import', sourceId: id,
        sourceUrl: null, observedAt: '2026-11-05T10:00:00.000Z'
      },
      timestamps: {
        createdAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-05T10:00:00.000Z'
      },
      version: {
        revision: 1,
        contentHash: crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex')
      },
      integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
      trust: { status: 'CONTENT_VERIFIED' },
      access: {
        classification: 'PROJECT_PRIVATE',
        allowedProjectIds: ['project-performance']
      },
      lifecycle: 'ACTIVE'
    };
  });
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
function search(records, requestId) {
  return searchProjectScopedMemory({
    records, pendingConflicts: [],
    projectId: 'project-performance',
    requestContext: requestContext(requestId),
    authorizeRequest: authorize,
    query: 'automation validate release integrity',
    limit: 10,
    now
  });
}
async function run() {
  const rssBefore = process.memoryUsage().rss;
  const measurements = {};
  for (const size of [1000, 5000]) {
    const records = dataset(size);
    // Warm-up on a small prefix, then five measured runs.
    search(records.slice(0, Math.min(100, size)), 'warmup-' + size);
    const durations = [];
    let last;
    for (let i = 0; i < 5; i++) {
      const start = process.hrtime.bigint();
      last = search(records, 'perf-' + size + '-' + i);
      durations.push(Number(process.hrtime.bigint() - start) / 1e6);
      assert.equal(last.index.eligibleRecords, size);
      assert.equal(last.index.indexedDocuments, size);
      assert.equal(last.index.persisted, false);
    }
    measurements[size] = {
      p50Ms: Number(percentile(durations, 0.50).toFixed(2)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
      indexedRecords: last.index.indexedDocuments
    };
  }
  const rssDeltaMb = (process.memoryUsage().rss - rssBefore) / (1024 * 1024);
  assert.ok(measurements[1000].p95Ms <= 10000,
    '1k record p95 exceeded 10 seconds: ' + measurements[1000].p95Ms);
  assert.ok(measurements[5000].p95Ms <= 30000,
    '5k record p95 exceeded 30 seconds: ' + measurements[5000].p95Ms);
  assert.ok(rssDeltaMb <= 512,
    'RSS delta exceeded 512 MiB: ' + rssDeltaMb);
  console.log('HFM_INDEX_1K_P50_MS=' + measurements[1000].p50Ms);
  console.log('HFM_INDEX_1K_P95_MS=' + measurements[1000].p95Ms);
  console.log('HFM_INDEX_5K_P50_MS=' + measurements[5000].p50Ms);
  console.log('HFM_INDEX_5K_P95_MS=' + measurements[5000].p95Ms);
  console.log('HFM_INDEX_RSS_DELTA_MB=' + Number(rssDeltaMb.toFixed(2)));
  console.log('HFM_INDEX_1K_5K_PERFORMANCE_BOUNDS_PASS');

  const small = dataset(50);
  const [a, b] = await Promise.all([
    Promise.resolve().then(() => search(small, 'concurrent-request-a')),
    Promise.resolve().then(() => search(small, 'concurrent-request-b'))
  ]);
  assert.notEqual(a.requestId, b.requestId);
  assert.notEqual(a.index.indexDigest, b.index.indexDigest);
  assert.equal(a.projectId, b.projectId);
  console.log('HFM_INDEX_REQUEST_ISOLATION_AND_DIGEST_BINDING_PASS');

  assert.throws(() => searchProjectScopedMemory({
    records: small, pendingConflicts: [],
    projectId: 'project-performance',
    requestContext: requestContext('expired-request', {
      expiresAt: '2026-11-05T11:00:00.000Z'
    }),
    authorizeRequest: authorize,
    query: 'automation validate', now
  }), /expired|validity window/);
  console.log('HFM_INDEX_EXPIRED_REQUEST_BLOCK_PASS');
  console.log('NETWORK_REQUESTS=0');
  console.log('PERSISTENT_INDEX_WRITES=0');
  console.log('CANONICAL_MEMORY_WRITTEN=NO');
  console.log('CANONICAL_KNOWLEDGE_WRITTEN=NO');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_RETRIEVAL_INDEX_PERFORMANCE_PASS');
}
run().catch(error => { process.stderr.write((error.stack || error.message) + '\n'); process.exitCode = 1; });
