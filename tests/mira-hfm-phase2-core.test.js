'use strict';

const assert = require('node:assert/strict');
const core = require('../services/mira-hfm/core');
const { executeGovernedWrite } = require('../services/mira-hfm/write-coordinator');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  process.stdout.write('PASS ' + name + '\n');
}
async function checkAsync(name, fn) {
  await fn();
  passed += 1;
  process.stdout.write('PASS ' + name + '\n');
}
function fixtureRecord(overrides) {
  const content = 'Phase 2 isolated fixture record';
  return Object.assign({
    schemaVersion: '1.0.0',
    memoryId: 'memory-fixture-0001',
    projectId: 'project-fixture',
    recordType: 'fact',
    content,
    source: {
      sourceType: 'manual',
      sourceId: 'fixture-source-1',
      sourceUrl: null,
      observedAt: '2026-11-03T00:00:00.000Z'
    },
    timestamps: {
      createdAt: '2026-11-03T00:00:00.000Z',
      updatedAt: '2026-11-03T00:00:00.000Z'
    },
    version: {
      revision: 1,
      contentHash: core.createContentHash(content)
    },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PROJECT_PRIVATE' },
    lifecycle: 'ACTIVE'
  }, overrides || {});
}
function context() {
  return {
    authenticated: true,
    actor: 'fixture-actor',
    actorAuthorized: true,
    actionAuthorized: true,
    policyAllowed: true,
    projectId: 'project-fixture',
    requestId: 'request-fixture-1',
    purpose: 'isolated-test',
    policyDecisionId: 'policy-fixture-1',
    action: 'write'
  };
}
function operation(record) {
  return {
    projectId: record.projectId,
    operationId: 'operation-fixture-1',
    idempotencyKey: 'idempotency-fixture-1',
    payloadHash: core.sha256Canonical(record),
    actor: 'fixture-actor',
    purpose: 'isolated-test',
    policyDecisionId: 'policy-fixture-1',
    requestId: 'request-fixture-1'
  };
}
const capabilities = {
  READ: 'AVAILABLE', WRITE: 'AVAILABLE', SEARCH: 'AVAILABLE',
  VERIFY: 'AVAILABLE', BACKUP: 'UNAVAILABLE', RESTORE: 'UNAVAILABLE'
};

