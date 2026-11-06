'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-work-learning-store-'));
const learningFile = path.join(temp, 'storage', 'work-learning-records.json');
const priorLearning = process.env.MIRA_LEARNING_FILE;
const priorAudit = process.env.MIRA_AUDIT_FILE;
process.env.MIRA_LEARNING_FILE = learningFile;
process.env.MIRA_AUDIT_FILE = path.join(temp, 'audit.json');

for (const request of [
  '../services/mira-json-state-store',
  '../services/mira-work-learning-engine'
]) {
  try { delete require.cache[require.resolve(request)]; } catch {}
}

try {
  const engine = require('../services/mira-work-learning-engine');

  assert.deepEqual(engine.loadStore().records, []);
  engine.ensureStore();
  assert.equal(engine.loadStore().records.length, 0);
  assert.equal(fs.existsSync(engine.INITIALIZATION_FILE), true);
  console.log('MISSING_WORK_LEARNING_STORE_FIRST_RUN=PASS');
  console.log('WORK_LEARNING_INITIALIZATION_MARKER_CREATED=PASS');

  const initialRecords = Array.from(
    { length: engine.MAX_RECORDS },
    (_, index) => ({ learningId: `old-${index}`, value: index })
  );
  engine.saveStore({ version: 1, records: initialRecords });
  assert.equal(engine.loadStore().records.length, engine.MAX_RECORDS);
  assert.ok(fs.statSync(learningFile).mode & 0o100000);
  const auditEntries = JSON.parse(fs.readFileSync(process.env.MIRA_AUDIT_FILE, 'utf8'));
  assert.ok(auditEntries.some(entry =>
    entry.action === 'work_learning_store_write_committed' &&
    entry.status === 'success'
  ));
  console.log('WORK_LEARNING_STORE_ATOMIC_WRITE=PASS');
  console.log('WORK_LEARNING_STORE_COMMIT_AUDIT=PASS');

  engine.persistLearningRecord({ learningId: 'newest-record' });
  const afterCapacity = engine.loadStore();
  assert.equal(afterCapacity.records.length, engine.MAX_RECORDS);
  assert.equal(afterCapacity.records[0].learningId, 'old-1');
  assert.equal(afterCapacity.records.at(-1).learningId, 'newest-record');
  const quarantineDir = path.join(path.dirname(learningFile), 'memory-conflicts');
  const quarantined = fs.readdirSync(quarantineDir).filter(name => name.endsWith('.json'));
  assert.equal(quarantined.length, 1);
  const envelope = JSON.parse(fs.readFileSync(path.join(quarantineDir, quarantined[0]), 'utf8'));
  assert.equal(envelope.reason, 'WORK_LEARNING_CAPACITY_EVICTION');
  assert.equal(envelope.payload[0].learningId, 'old-0');
  console.log('WORK_LEARNING_CAPACITY_EVICTION_PRESERVED_BEFORE_COMMIT=PASS');

  const overflow = Array.from({ length: engine.MAX_RECORDS + 1 }, (_, index) => ({ learningId: `overflow-${index}` }));
  assert.throws(() => engine.saveStore({ records: overflow }), /exceeds the supported record limit/);
  fs.writeFileSync(learningFile, JSON.stringify({ version: 1, records: overflow }), 'utf8');
  assert.throws(() => engine.loadStore(), /exceeds the supported record limit/);
  console.log('WORK_LEARNING_OVERFLOW_REJECTED_WITHOUT_TRUNCATION=PASS');

  fs.writeFileSync(learningFile, '{bad json', 'utf8');
  const corruptBytes = fs.readFileSync(learningFile, 'utf8');
  assert.throws(() => engine.loadStore(), /contains invalid JSON/);
  assert.throws(() => engine.saveStore({ version: 1, records: [] }), /contains invalid JSON/);
  assert.equal(fs.readFileSync(learningFile, 'utf8'), corruptBytes);
  console.log('WORK_LEARNING_CORRUPT_JSON_FAILS_CLOSED=PASS');
  console.log('WORK_LEARNING_DIRECT_SAVE_CANNOT_OVERWRITE_CORRUPT=PASS');

  fs.writeFileSync(learningFile, ' ', 'utf8');
  const emptyBytes = fs.readFileSync(learningFile, 'utf8');
  assert.throws(() => engine.loadStore(), /empty and may be corrupted/);
  assert.throws(() => engine.saveStore({ version: 1, records: [] }), /empty and may be corrupted/);
  assert.equal(fs.readFileSync(learningFile, 'utf8'), emptyBytes);
  console.log('WORK_LEARNING_EMPTY_EXISTING_STORE_FAILS_CLOSED=PASS');
  console.log('WORK_LEARNING_DIRECT_SAVE_CANNOT_OVERWRITE_EMPTY=PASS');

  fs.writeFileSync(learningFile, JSON.stringify({ version: 1, records: {} }), 'utf8');
  assert.throws(() => engine.loadStore(), /object with a records array/);
  console.log('WORK_LEARNING_INVALID_SHAPE_FAILS_CLOSED=PASS');

  fs.unlinkSync(learningFile);
  const target = path.join(temp, 'target.json');
  fs.writeFileSync(target, JSON.stringify({ version: 1, records: [] }), 'utf8');
  fs.symlinkSync(target, learningFile);
  assert.throws(() => engine.loadStore(), /not a safe regular file/);
  assert.throws(() => engine.saveStore({ records: [] }), /not a safe regular file/);
  assert.throws(() => engine.ensureStore(), /not a safe regular file/);
  console.log('WORK_LEARNING_SYMLINK_READ_WRITE_REJECTED=PASS');

  fs.unlinkSync(learningFile);
  assert.throws(() => engine.loadStore(), /previously initialized/i);
  assert.throws(() => engine.saveStore({ version: 1, records: [] }), /previously initialized/i);
  assert.throws(() => engine.ensureStore(), /previously initialized/i);
  console.log('WORK_LEARNING_MISSING_PRIMARY_FAILS_CLOSED=PASS');

  const marker = JSON.parse(fs.readFileSync(engine.INITIALIZATION_FILE, 'utf8'));
  marker.sha256 = '0'.repeat(64);
  fs.writeFileSync(engine.INITIALIZATION_FILE, JSON.stringify(marker), { mode: 0o600 });
  assert.throws(() => engine.loadStore(), /initialization marker integrity/i);
  console.log('WORK_LEARNING_MARKER_TAMPER_FAILS_CLOSED=PASS');

  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_WORK_LEARNING_STORE_FAIL_CLOSED_PASS');
} catch (error) {
  console.error(error);
  console.log('TESTS_FAILED=1');
  console.log('RESULT=MIRA_WORK_LEARNING_STORE_FAIL_CLOSED_FAIL');
  process.exitCode = 1;
} finally {
  if (priorLearning === undefined) delete process.env.MIRA_LEARNING_FILE;
  else process.env.MIRA_LEARNING_FILE = priorLearning;
  if (priorAudit === undefined) delete process.env.MIRA_AUDIT_FILE;
  else process.env.MIRA_AUDIT_FILE = priorAudit;
  fs.rmSync(temp, { recursive: true, force: true });
}
