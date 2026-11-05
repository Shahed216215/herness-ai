'use strict';

const audit = require('../../audit-log');
const label = process.argv[2] || 'worker';
const entry = audit.recordAudit({
  actorRole: 'fixture',
  action: 'concurrent-audit-worker-' + label,
  resource: 'mira_audit_log_test',
  resourceId: label,
  status: 'success',
  details: { worker: label }
});
process.stdout.write(entry.id + '\n');
