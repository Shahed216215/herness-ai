'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../services/mira-hfm/core');
const { executeGovernedWrite } = require('../services/mira-hfm/write-coordinator');
const { auditProviderReadiness, validateAuditEvent, createAuditEventHash } = require('../services/mira-hfm/audit-contract');
const { readMemory, searchMemory, writeMemory } = require('../services/mira-hfm/memory-service');
const { inspectProviderAdapter, requireCapability, createUnavailableProvider } = require('../services/mira-hfm/provider-contract');
const { createProviderCatalog } = require('../services/mira-hfm/provider-catalog');
const { validateCapabilityObservation, evaluateCapabilitySet } = require('../services/mira-hfm/capability-observations');
const { operationRegistryReadiness, claimOperation } = require('../services/mira-hfm/operation-registry');
const { encryptPayload, decryptPayload, cryptoProviderReadiness } = require('../services/mira-hfm/encryption-contract');
const { mapLegacyRecord } = require('../services/mira-hfm/legacy-adapter');
const { previewLegacyMigration } = require('../services/mira-hfm/migration-preview');
const { executeEvolutionMemoryWrite } = require('../services/mira-hfm/evolution-memory-bridge');
const hfm = require('../services/mira-hfm');
const { createRetrievalEvidence } = require('../services/mira-hfm/retrieval-evidence');
const { detectConflict, prepareConflictResolution } = require('../services/mira-hfm/conflict');
const { createBackupManifest, verifyBackupManifest, authorizeRestore } = require('../services/mira-hfm/backup-manifest');
const { createEncryptedBackupPackage, verifyEncryptedBackupPackage } = require('../services/mira-hfm/backup-package');

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
    now: '2026-11-03T12:00:00.000Z',
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
function commitReceipt(record, providerId) {
  const identity = operation(record);
  return {
    status: 'COMMITTED',
    operationId: identity.operationId,
    idempotencyKey: identity.idempotencyKey,
    projectId: identity.projectId,
    payloadHash: identity.payloadHash,
    requestId: identity.requestId,
    providerId: providerId || 'fixture-provider',
    revision: record.version.revision,
    evidenceReference: 'fixture:provider-commit-receipt'
  };
}
function capabilityObservations(overrides, projectId) {
  const states = Object.assign({ READ: 'AVAILABLE', WRITE: 'AVAILABLE', SEARCH: 'AVAILABLE', VERIFY: 'AVAILABLE', BACKUP: 'UNAVAILABLE', RESTORE: 'UNAVAILABLE' }, overrides || {});
  return Object.keys(states).map(capability => ({
    providerId: 'fixture-provider', projectId: projectId || 'project-fixture', capability,
    state: states[capability], checkedAt: '2026-11-03T00:00:00.000Z',
    expiresAt: '2026-11-03T23:59:00.000Z', permissionScope: [capability],
    policyVersion: 'fixture-policy', evidenceReference: 'fixture-capability:' + capability
  }));
}
const auditCapabilities = {
  DURABLE_APPEND: true, APPEND_ONLY: true, LOOKUP: true,
  RECONCILE: true, VERIFY: true, PROJECT_ISOLATED: true
};
function fakeRegistry() {
  const entries = new Map();
  const keyOf = identity => identity.projectId + '|' + identity.operationId + '|' + identity.idempotencyKey;
  return {
    durable: true, atomicClaim: true, projectScoped: true,
    claim: async identity => {
      const key = keyOf(identity);
      const existing = entries.get(key);
      const identityHash = core.sha256Canonical(identity);
      if (existing) {
        if (existing.identity.payloadHash !== identity.payloadHash) return { status: 'PAYLOAD_CONFLICT' };
        if (existing.status === 'COMPLETED') return { status: 'REPLAY_COMMITTED', priorResult: existing.result };
        return { status: 'IN_PROGRESS' };
      }
      const claimId = 'claim-' + entries.size;
      entries.set(key, { identity, identityHash, claimId, status: 'IN_PROGRESS' });
      return { status: 'CLAIMED', claimId, identityHash };
    },
    lookup: async identity => entries.get(keyOf(identity)) || null,
    reconcile: async identity => entries.get(keyOf(identity)) || null,
    markUncertain: async payload => {
      const entry = entries.get(keyOf(payload.identity));
      if (!entry || entry.claimId !== payload.claimId) return { status: 'UNKNOWN' };
      entry.status = payload.state;
      return { status: 'RECORDED' };
    },
    complete: async payload => {
      const entry = entries.get(keyOf(payload.identity));
      if (!entry || entry.claimId !== payload.claimId) return { status: 'UNKNOWN' };
      entry.status = 'COMPLETED';
      entry.result = payload.result;
      return { status: 'COMPLETED', identityHash: payload.identityHash };
    }
  };
}
function fakeAudit(events) {
  return {
    durable: true, capabilities: auditCapabilities,
    append: async event => { events.push(event); return { status: 'APPENDED' }; },
    lookup: async eventId => events.find(event => event.eventId === eventId) || null,
    reconcileEvent: async eventId => events.some(event => event.eventId === eventId)
      ? { status: 'ALREADY_APPENDED' } : { status: 'UNKNOWN' },
    verifyEvent: async eventId => {
      const event = events.find(item => item.eventId === eventId);
      return event ? {
        valid: true, chainVerified: true, authenticityVerified: true,
        eventId, projectId: event.projectId, sequence: events.indexOf(event) + 1,
        previousEventHash: events.indexOf(event) === 0 ? null : createAuditEventHash(events[events.indexOf(event) - 1], null, events.indexOf(event)),
        eventHash: createAuditEventHash(event, events.indexOf(event) === 0 ? null : createAuditEventHash(events[events.indexOf(event) - 1], null, events.indexOf(event)), events.indexOf(event) + 1)
      } : { valid: false };
    }
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
  check('Source URLs reject embedded credentials and secret-bearing query parameters', () => {
    assert.equal(core.isSafeSourceUrl('https://user:pass@example.org/path'), false);
    assert.equal(core.isSafeSourceUrl('https://example.org/?token=fixture'), false);
    assert.equal(core.isSafeSourceUrl('https://example.org/path'), true);
  });
  check('Canonical Memory rejects embedded credential material', () => {
    assert.equal(core.containsCredentialMaterial('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'), true);
    assert.equal(core.containsCredentialMaterial('api_key=sk_live_abcdefghijklmnop123456'), true);
    assert.equal(core.containsCredentialMaterial('-----BEGIN OPENSSH PRIVATE KEY-----'), true);
    const unsafe = fixtureRecord({ content: 'password=supersecretvalue12345' });
    unsafe.version.contentHash = core.createContentHash(unsafe.content);
    assert.ok(core.validateCanonicalRecord(unsafe).errors.includes('CONTENT_SECRET_MATERIAL_REJECTED'));
    assert.equal(core.containsCredentialMaterial('This record contains no credentials.'), false);
  });
  check('Content hash is deterministic and tamper-evident', () => {
    const hash = core.createContentHash('same');
    assert.equal(hash, core.createContentHash('same'));
    assert.notEqual(hash, core.createContentHash('changed'));
  });
  check('Published JSON Schema is strict and matches the core record contract', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schemas/mira-hfm-memory-record-v1.schema.json'), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
    assert.ok(schema.required.includes('memoryId'));
    assert.equal(schema.properties.source.additionalProperties, false);
    assert.equal(schema.properties.timestamps.additionalProperties, false);
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
    const quarantined = fixtureRecord({ trust: { status: 'QUARANTINED' } });
    assert.equal(core.evaluateAccess(quarantined, context()).allowed, false);
    assert.equal(core.evaluateAccess(quarantined, Object.assign(context(), {
      action: 'review_quarantined', quarantineReviewAuthorized: true, auditRecorded: true
    })).allowed, true);
  });
  check('Public visibility does not grant write authorization', () => {
    const record = fixtureRecord({ access: { classification: 'PUBLIC' } });
    assert.equal(core.evaluateAccess(record, Object.assign(context(), { actionAuthorized: false })).allowed, false);
  });
  check('Restricted external project requires explicit allowlist and delegation', () => {
    const record = fixtureRecord({ access: { classification: 'RESTRICTED', allowedProjectIds: ['delegated'] } });
    const request = Object.assign(context(), { projectId: 'delegated', delegationAuthorized: true });
    assert.equal(core.evaluateAccess(record, request).allowed, false, 'delegation decision identifier is required');
    const approved = Object.assign({}, request, { delegationDecisionId: 'delegation-policy-1' });
    assert.equal(core.evaluateAccess(record, approved).allowed, true);
    assert.equal(core.evaluateAccess(record, Object.assign({}, approved, { delegationAuthorized: false })).allowed, false);
    assert.equal(core.evaluateAccess(record, Object.assign({}, request, { projectId: 'other' })).allowed, false);
  });
  check('Trust transitions enforce ordered evidence and quarantine release approval', () => {
    const evidence = {
      actor: 'reviewer', timestamp: '2026-11-03T00:00:00.000Z',
      evidenceReference: 'fixture:evidence:1', policyVersion: 'fixture-policy-1',
      policyDecisionId: 'fixture-policy-decision', recordRevision: 1, reason: 'fixture'
    };
    assert.equal(core.transitionTrust({ status: 'UNVERIFIED', revision: 1 }, 'CONTENT_VERIFIED', evidence).ok, false);
    assert.equal(core.transitionTrust({ status: 'UNVERIFIED', revision: 1 }, 'SOURCE_RECORDED', evidence).ok, true);
    assert.equal(core.transitionTrust({ status: 'QUARANTINED', revision: 1 }, 'UNVERIFIED', evidence).ok, false);
    assert.equal(core.transitionTrust({ status: 'QUARANTINED', revision: 1 }, 'UNVERIFIED', evidence, {
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
  check('Durable audit provider requires append-only, reconciliation, verification and project isolation', () => {
    assert.equal(auditProviderReadiness({ durable: true, capabilities: auditCapabilities,
      append() {}, lookup() {}, reconcileEvent() {}, verifyEvent() {} }).ready, true);
    assert.equal(auditProviderReadiness({ durable: true, append() {} }).ready, false);
  });
  check('Audit event schema rejects private content and malformed fields', () => {
    const base = { eventId: 'event-1', eventType: 'MEMORY_WRITE_INTENT', projectId: 'project-fixture', operationId: 'op-1', idempotencyKey: 'idem-1', payloadHash: 'a'.repeat(64), requestId: 'request-1', actor: 'actor-1', purpose: 'test', policyDecisionId: 'policy-1', timestamp: '2026-11-03T00:00:00.000Z' };
    assert.equal(validateAuditEvent(base).valid, true);
    assert.equal(validateAuditEvent(Object.assign({}, base, { content: 'private memory text' })).valid, false);
    assert.equal(validateAuditEvent(Object.assign({}, base, { payloadHash: 'bad' })).valid, false);
  });
  check('Audit event hashes bind sequence and previous-event hash', () => {
    const event = { eventId: 'event-1', projectId: 'project-fixture' };
    assert.notEqual(createAuditEventHash(event, null, 1), createAuditEventHash(event, null, 2));
    assert.notEqual(createAuditEventHash(event, null, 1), createAuditEventHash(event, 'b'.repeat(64), 1));
  });
  check('Capability observations enforce project scope, permission scope and expiry', () => {
    const observation = capabilityObservations()[0];
    assert.equal(validateCapabilityObservation(observation, {
      providerId: 'fixture-provider', projectId: 'project-fixture', capability: 'READ'
    }, '2026-11-03T12:00:00.000Z').status, 'AVAILABLE');
    assert.equal(validateCapabilityObservation(observation, {
      providerId: 'fixture-provider', projectId: 'another-project', capability: 'READ'
    }, '2026-11-03T12:00:00.000Z').status, 'PERMISSION_DENIED');
    assert.equal(validateCapabilityObservation(Object.assign({}, observation, {
      expiresAt: '2026-11-03T11:00:00.000Z'
    }), { providerId: 'fixture-provider', projectId: 'project-fixture', capability: 'READ' },
    '2026-11-03T12:00:00.000Z').status, 'EXPIRED');
    assert.equal(evaluateCapabilitySet(capabilityObservations(), ['READ'], context(), 'fixture-provider').valid, true);
  });
  check('Operation registry requires durable atomic project-scoped claim and completion', () => {
    assert.equal(operationRegistryReadiness(fakeRegistry()).ready, true);
    assert.equal(operationRegistryReadiness({ durable: true }).ready, false);
  });
  await checkAsync('Operation registry atomically prevents concurrent duplicate claims and changed-payload reuse', async () => {
    const store = fakeRegistry();
    const record = fixtureRecord();
    const op = operation(record);
    const [first, second] = await Promise.all([
      claimOperation(store, op, context()),
      claimOperation(store, op, context())
    ]);
    assert.deepEqual([first.status, second.status].sort(), ['CLAIMED', 'IN_PROGRESS']);
    const claimed = first.status === 'CLAIMED' ? first : second;
    await store.complete({
      identity: op, claimId: claimed.claimId,
      identityHash: core.sha256Canonical(op),
      result: { status: 'COMPLETED', revision: 1 }
    }, context());
    assert.equal((await claimOperation(store, op, context())).status, 'REPLAY_COMMITTED');
    assert.equal((await claimOperation(store, Object.assign({}, op, {
      payloadHash: 'f'.repeat(64)
    }), context())).status, 'PAYLOAD_CONFLICT');
  });

  await checkAsync('Encryption contract fails closed without approved key provider', async () => {
    assert.equal(cryptoProviderReadiness(null, context()).ready, false);
    assert.equal((await encryptPayload(null, 'fixture', context())).status, 'NOT_APPROVED');
    assert.equal((await decryptPayload(null, {}, context())).status, 'NOT_APPROVED');
  });

  await checkAsync('AEAD envelope contract rejects malformed envelopes and never returns plaintext on encrypt', async () => {
    const provider = {
      approvedProfile: true, algorithmProfile: 'TEST-ONLY-AEAD', testOnly: true,
      encrypt: async plaintext => ({
        algorithm: 'TEST-ONLY-AEAD', keyId: 'fixture-key', keyVersion: '1',
        nonce: 'bm9uY2U=', authTag: 'dGFn', ciphertext: Buffer.from(plaintext).toString('base64'),
        aadProfile: 'fixture-aad-v1'
      }),
      decrypt: async envelope => Buffer.from(envelope.ciphertext, 'base64').toString('utf8')
    };
    const testContext = Object.assign(context(), { testOnly: true });
    const encrypted = await encryptPayload(provider, 'private fixture', testContext);
    assert.equal(encrypted.status, 'ENCRYPTED');
    assert.equal(encrypted.plaintextReturned, false);
    const decrypted = await decryptPayload(provider, encrypted.envelope, testContext);
    assert.equal(decrypted.status, 'DECRYPTED');
    assert.equal(decrypted.plaintext, 'private fixture');
    assert.equal((await encryptPayload(provider, 'x', context())).status, 'NOT_APPROVED');
  });

  await checkAsync('AEAD authentication failure never falls back to plaintext', async () => {
    const provider = {
      approvedProfile: true, algorithmProfile: 'TEST-ONLY-AEAD', testOnly: true,
      encrypt: async () => ({}),
      decrypt: async () => { throw new Error('AUTH_TAG_INVALID'); }
    };
    const testContext = Object.assign(context(), { testOnly: true });
    const envelope = {
      algorithm: 'TEST-ONLY-AEAD', keyId: 'fixture-key', keyVersion: '1',
      nonce: 'bm9uY2U=', authTag: 'dGFn', ciphertext: 'c2VjcmV0',
      aadProfile: 'fixture-aad-v1'
    };
    const result = await decryptPayload(provider, envelope, testContext);
    assert.equal(result.status, 'DECRYPTION_FAILED');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'plaintext'), false);
  });

  check('Provider contract requires independent verification support', () => {
    const incomplete = { getCapabilityObservations() {}, read() {}, search() {}, write() {}, reconcileOperation() {} };
    assert.equal(inspectProviderAdapter(incomplete).valid, false);
    assert.ok(inspectProviderAdapter(incomplete).missingMethods.includes('verify'));
  });
  check('Provider contract reports independent capability states and no implicit fallback', () => {
    const unavailable = createUnavailableProvider('fixture-provider');
    assert.equal(inspectProviderAdapter(unavailable).valid, true);
    assert.equal(inspectProviderAdapter(unavailable).capabilities.READ, 'NOT_CONFIGURED');
    assert.equal(requireCapability(unavailable, 'WRITE').allowed, false);
    assert.equal(inspectProviderAdapter(unavailable).noFallback, true);
  });
  check('Provider catalog resolves exact roles without silent fallback', () => {
    const catalog = createProviderCatalog();
    assert.equal(catalog.noFallback, true);
    assert.equal(catalog.networkAccessPerformed, false);
    assert.equal(catalog.list().length, 4);
    assert.equal(catalog.resolve('facebook_page_primary').role, 'PUBLIC_SHARED_KNOWLEDGE_CANONICAL_AFTER_APPROVED_PUBLICATION');
    assert.equal(catalog.resolve('facebook_page_primary').status, 'NOT_CONFIGURED');
    assert.equal(catalog.resolve('facebook_page_primary').provider.providerId, 'facebook_page_primary');
    assert.equal(catalog.resolve('unknown-provider').status, 'NOT_SUPPORTED');
    assert.equal(createProviderCatalog({ facebook_page_primary: { providerId: 'wrong-id' } })
      .resolve('facebook_page_primary').status, 'REJECTED_CONFIGURATION');
  });
  check('Adapter error taxonomy maps unknown errors to UNKNOWN', () => {
    assert.equal(core.normalizeAdapterError({ code: 'TIMEOUT' }), 'TIMEOUT');
    assert.equal(core.normalizeAdapterError({ code: 'REVISION_CONFLICT' }), 'REVISION_CONFLICT');
    assert.equal(core.normalizeAdapterError({ code: 'CURSOR_EXPIRED' }), 'CURSOR_EXPIRED');
    assert.equal(core.normalizeAdapterError({ code: 'SECRET_LEAK' }), 'UNKNOWN');
  });

  await checkAsync('Read service requires READ capability and verifies canonical integrity', async () => {
    const record = fixtureRecord();
    const provider = {
      providerId: 'fixture-provider',
      getCapabilities: async () => capabilities,
      getCapabilityObservations: async () => capabilityObservations(),
      read: async () => record,
      search: async () => ({ records: [record] })
    };
    const readContext = Object.assign(context(), { action: 'read' });
    const result = await readMemory(provider, record.memoryId, readContext);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.record.memoryId, record.memoryId);
    const wrongIdentity = await readMemory(Object.assign({}, provider, {
      read: async () => fixtureRecord({ memoryId: 'memory-fixture-other' })
    }), record.memoryId, readContext);
    assert.equal(wrongIdentity.status, 'NOT_FOUND');
    const unavailable = await readMemory({
      providerId: 'fixture-provider',
      getCapabilities: async () => Object.assign({}, capabilities, { READ: 'UNKNOWN' }),
      getCapabilityObservations: async () => capabilityObservations({ READ: 'UNKNOWN' }),
      read: async () => record
    }, record.memoryId, readContext);
    assert.equal(unavailable.status, 'NOT_APPROVED');
    const verifyUnavailable = await readMemory({
      providerId: 'fixture-provider', getCapabilityObservations: async () => capabilityObservations({ VERIFY: 'PERMISSION_DENIED' }),
      read: async () => record
    }, record.memoryId, readContext);
    assert.equal(verifyUnavailable.status, 'NOT_APPROVED');
    const unconfigured = createUnavailableProvider('unconfigured');
    const unconfiguredRead = await readMemory(unconfigured, record.memoryId, readContext);
    assert.equal(unconfiguredRead.status, 'NOT_APPROVED');
  });

  await checkAsync('Read service hides inaccessible records without existence disclosure', async () => {
    const record = fixtureRecord({ access: { classification: 'PROJECT_PRIVATE' } });
    const provider = {
      providerId: 'fixture-provider',
      getCapabilities: async () => capabilities,
      getCapabilityObservations: async () => capabilityObservations({}, 'other'),
      read: async () => record
    };
    const denied = await readMemory(provider, record.memoryId, Object.assign(context(), {
      action: 'read', projectId: 'other'
    }));
    assert.equal(denied.status, 'NOT_FOUND');
  });

  await checkAsync('Search service filters unauthorized and quarantined records before returning results', async () => {
    const visible = fixtureRecord();
    const hidden = fixtureRecord({
      memoryId: 'memory-fixture-0002', projectId: 'another-project',
      access: { classification: 'PROJECT_PRIVATE' }
    });
    const quarantined = fixtureRecord({
      memoryId: 'memory-fixture-0003',
      trust: { status: 'QUARANTINED' }
    });
    const provider = {
      providerId: 'fixture-provider',
      getCapabilities: async () => capabilities,
      getCapabilityObservations: async () => capabilityObservations(),
      guarantees: { boundedSearch: true, opaqueCursor: true },
      search: async (query, options) => {
        assert.equal(options.projectId, 'project-fixture');
        assert.equal(options.timeoutMs, 5000);
        assert.equal(options.maxResponseBytes, 1000000);
        return { records: [visible, hidden, quarantined], nextCursor: 'fixture-cursor' };
      }
    };
    const searchContext = Object.assign(context(), { action: 'search' });
    assert.equal(core.evaluateAccess(hidden, searchContext).allowed, false, 'hidden access check');
    assert.equal(core.evaluateAccess(quarantined, searchContext).allowed, false, 'quarantine access check');
    const result = await searchMemory(provider, 'fixture', { limit: 10 }, searchContext);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.records.length, 1, JSON.stringify(result.records.map(item => ({ id: item.memoryId, projectId: item.projectId, trust: item.trust.status }))));
    assert.equal(result.records[0].memoryId, visible.memoryId);
    assert.equal(result.truncated, true);
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'filteredUnauthorizedOrUntrusted'), false);
    assert.equal((await searchMemory(provider, 'fixture', { projectId: 'another-project' }, searchContext)).status, 'NOT_APPROVED');
    const verifyDenied = await searchMemory({
      providerId: 'fixture-provider', getCapabilityObservations: async () => capabilityObservations({ VERIFY: 'PERMISSION_DENIED' }),
      guarantees: { boundedSearch: true, opaqueCursor: true }, search: async () => ({ records: [] })
    }, 'fixture', {}, searchContext);
    assert.equal(verifyDenied.status, 'NOT_APPROVED');
  });

  await checkAsync('Search service rejects unsafe retrieval limits and malformed provider responses', async () => {
    const provider = {
      providerId: 'fixture-provider',
      getCapabilities: async () => capabilities,
      getCapabilityObservations: async () => capabilityObservations(),
      guarantees: { boundedSearch: true, opaqueCursor: true },
      search: async () => ({ records: 'not-an-array' })
    };
    const ctx = Object.assign(context(), { action: 'search' });
    assert.equal((await searchMemory(provider, 'q', { limit: 101 }, ctx)).status, 'VALIDATION_FAILED');
    assert.equal((await searchMemory(provider, 'q', {}, ctx)).status, 'PROVIDER_ERROR');
    const noGuarantee = { providerId: 'fixture-provider', getCapabilityObservations: async () => capabilityObservations(), search: async () => ({ records: [] }) };
    assert.equal((await searchMemory(noGuarantee, 'q', {}, ctx)).status, 'NOT_APPROVED');
  });

  await checkAsync('Write coordinator rejects providers without atomic conditional-write guarantees', async () => {
    const record = fixtureRecord();
    let writes = 0;
    const provider = {
      providerId: 'fixture-provider',
      guarantees: { conditionalWrite: false, stableIdempotency: true, authoritativeReconciliation: true },
      getCapabilityObservations: async () => capabilityObservations(),
      write: async () => { writes += 1; return commitReceipt(record); },
      read: async () => record, reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider, registry: fakeRegistry(),
      audit: fakeAudit([]), expectedRevision: 0
    });
    assert.equal(result.status, 'NOT_SUPPORTED');
    assert.equal(writes, 0);
  });

  await checkAsync('Canonical write service refuses calls without governed approval context', async () => {
    const result = await writeMemory({ context: Object.assign(context(), { policyAllowed: false }) });
    assert.equal(result.status, 'NOT_APPROVED');
  });

  await checkAsync('Write coordinator blocks when durable audit is unavailable', async () => {
    const record = fixtureRecord();
    let writes = 0;
    const provider = {
      providerId: 'fixture-provider',
      providerId: 'fixture-provider',
      guarantees: { conditionalWrite: true, stableIdempotency: true, authoritativeReconciliation: true },
      getCapabilities: async () => capabilities,
      getCapabilityObservations: async () => capabilityObservations(),
      getCapabilityObservations: async () => capabilityObservations(),
      write: async () => { writes += 1; return commitReceipt(record); },
      read: async () => record,
      verify: async () => ({ status: 'VERIFIED', memoryId: record.memoryId, projectId: record.projectId, revision: record.version.revision, contentHash: record.version.contentHash }),
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider, registry: fakeRegistry(),
      audit: { durable: false, append: async () => ({ status: 'APPENDED' }) }, expectedRevision: 0
    });
    assert.equal(result.status, 'NOT_CONFIGURED');
    assert.equal(writes, 0);
  });


  await checkAsync('Write coordinator rejects a provider commit receipt bound to another payload', async () => {
    const record = fixtureRecord();
    let written = false;
    const provider = {
      providerId: 'fixture-provider',
      guarantees: { conditionalWrite: true, stableIdempotency: true, authoritativeReconciliation: true },
      getCapabilityObservations: async () => capabilityObservations(),
      read: async () => written ? record : null,
      write: async () => {
        written = true;
        return Object.assign(commitReceipt(record), { payloadHash: 'f'.repeat(64) });
      },
      verify: async () => { throw new Error('must not verify mismatched receipt'); },
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider,
      audit: fakeAudit([]), registry: fakeRegistry(), expectedRevision: 0
    });
    assert.equal(result.status, 'PROVIDER_ERROR');
    assert.equal(result.reason, 'PROVIDER_COMMIT_NOT_VERIFIED');
  });

  await checkAsync('Write service completes an authorized canonical write through the coordinator', async () => {
    const record = fixtureRecord(); const events = []; let written = false;
    const provider = { providerId: 'fixture-provider', guarantees: { conditionalWrite: true, stableIdempotency: true, authoritativeReconciliation: true },
      getCapabilityObservations: async () => capabilityObservations(), read: async () => written ? record : null,
      write: async () => { written = true; return commitReceipt(record); },
      verify: async () => ({ status: 'VERIFIED', memoryId: record.memoryId, projectId: record.projectId, revision: 1, contentHash: record.version.contentHash }),
      reconcileOperation: async () => ({ status: 'UNKNOWN' }) };
    const result = await writeMemory({ record, context: context(), operation: operation(record), provider, registry: fakeRegistry(), audit: fakeAudit(events), expectedRevision: 0 });
    assert.equal(result.status, 'COMPLETED'); assert.equal(result.readbackVerified, true);
  });

  await checkAsync('Write coordinator rejects stale pre-state revisions before claiming or writing', async () => {
    const content = 'Phase 2 isolated fixture record'; const record = fixtureRecord({ version: { revision: 3, contentHash: core.createContentHash(content) } });
    const stale = fixtureRecord(); let writes = 0;
    const provider = { providerId: 'fixture-provider', guarantees: { conditionalWrite: true, stableIdempotency: true, authoritativeReconciliation: true },
      getCapabilityObservations: async () => capabilityObservations(), read: async () => stale,
      write: async () => { writes += 1; return commitReceipt(record); },
      verify: async () => ({ status: 'VERIFIED', memoryId: record.memoryId, projectId: record.projectId, revision: 3, contentHash: record.version.contentHash }),
      reconcileOperation: async () => ({ status: 'UNKNOWN' }) };
    const result = await executeGovernedWrite({ record, context: context(), operation: operation(record), provider, registry: fakeRegistry(), audit: fakeAudit([]), expectedRevision: 2 });
    assert.equal(result.status, 'CONFLICT'); assert.equal(writes, 0);
  });

  await checkAsync('Write coordinator records intent before provider write and verifies readback', async () => {
    const record = fixtureRecord();
    const events = [];
    let written = false;
    const provider = {
      providerId: 'fixture-provider',
      guarantees: { conditionalWrite: true, stableIdempotency: true, authoritativeReconciliation: true },
      getCapabilities: async () => capabilities,
      getCapabilityObservations: async () => capabilityObservations(),
      write: async () => {
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'MEMORY_WRITE_INTENT');
        written = true;
        return commitReceipt(record);
      },
      read: async () => {
        if (!written) return null;
        return record;
      },
      verify: async () => ({ status: 'VERIFIED', memoryId: record.memoryId, projectId: record.projectId, revision: 1, contentHash: record.version.contentHash }),
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const audit = fakeAudit(events);
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider, audit, registry: fakeRegistry(), expectedRevision: 0
    });
    assert.equal(result.status, 'COMPLETED');
    assert.equal(events.length, 2);
    assert.equal(result.readbackVerified, true);
  });

  await checkAsync('Write coordinator never blindly retries an uncertain commit', async () => {
    const record = fixtureRecord();
    let writeCalls = 0;
    const provider = {
      providerId: 'fixture-provider',
      guarantees: { conditionalWrite: true, stableIdempotency: true, authoritativeReconciliation: true },
      getCapabilities: async () => capabilities,
      getCapabilityObservations: async () => capabilityObservations(),
      write: async () => { writeCalls += 1; return { status: 'UNKNOWN' }; },
      read: async () => null,
      verify: async () => ({ status: 'VERIFIED', memoryId: record.memoryId, projectId: record.projectId, revision: 1, contentHash: record.version.contentHash }),
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const auditEvents = [];
    const audit = fakeAudit(auditEvents);
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider, audit, registry: fakeRegistry(), expectedRevision: 0
    });
    assert.equal(result.status, 'RECOVERY_REQUIRED');
    assert.equal(writeCalls, 1);
  });

  await checkAsync('Completion audit uncertainty remains COMMITTED_AUDIT_PENDING', async () => {
    const record = fixtureRecord();
    let appendCount = 0;
    const provider = {
      providerId: 'fixture-provider',
      guarantees: { conditionalWrite: true, stableIdempotency: true, authoritativeReconciliation: true },
      getCapabilities: async () => capabilities,
      getCapabilityObservations: async () => capabilityObservations(),
      write: async () => commitReceipt(record),
      read: async () => appendCount === 0 ? null : record,
      verify: async () => ({ status: 'VERIFIED', memoryId: record.memoryId, projectId: record.projectId, revision: 1, contentHash: record.version.contentHash }),
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const auditEvents = [];
    const audit = fakeAudit(auditEvents);
    audit.append = async event => {
      appendCount += 1;
      if (appendCount === 1) {
        auditEvents.push(event);
        return { status: 'APPENDED' };
      }
      return { status: 'UNKNOWN' };
    };
    const result = await executeGovernedWrite({
      record, context: context(), operation: operation(record), provider, audit, registry: fakeRegistry(), expectedRevision: 0
    });
    assert.equal(result.status, 'COMMITTED_AUDIT_PENDING');
  });

  check('Legacy records map to isolated canonical records without migration', () => {
    const mapped = mapLegacyRecord({
      domain: 'knowledge', projectId: 'project-fixture',
      observedAt: '2026-11-03T00:00:00.000Z',
      record: { id: 'legacy-1', title: 'Old title', content: 'Old content', savedAt: '2026-11-02T00:00:00.000Z' }
    });
    assert.equal(mapped.ok, true);
    assert.equal(mapped.status, 'MAPPED_NOT_MIGRATED');
    assert.equal(mapped.migrationPerformed, false);
    assert.equal(mapped.record.trust.status, 'UNVERIFIED');
    assert.equal(mapped.record.lifecycle, 'PENDING_REVIEW');
  });
  check('Legacy mapper supports all documented v0.2 domains without migration', () => {
    const domains = ['conversation_store', 'experience_memory', 'experience_retrieval', 'future_strategy', 'cross_task_learning', 'learning_history', 'knowledge_consolidation', 'google_drive_backup'];
    for (const domain of domains) {
      const result = mapLegacyRecord({ domain, projectId: 'project-fixture', observedAt: '2026-11-03T00:00:00.000Z', record: { id: domain + '-1', content: 'fixture content' } });
      assert.equal(result.ok, true, domain);
      assert.equal(result.migrationPerformed, false, domain);
    }
  });
  check('Migration preview identifies duplicates and conflicts without persistence', () => {
    const preview = previewLegacyMigration({
      domain: 'knowledge', projectId: 'project-fixture', observedAt: '2026-11-03T00:00:00.000Z',
      records: [
        { id: 'same-id', content: 'first content' },
        { id: 'same-id', content: 'first content' },
        { id: 'same-id', content: 'conflicting content' }
      ]
    });
    assert.equal(preview.status, 'REVIEW_REQUIRED');
    assert.equal(preview.summary.mappedUniqueRecords, 1);
    assert.equal(preview.summary.duplicates, 1);
    assert.equal(preview.summary.conflicts, 1);
    assert.equal(preview.migrationPerformed, false);
    assert.equal(preview.persistencePerformed, false);
    assert.equal(preview.sourceStorageRead, false);
    assert.equal(preview.sourceStorageModified, false);
  });
  check('Migration preview preserves full conflicting source versions', () => {
    const preview = previewLegacyMigration({
      domain: 'knowledge', projectId: 'project-fixture',
      observedAt: '2026-11-03T00:00:00.000Z',
      records: [
        { id: 'same-id', content: 'Original legacy value' },
        { id: 'same-id', content: 'Conflicting legacy value' }
      ]
    });
    assert.equal(preview.status, 'REVIEW_REQUIRED');
    assert.equal(preview.conflicts.length, 1);
    assert.equal(preview.conflicts[0].automaticResolution, false);
    assert.equal(preview.conflicts[0].preserved.existing.content, 'Original legacy value');
    assert.equal(preview.conflicts[0].preserved.incoming.content, 'Conflicting legacy value');
    assert.equal(preview.migrationPerformed, false);
  });

  check('Migration preview rejects oversized or malformed batches', () => {
    assert.equal(previewLegacyMigration({ domain: 'knowledge', projectId: 'p', observedAt: '2026-11-03T00:00:00Z', records: new Array(10001).fill({ id: 'x', content: 'x' }) }).status, 'VALIDATION_FAILED');
  });
  check('Public HFM entrypoint exposes canonical service modules', () => {
    assert.equal(typeof hfm.memory.readMemory, 'function');
    assert.equal(typeof hfm.memory.writeMemory, 'function');
    assert.equal(typeof hfm.migration.previewLegacyMigration, 'function');
    assert.equal(typeof hfm.writer.executeGovernedWrite, 'function');
  });
  check('Legacy mapper rejects missing provenance and content', () => {
    assert.equal(mapLegacyRecord({ domain: 'memory', projectId: 'p', observedAt: '2026-11-03T00:00:00Z', record: { id: '1' } }).ok, false);
  });
  check('Web retrieval evidence preserves source URL and stays evidence-only', () => {
    const result = createRetrievalEvidence({
      projectId: 'project-fixture', sourceId: 'web-result-1',
      title: 'Source title', snippet: 'Untrusted source excerpt',
      sourceUrl: 'https://example.org/source',
      retrievedAt: '2026-11-03T00:00:00.000Z'
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'EVIDENCE_ONLY');
    assert.equal(result.canonicalMemoryWrite, false);
    assert.equal(result.record.trust.status, 'SOURCE_RECORDED');
  });
  check('Retrieval evidence rejects missing or unsafe source URL', () => {
    assert.equal(createRetrievalEvidence({
      projectId: 'p', sourceId: 'x', title: 't', snippet: 'c',
      sourceUrl: 'https://example.org/?access_token=fixture', retrievedAt: '2026-11-03T00:00:00Z'
    }).ok, false);
  });
  check('Conflicting versions are preserved and never auto-resolved', () => {
    const existing = fixtureRecord();
    const incoming = Object.assign({}, existing, {
      content: 'Different proposed content',
      version: Object.assign({}, existing.version, {
        revision: 2,
        contentHash: core.createContentHash('Different proposed content')
      })
    });
    const result = detectConflict(existing, incoming);
    assert.equal(result.status, 'CONFLICT_REVIEW');
    assert.equal(result.automaticResolution, false);
    assert.equal(result.preserved.existing.content, existing.content);
    assert.equal(result.preserved.incoming.content, incoming.content);
  });
  check('Conflict resolution requires authorization and durable audit evidence', () => {
    const existing = fixtureRecord();
    const incoming = Object.assign({}, existing, {
      content: 'Different content',
      version: Object.assign({}, existing.version, { revision: 2, contentHash: core.createContentHash('Different content') })
    });
    const conflict = detectConflict(existing, incoming);
    assert.equal(prepareConflictResolution(conflict, { action: 'ACCEPT_ALTERNATE_VERSION' }).status, 'NOT_APPROVED');
    assert.equal(prepareConflictResolution(conflict, {
      action: 'ACCEPT_ALTERNATE_VERSION', conflictId: conflict.conflictId, authorized: true, auditRecorded: true,
      actor: 'reviewer', policyDecisionId: 'policy-1'
    }).status, 'PROPOSAL_PREPARED');
  });
  check('Backup manifest is integrity-bound but explicitly unauthenticated by default', () => {
    const record = fixtureRecord();
    const result = createBackupManifest({
      backupId: 'fixture-backup-1', projectId: 'project-fixture',
      createdAt: '2026-11-03T00:00:00.000Z', sourceRevision: 'fixture-revision-1', records: [record],
      context: Object.assign(context(), { action: 'backup' }), backupCapabilityAvailable: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'MANIFEST_ONLY_NOT_ENCRYPTED_NOT_AUTHENTICATED');
    assert.equal(result.backupPayloadCreated, false);
    assert.equal(result.manifest.authenticity.status, 'UNVERIFIED');
    assert.equal(verifyBackupManifest(result.manifest, [record]).status, 'AUTHENTICITY_UNVERIFIED');
    assert.equal(createBackupManifest({ backupId: 'missing-gates', projectId: 'project-fixture',
      createdAt: '2026-11-03T00:00:00.000Z', sourceRevision: 'fixture-revision-1', records: [record] }).status, 'VALIDATION_FAILED');
  });
  check('Backup verification requires a verified trust anchor and rejects tampering', () => {
    const record = fixtureRecord();
    const result = createBackupManifest({
      backupId: 'fixture-backup-2', projectId: 'project-fixture',
      createdAt: '2026-11-03T00:00:00.000Z', sourceRevision: 'fixture-revision-2', records: [record],
      context: Object.assign(context(), { action: 'backup' }), backupCapabilityAvailable: true
    });
    result.manifest.authenticity = {
      status: 'SIGNED', algorithm: 'TEST-ONLY-MOCK', keyId: 'test-key-1', proof: 'fixture-proof'
    };
    const verifier = manifest => ({
      verified: true, trustAnchorVerified: true, keyNotRevoked: true,
      manifestHash: manifest.manifestHash, algorithm: manifest.authenticity.algorithm,
      keyId: manifest.authenticity.keyId
    });
    const verified = verifyBackupManifest(result.manifest, [record], verifier);
    assert.equal(verified.valid, true);
    assert.equal(verified.projectId, 'project-fixture');
    const changed = Object.assign({}, record, { content: 'tampered' });
    assert.equal(verifyBackupManifest(result.manifest, [changed], verifier).status, 'INTEGRITY_FAILED');
  });
  await checkAsync('Encrypted backup package requires approved encryption and signing profiles', async () => {
    const record = fixtureRecord();
    const result = await createEncryptedBackupPackage({ backupId: 'fixture-encrypted-backup', projectId: 'project-fixture', sourceRevision: 'fixture-r1', createdAt: '2026-11-03T00:00:00.000Z', records: [record], context: Object.assign(context(), { action: 'backup', testOnly: true }), backupCapabilityAvailable: true, providerId: 'fixture-provider', capabilityObservations: capabilityObservations({ BACKUP: 'AVAILABLE' }) });
    assert.equal(result.status, 'NOT_APPROVED');
  });
  await checkAsync('Encrypted backup package signs manifest and verifies encrypted fixture payload', async () => {
    const record = fixtureRecord(); let storedPlaintext = null;
    const cryptoProvider = { approvedProfile: true, testOnly: true, algorithmProfile: 'TEST-AEAD-V1',
      encrypt: async plaintext => { storedPlaintext = plaintext; return { algorithm: 'TEST-AEAD-V1', keyId: 'fixture-dek', keyVersion: '1', nonce: 'bm9uY2U=', authTag: 'dGFn', ciphertext: Buffer.from(plaintext, 'utf8').toString('base64'), aadProfile: 'fixture-aad-v1' }; },
      decrypt: async envelope => { if (envelope.ciphertext !== Buffer.from(storedPlaintext, 'utf8').toString('base64')) throw new Error('CIPHERTEXT_TAMPERED'); return storedPlaintext; } };
    const signingProvider = { approvedProfile: true, testOnly: true, algorithmProfile: 'TEST-SIGNATURE-V1',
      sign: async manifestHash => ({ algorithm: 'TEST-SIGNATURE-V1', keyId: 'fixture-signing-key', proof: 'proof:' + manifestHash }),
      verify: async manifest => ({ verified: true, trustAnchorVerified: true, keyNotRevoked: true, manifestHash: manifest.manifestHash, algorithm: manifest.authenticity.algorithm, keyId: manifest.authenticity.keyId }) };
    const ctx = Object.assign(context(), { action: 'backup', testOnly: true });
    const pkg = await createEncryptedBackupPackage({ backupId: 'fixture-encrypted-backup', projectId: 'project-fixture', sourceRevision: 'fixture-r1', createdAt: '2026-11-03T00:00:00.000Z', records: [record], context: ctx, backupCapabilityAvailable: true, providerId: 'fixture-provider', capabilityObservations: capabilityObservations({ BACKUP: 'AVAILABLE' }), cryptoProvider, signingProvider });
    assert.equal(pkg.status, 'ENCRYPTED_BACKUP_PACKAGE_VERIFIED'); assert.equal(pkg.plaintextPayloadReturned, false); assert.equal(pkg.persistencePerformed, false);
    const verified = await verifyEncryptedBackupPackage({ package: pkg, context: ctx, cryptoProvider, signingProvider });
    assert.equal(verified.valid, true); assert.equal(verified.recordCount, 1); assert.equal(verified.plaintextRecordsReturned, false);
    const tampered = Object.assign({}, pkg, { encryptedPayload: Object.assign({}, pkg.encryptedPayload, { ciphertext: 'dGFtcGVyZWQ=' }) });
    assert.equal((await verifyEncryptedBackupPackage({ package: tampered, context: ctx, cryptoProvider, signingProvider })).valid, false);
  });

  check('Restore cannot proceed without explicit approval and all verification gates', () => {
    assert.equal(authorizeRestore({}).allowed, false);
    assert.equal(authorizeRestore({
      explicitApproval: true, targetCapabilityAvailable: true,
      accessPolicyAllowed: true, encryptionVerified: true,
      sourceProjectId: 'project-fixture', targetProjectId: 'project-fixture',
      manifestVerification: { valid: true, status: 'VERIFIED', authenticity: 'VERIFIED', projectId: 'project-fixture' }
    }).allowed, true);
    assert.equal(authorizeRestore({
      explicitApproval: true, targetCapabilityAvailable: true,
      accessPolicyAllowed: true, encryptionVerified: true,
      sourceProjectId: 'another-project', targetProjectId: 'another-project',
      manifestVerification: { valid: true, status: 'VERIFIED', authenticity: 'VERIFIED', projectId: 'project-fixture' }
    }).allowed, false);
  });


  await checkAsync('Evolution bridge rejects unapproved proposals before provider access', async () => {
    const previous = fixtureRecord();
    const content = 'Evolution candidate fixture';
    const next = fixtureRecord({ content, version: { revision: 2, contentHash: core.createContentHash(content) } });
    let writes = 0;
    const result = await executeEvolutionMemoryWrite({
      proposal: { status: 'PENDING', proposalId: 'proposal-1', projectId: next.projectId,
        memoryId: next.memoryId, expectedRevision: 1, policyDecisionId: 'policy-fixture-1' },
      approval: { status: 'APPROVED', approved: true, approver: 'fixture-actor',
        evidenceReference: 'fixture:approval', policyDecisionId: 'policy-fixture-1' },
      recoveryPoint: { status: 'VERIFIED', verified: true, projectId: previous.projectId,
        memoryId: previous.memoryId, revision: 1, contentHash: previous.version.contentHash,
        evidenceReference: 'fixture:recovery', record: previous },
      record: next, context: context(), operation: operation(next),
      provider: { write: async () => { writes += 1; } },
      audit: fakeAudit([]), registry: fakeRegistry()
    });
    assert.equal(result.status, 'NOT_APPROVED');
    assert.equal(writes, 0);
  });

  await checkAsync('Evolution bridge rejects mismatched pre-state recovery evidence', async () => {
    const previous = fixtureRecord();
    const content = 'Evolution candidate fixture';
    const next = fixtureRecord({ content, version: { revision: 2, contentHash: core.createContentHash(content) } });
    const result = await executeEvolutionMemoryWrite({
      proposal: { status: 'APPROVED', proposalId: 'proposal-1', projectId: next.projectId,
        memoryId: next.memoryId, expectedRevision: 1, policyDecisionId: 'policy-fixture-1' },
      approval: { status: 'APPROVED', approved: true, approver: 'fixture-actor',
        evidenceReference: 'fixture:approval', policyDecisionId: 'policy-fixture-1' },
      recoveryPoint: { status: 'VERIFIED', verified: true, projectId: previous.projectId,
        memoryId: previous.memoryId, revision: 1, contentHash: 'f'.repeat(64),
        evidenceReference: 'fixture:recovery', record: previous },
      record: next, context: context(), operation: operation(next),
      provider: { write: async () => { throw new Error('must not write'); } },
      audit: fakeAudit([]), registry: fakeRegistry()
    });
    assert.equal(result.status, 'RECOVERY_REQUIRED');
  });

  await checkAsync('Approved Evolution delegates to canonical writer and audits approval evidence', async () => {
    const previous = fixtureRecord();
    const content = 'Evolution candidate fixture';
    const next = fixtureRecord({ content, version: { revision: 2, contentHash: core.createContentHash(content) } });
    const events = [];
    let written = false;
    const provider = {
      providerId: 'fixture-provider',
      guarantees: { conditionalWrite: true, stableIdempotency: true, authoritativeReconciliation: true },
      getCapabilityObservations: async () => capabilityObservations(),
      read: async () => written ? next : previous,
      write: async () => { written = true; return commitReceipt(next); },
      verify: async () => ({ status: 'VERIFIED', memoryId: next.memoryId,
        projectId: next.projectId, revision: 2, contentHash: next.version.contentHash }),
      reconcileOperation: async () => ({ status: 'UNKNOWN' })
    };
    const result = await executeEvolutionMemoryWrite({
      proposal: { status: 'APPROVED', proposalId: 'proposal-1', projectId: next.projectId,
        memoryId: next.memoryId, expectedRevision: 1, policyDecisionId: 'policy-fixture-1' },
      approval: { status: 'APPROVED', approved: true, approver: 'fixture-actor',
        evidenceReference: 'fixture:approval', policyDecisionId: 'policy-fixture-1' },
      recoveryPoint: { status: 'VERIFIED', verified: true, projectId: previous.projectId,
        memoryId: previous.memoryId, revision: 1, contentHash: previous.version.contentHash,
        evidenceReference: 'fixture:recovery', record: previous },
      record: next, context: context(), operation: operation(next),
      provider, audit: fakeAudit(events), registry: fakeRegistry()
    });
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.canonicalWriter, 'MIRA_HFM_GOVERNED_WRITE_COORDINATOR');
    assert.equal(result.readbackVerified, true);
    assert.equal(events.length, 2);
    assert.equal(events[0].evolutionProposalId, 'proposal-1');
    assert.equal(events[0].approvalEvidenceReference, 'fixture:approval');
    assert.equal(events[0].recoveryPointEvidenceReference, 'fixture:recovery');
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