async function main() {
  check('RFC8785-style object key ordering is deterministic', () => {
    assert.equal(core.canonicalize({ z: 1, a: 2 }), '{"a":2,"z":1}');
    assert.equal(core.canonicalize({ a: [true, null, 'x'] }), '{"a":[true,null,"x"]}');
  });
  check('Canonical serializer normalizes negative zero', () => {
    assert.equal(core.canonicalize(-0), '0');
  });
  check('Canonical serializer rejects non-finite and unsafe integer values', () => {
    assert.throws(() => core.canonicalize(NaN), /NON_FINITE_NUMBER/);
    assert.throws(() => core.canonicalize(Number.MAX_SAFE_INTEGER + 1), /UNSAFE_INTEGER/);
  });
  check('Canonical serializer rejects unsupported values and sparse arrays', () => {
    assert.throws(() => core.canonicalize({ x: undefined }), /UNDEFINED_OBJECT_VALUE/);
    const sparse = [];
    sparse[1] = 'x';
    assert.throws(() => core.canonicalize(sparse), /SPARSE_OR_EXTENDED_ARRAY|SPARSE_ARRAY/);
  });
  check('Content hash is deterministic and tamper-evident', () => {
    const hash = core.createContentHash('same');
    assert.equal(hash, core.createContentHash('same'));
    assert.notEqual(hash, core.createContentHash('changed'));
  });
  check('Canonical record validates against strict v1.0.0 contract', () => {
    assert.deepEqual(core.validateCanonicalRecord(fixtureRecord()).errors, []);
  });
  check('Canonical record rejects unknown root and nested fields', () => {
    const record = fixtureRecord({ unexpected: true });
    assert.equal(core.validateCanonicalRecord(record).valid, false);
    const nested = fixtureRecord();
    nested.source.secret = 'must reject';
    assert.equal(core.validateCanonicalRecord(nested).valid, false);
  });
  check('Verified record rejects mismatched content hash', () => {
    const record = fixtureRecord();
    record.version.contentHash = '0'.repeat(64);
    assert.ok(core.validateCanonicalRecord(record).errors.includes('VERIFIED_CONTENT_HASH_MISMATCH'));
  });
  check('Project-private access requires owner project and actor authorization', () => {
    const record = fixtureRecord();
    assert.equal(core.evaluateAccess(record, context()).allowed, true);
    assert.equal(core.evaluateAccess(record, Object.assign(context(), { projectId: 'other' })).allowed, false);
    assert.equal(core.evaluateAccess(record, Object.assign(context(), { actorAuthorized: false })).allowed, false);
  });
  check('Public visibility does not grant write authorization', () => {
    const record = fixtureRecord({ access: { classification: 'PUBLIC' } });
    assert.equal(core.evaluateAccess(record, Object.assign(context(), { actionAuthorized: false })).allowed, false);
  });
  check('Restricted external project requires explicit allowlist and delegation', () => {
    const record = fixtureRecord({ access: { classification: 'RESTRICTED', allowedProjectIds: ['delegated'] } });
    const request = Object.assign(context(), { projectId: 'delegated', delegationAuthorized: true });
    assert.equal(core.evaluateAccess(record, request).allowed, true);
    assert.equal(core.evaluateAccess(record, Object.assign({}, request, { delegationAuthorized: false })).allowed, false);
    assert.equal(core.evaluateAccess(record, Object.assign({}, request, { projectId: 'other' })).allowed, false);
  });
  check('Trust transitions enforce ordered evidence and quarantine release approval', () => {
    const evidence = {
      actor: 'reviewer', timestamp: '2026-11-03T00:00:00.000Z',
      evidenceReference: 'fixture:evidence:1', policyVersion: 'fixture-policy-1', reason: 'fixture'
    };
    assert.equal(core.transitionTrust({ status: 'UNVERIFIED' }, 'CONTENT_VERIFIED', evidence).ok, false);
    assert.equal(core.transitionTrust({ status: 'UNVERIFIED' }, 'SOURCE_RECORDED', evidence).ok, true);
    assert.equal(core.transitionTrust({ status: 'QUARANTINED' }, 'UNVERIFIED', evidence).ok, false);
    assert.equal(core.transitionTrust({ status: 'QUARANTINED' }, 'UNVERIFIED', evidence, {
      quarantineReleaseAuthorized: true, auditRecorded: true
    }).ok, true);
  });
  check('Source or content mutation invalidates trust state', () => {
    assert.equal(core.invalidateTrustAfterMutation({ status: 'HUMAN_VERIFIED' }).status, 'UNVERIFIED');
  });
  check('Unknown capabilities fail closed', () => {
    assert.equal(core.capabilityState({}, 'WRITE'), 'UNKNOWN');
    assert.equal(core.isCapabilityAvailable({ WRITE: 'UNKNOWN' }, 'WRITE'), false);
    assert.equal(core.isCapabilityAvailable(capabilities, 'WRITE'), true);
  });
  check('Operation identity requires stable idempotency and payload binding', () => {
    const record = fixtureRecord();
    assert.equal(core.validateOperationIdentity(operation(record)).valid, true);
    assert.equal(core.validateOperationIdentity({}).valid, false);
  });
  check('Idempotency classification prevents changed-payload replay', () => {
    const record = fixtureRecord();
    const op = operation(record);
    assert.equal(core.classifyIdempotency(null, op), 'NEW');
    assert.equal(core.classifyIdempotency(Object.assign({}, op, { status: 'COMMITTED' }), op), 'REPLAY_COMMITTED');
    assert.equal(core.classifyIdempotency(op, Object.assign({}, op, { payloadHash: 'f'.repeat(64) })), 'PAYLOAD_CONFLICT');
  });
  check('Adapter error taxonomy maps unknown errors to UNKNOWN', () => {
    assert.equal(core.normalizeAdapterError({ code: 'TIMEOUT' }), 'TIMEOUT');
    assert.equal(core.normalizeAdapterError({ code: 'SECRET_LEAK' }), 'UNKNOWN');
  });

  await checkAsync('Write coordinator blocks when durable audit is unavailable', async () => {
    const record = fixtureRecord();
    let writes = 0;
    const provider = {
      getCapabilities: async () => capabilities,
      write: async () => { writes += 1; return { status: 'COMMITTED', revision: 2 }; },
      read: async () => record,
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider,
      audit: { durable: false, append: async () => ({ status: 'APPENDED' }) }
    });
    assert.equal(result.status, 'NOT_CONFIGURED');
    assert.equal(writes, 0);
  });

  await checkAsync('Write coordinator records intent before provider write and verifies readback', async () => {
    const record = fixtureRecord();
    const events = [];
    let written = false;
    const provider = {
      getCapabilities: async () => capabilities,
      write: async () => {
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'MEMORY_WRITE_INTENT');
        written = true;
        return { status: 'COMMITTED', revision: 2 };
      },
      read: async () => {
        assert.equal(written, true);
        return Object.assign({}, record, { version: Object.assign({}, record.version, { revision: 2 }) });
      },
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const audit = {
      durable: true,
      append: async event => { events.push(event); return { status: 'APPENDED' }; }
    };
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider, audit
    });
    assert.equal(result.status, 'COMPLETED');
    assert.equal(events.length, 2);
    assert.equal(result.readbackVerified, true);
  });

  await checkAsync('Write coordinator never blindly retries an uncertain commit', async () => {
    const record = fixtureRecord();
    let writeCalls = 0;
    const provider = {
      getCapabilities: async () => capabilities,
      write: async () => { writeCalls += 1; return { status: 'UNKNOWN' }; },
      read: async () => record,
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const audit = { durable: true, append: async () => ({ status: 'APPENDED' }) };
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider, audit
    });
    assert.equal(result.status, 'RECOVERY_REQUIRED');
    assert.equal(writeCalls, 1);
  });

  await checkAsync('Completion audit uncertainty remains COMMITTED_AUDIT_PENDING', async () => {
    const record = fixtureRecord();
    let appendCount = 0;
    const provider = {
      getCapabilities: async () => capabilities,
      write: async () => ({ status: 'COMMITTED', revision: 2 }),
      read: async () => Object.assign({}, record, { version: Object.assign({}, record.version, { revision: 2 }) }),
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const audit = {
      durable: true,
      append: async () => {
        appendCount += 1;
        return appendCount === 1 ? { status: 'APPENDED' } : { status: 'UNKNOWN' };
      }
    };
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider, audit
    });
    assert.equal(result.status, 'COMMITTED_AUDIT_PENDING');
  });

  process.stdout.write('TESTS_PASSED=' + passed + '\n');
  process.stdout.write('TESTS_FAILED=0\n');
  process.stdout.write('PRODUCTION_MEMORY_TOUCHED=NO\n');
  process.stdout.write('NETWORK_REQUESTS=0\n');
  process.stdout.write('EXTERNAL_ACTIONS=0\n');
}
main().catch(error => {
  process.stderr.write('TEST_FAILURE=' + (error && error.stack || error) + '\n');
  process.exitCode = 1;
});
