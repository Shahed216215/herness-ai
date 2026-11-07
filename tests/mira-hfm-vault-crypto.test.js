'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const {
  createVaultEnvelope,
  decryptVaultEnvelope,
  createVaultDigestCandidates
} = require('../services/mira-hfm-vault-crypto');

const env = Object.freeze({
  MIRA_VAULT_ACTIVE_KEK_VERSION: 'v1',
  MIRA_VAULT_KEK_V1: crypto.randomBytes(32).toString('base64')
});
const context = Object.freeze({
  recordId: 'vault-record-001',
  ownerId: 'mira:owner-001',
  projectId: 'project-001',
  recordType: 'client_vault_record',
  classification: 'RESTRICTED',
  schemaVersion: '1.1.0'
});
const record = Object.freeze({
  clientName: 'Synthetic Test Client',
  phone: '+8801000000000',
  work: 'Synthetic confidential work description',
  transaction: { amount: '12345.67', currency: 'BDT' }
});

test('vault envelope encrypts the complete payload and round-trips with the same context', () => {
  const envelope = createVaultEnvelope({ record, context, env });
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes(record.clientName), false);
  assert.equal(serialized.includes(record.phone), false);
  assert.equal(serialized.includes(record.work), false);
  assert.equal(envelope.algorithm, 'AES-256-GCM');
  assert.deepEqual(decryptVaultEnvelope({ envelope, context, env }), record);
});

test('vault envelope uses fresh data keys and nonces for every encryption', () => {
  const first = createVaultEnvelope({ record, context, env });
  const second = createVaultEnvelope({ record, context, env });
  assert.notEqual(first.payload.nonce, second.payload.nonce);
  assert.notEqual(first.wrappedDek.nonce, second.wrappedDek.nonce);
  assert.notEqual(first.payload.ciphertext, second.payload.ciphertext);
});

test('wrong owner, project, record, type, or schema context fails authentication', () => {
  const envelope = createVaultEnvelope({ record, context, env });
  const changes = [
    { ownerId: 'mira:other-owner' },
    { projectId: 'other-project' },
    { recordId: 'other-record' },
    { classification: 'PROJECT_PRIVATE' },
    { recordType: 'knowledge_item' },
    { schemaVersion: '1.0.0' }
  ];
  for (const change of changes) {
    assert.throws(
      () => decryptVaultEnvelope({
        envelope,
        context: { ...context, ...change },
        env
      }),
      error => error.code === 'MIRA_VAULT_AUTHENTICATION_FAILED'
    );
  }
});

test('missing, malformed, or unversioned key configuration fails closed', () => {
  const envelope = createVaultEnvelope({ record, context, env });
  assert.throws(
    () => createVaultEnvelope({ record, context, env: {} }),
    error => error.code === 'MIRA_VAULT_ACTIVE_KEY_VERSION_MISSING'
  );
  assert.throws(
    () => decryptVaultEnvelope({ envelope, context, env: {} }),
    error => error.code === 'MIRA_VAULT_KEY_MISSING'
  );
  assert.throws(
    () => createVaultEnvelope({
      record,
      context,
      env: { MIRA_VAULT_ACTIVE_KEK_VERSION: 'v1', MIRA_VAULT_KEK_V1: 'not-a-valid-key' }
    }),
    error => error.code === 'MIRA_VAULT_KEY_INVALID'
  );
});

test('tampered ciphertext and malformed envelope fail closed', () => {
  const envelope = createVaultEnvelope({ record, context, env });
  const tampered = {
    ...envelope,
    payload: {
      ...envelope.payload,
      ciphertext: Buffer.from('tampered').toString('base64')
    }
  };
  assert.throws(
    () => decryptVaultEnvelope({ envelope: tampered, context, env }),
    error => error.code === 'MIRA_VAULT_AUTHENTICATION_FAILED'
  );
  assert.throws(
    () => decryptVaultEnvelope({
      envelope: { ...envelope, algorithm: 'AES-128-CBC' },
      context,
      env
    }),
    error => error.code === 'MIRA_VAULT_ENVELOPE_INVALID'
  );
});



test('project-private daily and social records can also be encrypted at rest', () => {
  const privateContext = { ...context, classification: 'PROJECT_PRIVATE', recordType: 'social_post_draft' };
  const envelope = createVaultEnvelope({ record: { title: 'Synthetic draft', body: 'Safe public content' }, context: privateContext, env });
  assert.deepEqual(
    decryptVaultEnvelope({ envelope, context: privateContext, env }),
    { title: 'Synthetic draft', body: 'Safe public content' }
  );
});

test('versioned KEKs allow old records to decrypt while new writes use the active version', () => {
  const oldEnvelope = createVaultEnvelope({ record, context, env });
  const rotatedEnv = {
    MIRA_VAULT_ACTIVE_KEK_VERSION: 'v2',
    MIRA_VAULT_KEK_V1: env.MIRA_VAULT_KEK_V1,
    MIRA_VAULT_KEK_V2: crypto.randomBytes(32).toString('base64')
  };
  const newEnvelope = createVaultEnvelope({ record, context, env: rotatedEnv });
  assert.equal(oldEnvelope.keyVersion, 'v1');
  assert.equal(newEnvelope.keyVersion, 'v2');
  assert.deepEqual(decryptVaultEnvelope({ envelope: oldEnvelope, context, env: rotatedEnv }), record);
  assert.deepEqual(decryptVaultEnvelope({ envelope: newEnvelope, context, env: rotatedEnv }), record);
});

test('private idempotency digests are keyed and reconcilable across KEK rotation', () => {
  const canonical = JSON.stringify({ content: 'low-entropy private phrase' });
  const first = createVaultDigestCandidates(canonical, env);
  const same = createVaultDigestCandidates(canonical, env);
  assert.equal(first.activeDigest, same.activeDigest);
  assert.equal(first.activeDigest.length, 64);
  assert.notEqual(first.activeDigest, crypto.createHash('sha256').update(canonical).digest('hex'));
  const rotated = {
    MIRA_VAULT_ACTIVE_KEK_VERSION: 'v2',
    MIRA_VAULT_KEK_V1: env.MIRA_VAULT_KEK_V1,
    MIRA_VAULT_KEK_V2: crypto.randomBytes(32).toString('base64')
  };
  const afterRotation = createVaultDigestCandidates(canonical, rotated);
  assert.notEqual(afterRotation.activeDigest, first.activeDigest);
  assert.ok(afterRotation.candidates.includes(first.activeDigest));
});

test('vault rejects PUBLIC contexts and non-object records', () => {
  assert.throws(
    () => createVaultEnvelope({
      record,
      context: { ...context, classification: 'PUBLIC' },
      env
    }),
    error => error.code === 'MIRA_VAULT_CONTEXT_CLASSIFICATION_INVALID'
  );
  assert.throws(
    () => createVaultEnvelope({ record: 'plaintext', context, env }),
    error => error.code === 'MIRA_VAULT_RECORD_INVALID'
  );
});
