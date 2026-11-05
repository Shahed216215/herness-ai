'use strict';
const { appendEvent } = require('../../services/mira-hfm-local-append-arbiter');
const [root, expectedHeadHash, eventId] = process.argv.slice(2);
appendEvent({
  root, projectId: 'project-a', chainId: 'chain-a',
  expectedSequence: 0, expectedHeadHash, eventId,
  timestamp: '2026-11-04T00:00:00.000Z',
  actorIdentity: 'synthetic-worker', action: 'concurrent-test-append',
  payload: { worker: eventId }, auditWriter: () => {}
}).then(result => {
  process.stdout.write(result.status + '\n');
}).catch(error => {
  process.stderr.write((error.code || 'ERROR') + ':' + error.message + '\n');
  process.exitCode = 1;
});
