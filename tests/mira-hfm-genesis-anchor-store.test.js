'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256Canonical, CANONICALIZATION_PROFILE, HASH_ALGORITHM } = require('../services/mira-audit-chain-independent-verifier');
const { createGenesisAnchor, verifyGenesisAnchor } = require('../services/mira-hfm-genesis-anchor-store');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-genesis-'));
const timestamp = '2026-11-04T00:00:00.000Z';
const genesisBase = {
  genesisSchemaVersion: '1.0.0', genesisId: 'genesis-project-a-chain-a',
  projectId: 'project-a', chainId: 'chain-a', initialSequence: 0,
  canonicalizationProfile: CANONICALIZATION_PROFILE, hashAlgorithm: HASH_ALGORITHM,
  createdAt: timestamp, createdBy: 'fixture-authority'
};
const genesis = { ...genesisBase, genesisHash: '' };
genesis.genesisHash = sha256Canonical(genesis, 'genesisHash');
const audit = [];
const auditWriter = event => audit.push(event);
try {
  assert.throws(() => createGenesisAnchor({
    root, genesis, projectId: 'project-a', chainId: 'chain-a',
    trustedGenesisHash: genesis.genesisHash, trustAnchorId: 'pin-001',
    authorityReference: 'AUTH-001', authorizedBy: 'fixture-admin',
    authorizeCreate: () => false, auditWriter
  }), /authorization denied/);
  console.log('GENESIS_CREATION_REQUIRES_EXPLICIT_AUTHORIZATION=PASS');

  assert.throws(() => createGenesisAnchor({
    root, genesis, projectId: 'project-a', chainId: 'chain-a',
    trustedGenesisHash: '0'.repeat(64), trustAnchorId: 'pin-001',
    authorityReference: 'AUTH-001', authorizedBy: 'fixture-admin',
    authorizeCreate: () => true, auditWriter
  }), /trusted genesis hash mismatch/);
  console.log('GENESIS_TRUST_PIN_MUST_MATCH=PASS');

  const created = createGenesisAnchor({
    root, genesis, projectId: 'project-a', chainId: 'chain-a',
    trustedGenesisHash: genesis.genesisHash, trustAnchorId: 'pin-001',
    authorityReference: 'AUTH-001', authorizedBy: 'fixture-admin',
    authorizeCreate: () => true, auditWriter
  });
  assert.equal(created.status, 'CREATED_PINNED_HASH_ONLY');
  console.log('IMMUTABLE_GENESIS_ANCHOR_CREATED=PASS');

  assert.equal(verifyGenesisAnchor({
    root, projectId: 'project-a', chainId: 'chain-a', trustedGenesisHash: genesis.genesisHash
  }).status, 'VERIFIED_PINNED_HASH_ONLY');
  console.log('GENESIS_ANCHOR_VERIFIED_AGAINST_EXTERNAL_PIN=PASS');

  const storedFile = path.join(root, fs.readdirSync(root).find(name => name.endsWith('.json')));
  const storedEnvelope = JSON.parse(fs.readFileSync(storedFile, 'utf8'));
  storedEnvelope.authorityReference = 'TAMPERED-AUTHORITY-REF';
  fs.writeFileSync(storedFile, JSON.stringify(storedEnvelope, null, 2) + '\\n');
  assert.throws(() => verifyGenesisAnchor({
    root, projectId: 'project-a', chainId: 'chain-a', trustedGenesisHash: genesis.genesisHash
  }), /envelope scope or schema mismatch/);
  console.log('GENESIS_AUTHORITY_METADATA_TAMPER_DETECTED=PASS');

  fs.writeFileSync(storedFile, JSON.stringify({
    ...storedEnvelope, authorityReference: 'AUTH-001',
    anchorRecordHash: storedEnvelope.anchorRecordHash
  }, null, 2) + '\\n');

  assert.throws(() => createGenesisAnchor({
    root, genesis, projectId: 'project-a', chainId: 'chain-a',
    trustedGenesisHash: genesis.genesisHash, trustAnchorId: 'pin-001',
    authorityReference: 'AUTH-001', authorizedBy: 'fixture-admin',
    authorizeCreate: () => true, auditWriter
  }), /already exists/);
  console.log('GENESIS_ANCHOR_APPEND_ONLY=PASS');

  assert.throws(() => verifyGenesisAnchor({
    root, projectId: 'project-b', chainId: 'chain-a', trustedGenesisHash: genesis.genesisHash
  }), /ENOENT/);
  console.log('CROSS_PROJECT_GENESIS_LOOKUP_ISOLATED=PASS');

  const file = fs.readdirSync(root).find(name => name.endsWith('.json'));
  fs.writeFileSync(path.join(root, file), '{"tampered":true}\n');
  assert.throws(() => verifyGenesisAnchor({
    root, projectId: 'project-a', chainId: 'chain-a', trustedGenesisHash: genesis.genesisHash
  }));
  console.log('GENESIS_ANCHOR_TAMPER_DETECTED=PASS');

  assert.ok(audit.some(x => x.action === 'hfm_genesis_anchor_create_intent'));
  assert.ok(audit.some(x => x.action === 'hfm_genesis_anchor_create_committed'));
  console.log('GENESIS_CREATE_AUDIT_INTENT_AND_COMMIT=PASS');

  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_GENESIS_ANCHOR_STORE_ISOLATED_PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
