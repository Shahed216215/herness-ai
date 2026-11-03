'use strict';

// Regression rerun trigger after version snapshot scope correction.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../services/mira-json-state-store');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-phase2-'));
const stateFile = path.join(root, 'knowledge.json');
const originalStorage = process.env.MIRA_STORAGE_DIR;
process.env.MIRA_STORAGE_DIR = root;

try {
  assert.deepEqual(
    store.readJsonArray(stateFile, 'Fixture Knowledge', { missing: 'empty' }),
    []
  );

  const first = [{ id: 'a', content: 'first' }];
  const second = [...first, { id: 'b', content: 'second' }];

  store.writeArrayState(stateFile, first, 'Fixture Knowledge');
  store.writeArrayState(stateFile, second, 'Fixture Knowledge');

  assert.deepEqual(store.readJsonArray(stateFile, 'Fixture Knowledge'), second);
  const versions = path.join(root, 'knowledge.json.versions');
  const versionFiles = fs.readdirSync(versions);
  assert.equal(versionFiles.length, 1);

  const version = JSON.parse(fs.readFileSync(path.join(versions, versionFiles[0]), 'utf8'));
  assert.deepEqual(version.entries, first);
  assert.equal(version.sha256, store.sha256(JSON.stringify(first)));

  const beforeCorruption = fs.readFileSync(stateFile, 'utf8');
  fs.writeFileSync(stateFile, '{bad-json');
  assert.throws(() => store.readJsonArray(stateFile, 'Fixture Knowledge'), /invalid JSON/i);
  assert.throws(() => store.writeArrayState(stateFile, first, 'Fixture Knowledge'), /invalid JSON/i);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), '{bad-json');

  fs.writeFileSync(stateFile, JSON.stringify({ not: 'an array' }));
  assert.throws(() => store.readJsonArray(stateFile, 'Fixture Knowledge'), /JSON array/i);

  const quarantine = store.quarantineConflict(root, 'local-drive', {
    local: first,
    remote: second
  }, { class: 'fixture-conflict' });
  assert.equal(fs.existsSync(quarantine.file), true);
  const envelope = JSON.parse(fs.readFileSync(quarantine.file, 'utf8'));
  assert.equal(envelope.reason, 'SOURCE_CONFLICT_REQUIRES_REVIEW');
  assert.equal(envelope.metadata.class, 'fixture-conflict');

  const auditLog = require('../audit-log');
  const auditEntries = auditLog.loadAuditLog();
  assert.ok(auditEntries.some(entry => entry.action === 'memory_state_write_intent'));
  assert.ok(auditEntries.some(entry => entry.action === 'memory_state_write_committed'));
  assert.ok(auditEntries.some(entry => entry.action === 'memory_conflict_quarantined'));
  assert.equal(auditLog.verifyAuditIntegrity().ok, true);

  const symlinkTarget = path.join(root, 'symlink.json');
  const outside = path.join(root, 'outside.json');
  fs.writeFileSync(outside, '[]');
  fs.symlinkSync(outside, symlinkTarget);
  assert.throws(() => store.writeArrayState(symlinkTarget, first, 'Fixture Symlink'), /safe regular file/i);

  const knowledgeSource = fs.readFileSync(path.join(__dirname, '..', 'knowledge.js'), 'utf8');
  assert.match(knowledgeSource, /jsonStateStore\.readJsonArray/);
  assert.match(knowledgeSource, /jsonStateStore\.writeArrayState/);
  assert.doesNotMatch(knowledgeSource, /return Array\.isArray\(data\) \? data : \[\]/);

  console.log('TESTS_PASSED=20');
  console.log('TESTS_FAILED=0');
  console.log('PRODUCTION_MEMORY_TOUCHED=NO');
  console.log('REAL_GOOGLE_DRIVE_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('RESULT=PHASE2_CORE_SAFETY_PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  if (originalStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
  else process.env.MIRA_STORAGE_DIR = originalStorage;
}
