'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-work-knowledge-store-'));
const priorStorage = process.env.MIRA_STORAGE_DIR;
const priorAudit = process.env.MIRA_AUDIT_FILE;
process.env.MIRA_STORAGE_DIR = path.join(temp, 'storage');
process.env.MIRA_AUDIT_FILE = path.join(temp, 'audit.json');

for (const request of [
  '../mira-storage',
  '../services/mira-json-state-store',
  '../services/mira-work-knowledge-consolidation'
]) {
  try { delete require.cache[require.resolve(request)]; } catch {}
}

try {
  const engine = require('../services/mira-work-knowledge-consolidation');
  const file = engine.STORE_FILE;

  const missing = engine.loadStore();
  assert.deepEqual(missing.items, []);
  assert.throws(() => engine.saveStore({ schemaVersion: 1 }), /must include an items array/);
  console.log('MISSING_CONSOLIDATION_STORE_IS_EMPTY_FIRST_RUN=PASS');

  const saved = engine.saveStore({
    schemaVersion: 1,
    engineVersion: engine.ENGINE_VERSION,
    items: [{ id: 'fixture-1', lesson: 'preserve this evidence' }]
  });
  assert.equal(engine.loadStore().items[0].id, 'fixture-1');
  assert.equal(engine.verifyStoreIntegrity().valid, true);
  assert.ok(fs.statSync(file).mode & 0o100000);
  console.log('CONSOLIDATION_STORE_ATOMIC_WRITE_AND_READBACK=PASS');

  const overflow = Array.from({ length: 5001 }, (_, index) => ({ id: index }));
  assert.throws(() => engine.saveStore({ schemaVersion: 1, items: overflow }), /exceeds the supported item limit/);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, items: overflow }), 'utf8');
  assert.throws(() => engine.loadStore(), /exceeds the supported item limit/);
  console.log('OVERCAPACITY_STORE_REJECTED_WITHOUT_TRUNCATION=PASS');

  fs.writeFileSync(file, '{broken json', 'utf8');
  assert.throws(() => engine.loadStore(), /contains invalid JSON/);
  console.log('CORRUPT_JSON_FAILS_CLOSED=PASS');

  fs.writeFileSync(file, '   ', 'utf8');
  assert.throws(() => engine.loadStore(), /empty and may be corrupted/);
  console.log('EMPTY_EXISTING_STORE_FAILS_CLOSED=PASS');

  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1, items: [], integrityHash: 'f'.repeat(64)
  }), 'utf8');
  assert.throws(() => engine.loadStore(), /integrity check failed/);
  console.log('INTEGRITY_MISMATCH_FAILS_CLOSED=PASS');

  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1 }), 'utf8');
  assert.throws(() => engine.loadStore(), /object with an items array/);
  console.log('INVALID_STORE_SHAPE_FAILS_CLOSED=PASS');

  fs.unlinkSync(file);
  const target = path.join(temp, 'symlink-target.json');
  fs.writeFileSync(target, JSON.stringify(saved), 'utf8');
  fs.symlinkSync(target, file);
  assert.throws(() => engine.loadStore(), /not a safe regular file/);
  assert.throws(() => engine.verifyStoreIntegrity(), /not a safe regular file/);
  assert.throws(() => engine.saveStore({ items: [] }), /not a safe regular file/);
  console.log('SYMLINKED_STORE_READ_VERIFY_AND_WRITE_REJECTED=PASS');
  console.log('INVALID_SAVE_SHAPE_REJECTED=PASS');

  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_WORK_KNOWLEDGE_STORE_FAIL_CLOSED_PASS');
} catch (error) {
  console.error(error);
  console.log('TESTS_FAILED=1');
  console.log('RESULT=MIRA_WORK_KNOWLEDGE_STORE_FAIL_CLOSED_FAIL');
  process.exitCode = 1;
} finally {
  if (priorStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
  else process.env.MIRA_STORAGE_DIR = priorStorage;
  if (priorAudit === undefined) delete process.env.MIRA_AUDIT_FILE;
  else process.env.MIRA_AUDIT_FILE = priorAudit;
  fs.rmSync(temp, { recursive: true, force: true });
}
