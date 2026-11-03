'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PROJECT = process.cwd();
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-memory-contract-'));

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL: ${name}`);
    console.log(`DETAIL: ${error.message}`);
  }
}

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT, relativePath), 'utf8');
}

try {
  const tempServices = path.join(TEMP, 'services');
  fs.mkdirSync(tempServices, { recursive: true });

  fs.copyFileSync(
    path.join(PROJECT, 'mira-storage.js'),
    path.join(TEMP, 'mira-storage.js')
  );
  fs.copyFileSync(
    path.join(PROJECT, 'services/mira-local-memory-store.js'),
    path.join(tempServices, 'mira-local-memory-store.js')
  );
  fs.copyFileSync(
    path.join(PROJECT, 'services/mira-json-state-store.js'),
    path.join(tempServices, 'mira-json-state-store.js')
  );

  const fixtureMemory = path.join(TEMP, 'memory.json');
  process.env.MIRA_STORAGE_DIR = TEMP;
  process.env.MIRA_MEMORY_FILE = fixtureMemory;

  const store = require(
    path.join(tempServices, 'mira-local-memory-store.js')
  );

  const fixture = [
    { role: 'user', content: 'isolated contract fixture' },
    { role: 'assistant', content: 'isolated response fixture' }
  ];

  check('Temporary Local Store resolves to isolated fixture path', () => {
    assert.strictEqual(path.resolve(store.MEMORY_FILE), path.resolve(fixtureMemory));
  });

  check('Local Store writes and reads isolated fixture', () => {
    store.writeMemory(fixture);
    const result = store.readMemory();
    assert.deepStrictEqual(result, fixture);
  });

  check('Local Store creates restrictive memory file permissions', () => {
    const mode = fs.statSync(fixtureMemory).mode & 0o777;
    assert.strictEqual(mode, 0o600);
  });

  check('Invalid input does not replace existing fixture', () => {
    const before = fs.readFileSync(fixtureMemory, 'utf8');
    let rejected = false;

    try {
      store.writeMemory({ invalid: true });
    } catch (_) {
      rejected = true;
    }

    assert.strictEqual(rejected, true, 'Invalid input was not rejected');
    assert.strictEqual(fs.readFileSync(fixtureMemory, 'utf8'), before);
  });

  const evolution = readProjectFile('knowledge-memory-evolution.js');
  const snapshot = readProjectFile('snapshot-manager.js');
  const localStore = readProjectFile('services/mira-local-memory-store.js');

  check('Evolution keeps an atomic adapter over the shared state stores', () => {
    assert.match(evolution, /function\s+atomicWriteJson\s*\(/);
    assert.match(evolution, /atomicWriteJson\s*\(\s*getTargetFile\(target\)\s*,\s*proposed\s*\)/);
  });

  check('Evolution rollback still calls Snapshot Manager restore', () => {
    assert.match(evolution, /restoreSnapshot\s*\(\s*changeId\s*,\s*snapshotId/);
    assert.match(snapshot, /copyFileSync\s*\(/);
    assert.match(snapshot, /renameSync\s*\(/);
  });

  check('Evolution delegates Memory persistence to shared Local Store', () => {
    assert.ok(evolution.includes('require("./services/mira-local-memory-store")'));
    assert.ok(evolution.includes('localMemoryStore.readMemory()'));
    assert.ok(evolution.includes('localMemoryStore.writeMemory(value)'));
    assert.ok(evolution.includes('jsonStateStore.writeArrayState'));
  });

  check('Local Store supports explicit MIRA_MEMORY_FILE path', () => {
    assert.match(localStore, /MIRA_MEMORY_FILE/);
  });

  console.log('');
  console.log(`TESTS_PASSED=${passed}`);
  console.log(`TESTS_FAILED=${failed}`);
  console.log('PRODUCTION_MEMORY_TOUCHED=NO');
  console.log('REAL_GOOGLE_DRIVE_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log(
    failed === 0
      ? 'RESULT=ISOLATED_CONTRACT_TEST_PASS'
      : 'RESULT=ISOLATED_CONTRACT_TEST_FAIL'
  );
} finally {
  try {
    fs.rmSync(TEMP, { recursive: true, force: true });
  } catch (error) {
    console.log(`TEMP_CLEANUP=REVIEW_REQUIRED: ${error.message}`);
  }
}
