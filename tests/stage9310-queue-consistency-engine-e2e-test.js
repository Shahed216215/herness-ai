'use strict';

const assert = require('assert');

const {
  buildConsistentMultiProjectQueue,
  auditAllProjectsQueueConsistency
} = require('../services/mira-project-queue-consistency-service');

const {
  validateConsistencyReport
} = require('../queue-consistency-schema');

const result =
  buildConsistentMultiProjectQueue({
    now: new Date('2026-10-08T12:00:00Z')
  });

assert.strictEqual(result.ok, true);

assert.ok(
  result.status === 'consistent' ||
  result.status === 'rebuilt' ||
  result.status === 'empty'
);

assert.strictEqual(
  result.executionAllowed,
  false
);

assert.strictEqual(
  result.planningOnly,
  true
);

assert.strictEqual(
  result.externalActionPerformed,
  false
);

assert.strictEqual(
  result.paymentAllowed,
  false
);

assert.strictEqual(
  result.paymentTransferAuthorized,
  false
);

assert.strictEqual(
  result.contractSigningAllowed,
  false
);

assert.ok(
  validateConsistencyReport(
    result.consistency
  )
);

const queue = result.queue;

assert.ok(Array.isArray(queue));

const taskIds = new Set();
const positions = new Set();

for (let i = 0; i < queue.length; i++) {
  const item = queue[i];

  assert.strictEqual(
    item.globalQueuePosition,
    i + 1
  );

  assert.ok(
    !taskIds.has(item.taskId)
  );

  assert.ok(
    !positions.has(item.globalQueuePosition)
  );

  taskIds.add(item.taskId);
  positions.add(item.globalQueuePosition);

  assert.strictEqual(
    item.executionAllowed,
    false
  );

  assert.strictEqual(
    item.planningOnly,
    true
  );

  if (i > 0) {
    const previous = queue[i - 1];

    const previousBlocked =
      previous.dependencyBlocked === true ? 1 : 0;

    const currentBlocked =
      item.dependencyBlocked === true ? 1 : 0;

    assert.ok(
      previousBlocked <= currentBlocked
    );

    if (previousBlocked === currentBlocked) {
      assert.ok(
        previous.priorityScore >=
        item.priorityScore
      );
    }
  }
}

const audit =
  auditAllProjectsQueueConsistency({
    now: new Date('2026-10-08T12:00:00Z')
  });

assert.strictEqual(
  audit.ok,
  true
);

assert.strictEqual(
  audit.planningOnly,
  true
);

assert.strictEqual(
  audit.executionAllowed,
  false
);

console.log(
  'PROJECTS_CHECKED:',
  result.projectCount
);

console.log(
  'GLOBAL_QUEUE_ITEMS_CHECKED:',
  queue.length
);

console.log(
  'PROJECT_CONSISTENCY_RECORDS:',
  audit.records.length
);

console.log(
  'STAGE9310_QUEUE_CONSISTENCY_ENGINE_E2E_TEST: PASS'
);
