'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-stage112-'));
process.env.MIRA_AUDIT_FILE = path.join(isolatedDir, 'audit.json');

const store =
  require('../client-follow-up-store');

const engine =
  require('../services/mira-client-follow-up-engine');

const audit =
  require('../audit-log');

if (fs.existsSync(store.STORE_FILE)) {
  fs.unlinkSync(store.STORE_FILE);
}

const project = {
  projectId: 'audit-project',
  clientId: 'audit-client',
  status: 'completed',
  title: 'Audit Project'
};

const profile = {
  id: 'audit-client',
  name: 'Audit Client',
  status: 'active',
  communication: {
    contactAllowed: true
  }
};

const before =
  audit.loadAuditLog();

const result =
  engine.processClientFollowUp({
    project,
    clientProfile: profile,
    now: '2026-10-08T12:00:00.000Z',
    id: 'audit-followup-1'
  });

assert(
  result &&
  result.ok === true,
  'Follow-up processing failed'
);

assert(
  result.followUp &&
  result.followUp.id ===
    'audit-followup-1',
  'Follow-up record was not created'
);

assert(
  result.audit &&
  result.audit.ok === true,
  'Follow-up audit write did not succeed'
);

assert.strictEqual(
  result.sendBoundary.sendAllowed,
  false
);

assert.strictEqual(
  result.sendBoundary.externalSendImplemented,
  false
);

const after =
  audit.loadAuditLog();

assert(
  after.length >= before.length + 1,
  'Follow-up audit record was not appended'
);

const created =
  result.audit.entry;

assert(
  created &&
  typeof created === 'object',
  'recordAudit() must return the created audit record'
);

assert.strictEqual(
  created.action,
  'client_follow_up'
);

assert.strictEqual(
  created.resource,
  'client-follow-up'
);

assert.strictEqual(
  created.resourceId,
  'audit-followup-1'
);

assert.strictEqual(
  created.status,
  'success'
);

assert(
  created.details &&
  created.details.followUpId ===
    'audit-followup-1'
);

assert(
  created.details &&
  created.details.projectId ===
    'audit-project'
);

assert(
  created.details &&
  created.details.clientId ===
    'audit-client'
);

assert(
  created.details &&
  typeof created.details.messageHash ===
    'string' &&
  created.details.messageHash.length === 64
);

assert(
  typeof created.id === 'string' &&
  created.id.length > 0
);

assert(
  typeof created.timestamp === 'string' &&
  created.timestamp.length > 0
);

assert(
  typeof created.integrityHash === 'string' &&
  /^[a-f0-9]{64}$/i.test(
    created.integrityHash
  )
);

assert.strictEqual(
  created.integrityVersion,
  2
);

assert(
  Object.prototype.hasOwnProperty.call(
    created,
    'previousHash'
  )
);

const persisted =
  after.find(
    item =>
      item &&
      item.id === created.id
  );

assert(
  persisted,
  'Created audit record was not persisted'
);

assert.strictEqual(
  persisted.integrityHash,
  created.integrityHash
);

const entries =
  audit.getAuditLog(500);

const entry =
  entries.find(
    item =>
      item &&
      item.id === created.id
  );

assert(
  entry,
  'Follow-up audit record not found through getAuditLog()'
);

assert.strictEqual(
  entry.resource,
  'client-follow-up'
);

assert.strictEqual(
  entry.resourceId,
  'audit-followup-1'
);

assert.strictEqual(
  entry.id,
  created.id
);

assert.strictEqual(
  entry.integrityHash,
  created.integrityHash
);

const serialized =
  JSON.stringify(entry);

assert.strictEqual(
  serialized.includes(
    result.followUp.message
  ),
  false
);

if (
  typeof audit.verifyAuditIntegrity ===
  'function'
) {
  const integrity =
    audit.verifyAuditIntegrity();

  assert.strictEqual(
    integrity.ok,
    true
  );

  assert.strictEqual(
    integrity.tamperDetected,
    false
  );
}

console.log(
  'PASS: recordAudit() contract'
);

console.log(
  'PASS: audit record persisted'
);

console.log(
  'PASS: audit integrity'
);

console.log(
  'PASS: follow-up message content not leaked into audit'
);

console.log(
  'PASS: external send boundary'
);

console.log(
  'STAGE112_CLIENT_FOLLOW_UP_AUDIT_INTEGRATION: PASS'
);

try { fs.rmSync(isolatedDir, { recursive: true, force: true }); } catch {}
