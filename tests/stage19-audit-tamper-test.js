'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-audit-'));
const file = path.join(dir, 'audit-test.json');
const anchorFile = file + '.anchor';
const TEST_KEY = 'test-only-key-0123456789abcdef0123456789';
process.env.MIRA_AUDIT_FILE = file;
process.env.MIRA_AUDIT_HMAC_KEY = TEST_KEY;
const audit = require('../audit-log');
if (audit.AUDIT_FILE !== file) { console.error('ABORT: not using temp audit file'); process.exit(2); }

const isValid = r => r.ok === true && r.hashesValid === true && r.chainValid === true;
const load = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = e => fs.writeFileSync(file, JSON.stringify(e, null, 2));
function rec(i) {
  audit.recordAudit({actorRole: 'admin', action: 'test_action_' + i, resource: 'r', resourceId: String(i), details: {i}});
}
function seed(n) {
  audit.saveAuditLog([]);
  try { fs.unlinkSync(anchorFile); } catch {}
  for (let i = 0; i < n; i++) rec(i);
}
function sha(e) {
  const p = {integrityVersion: e.integrityVersion || 1, id: e.id, timestamp: e.timestamp,
    actorRole: e.actorRole, action: e.action, resource: e.resource, resourceId: e.resourceId,
    status: e.status, details: e.details, previousHash: e.previousHash || null};
  return crypto.createHash('sha256').update(JSON.stringify(p), 'utf8').digest('hex');
}
const rows = [];
function attack(name, mutate) {
  seed(6);
  const e = load();
  mutate(e);
  save(e);
  const detected = !isValid(audit.verifyAuditIntegrity());
  rows.push({name, ok: detected});
  console.log(`${detected ? 'DETECTED' : 'UNDETECTED'}=${name}`);
}
function control(name, fn) {
  const ok = fn() === true;
  rows.push({name, ok});
  console.log(`${ok ? 'VALID' : 'INVALID'}=${name}`);
}

control('BASELINE_INTACT_LOG', () => { seed(6); const r = audit.verifyAuditIntegrity(); console.log('ANCHOR_STATE=' + r.anchorState); return isValid(r) && r.anchorState === 'match'; });
control('APPEND_AFTER_VERIFY', () => { seed(4); rec(99); return isValid(audit.verifyAuditIntegrity()); });
control('MIGRATION_V1_THEN_V2', () => {
  const savedKey = process.env.MIRA_AUDIT_HMAC_KEY, savedSecret = process.env.MIRA_SESSION_SECRET;
  audit.saveAuditLog([]); try { fs.unlinkSync(anchorFile); } catch {}
  delete process.env.MIRA_AUDIT_HMAC_KEY; delete process.env.MIRA_SESSION_SECRET;
  rec(1); rec(2);
  const legacyOnly = load().every(x => x.integrityVersion === 1);
  process.env.MIRA_AUDIT_HMAC_KEY = savedKey;
  if (savedSecret) process.env.MIRA_SESSION_SECRET = savedSecret;
  rec(3); rec(4);
  const r = audit.verifyAuditIntegrity();
  const v1 = load().filter(x => x.integrityVersion === 1).length;
  console.log('MIGRATION_DEBUG=' + JSON.stringify({legacyOnly, valid: isValid(r), v1, legacyEntries: r.legacyEntries, anchor: r.anchorState, failures: r.failures}));
  return legacyOnly && isValid(r) && v1 === 2;
});

attack('MODIFY_ENTRY_DETAILS', e => { e[2].details = {i: 'tampered'}; });
attack('DELETE_MIDDLE_ENTRY', e => { e.splice(2, 1); });
attack('SWAP_ENTRIES', e => { [e[1], e[2]] = [e[2], e[1]]; });
attack('TRUNCATE_TAIL_2_ENTRIES', e => { e.splice(-2, 2); });
attack('FORGE_CHAIN_SHA256_NO_KEY', e => {
  e[2].details = {i: 'forged'};
  for (let i = 2; i < e.length; i++) { if (i > 2) e[i].previousHash = e[i - 1].integrityHash; e[i].integrityHash = sha(e[i]); }
});
attack('FORGE_DOWNGRADE_ALL_TO_V1', e => {
  for (let i = 0; i < e.length; i++) {
    e[i].integrityVersion = 1;
    e[i].previousHash = i ? e[i - 1].integrityHash : null;
    e[i].integrityHash = sha(e[i]);
  }
  e[3].details = {i: 'forged'}; for (let i = 3; i < e.length; i++) { e[i].previousHash = e[i - 1].integrityHash; e[i].integrityHash = sha(e[i]); }
});
attack('TRUNCATE_AND_DELETE_ANCHOR', e => { e.splice(-2, 2); try { fs.unlinkSync(anchorFile); } catch {} });
attack('TRUNCATE_AND_FORGE_ANCHOR', e => {
  const last = e[e.length - 3];
  e.splice(-2, 2);
  fs.writeFileSync(anchorFile, JSON.stringify({lastHash: last.integrityHash, lastId: last.id, updatedAt: new Date().toISOString(), sig: 'f'.repeat(64)}));
});

fs.rmSync(dir, {recursive: true, force: true});
const bad = rows.filter(r => !r.ok).map(r => r.name);
console.log(`AUDIT_TAMPER_SCENARIOS=${rows.length}`);
console.log(`AUDIT_TAMPER_FAILED=${bad.length}${bad.length ? ';' + bad.join('|') : ''}`);
console.log(`AUDIT_TAMPER_TEST=${bad.length ? 'FAIL' : 'PASS'}`);
process.exitCode = bad.length ? 1 : 0;
