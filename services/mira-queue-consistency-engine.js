'use strict';

const {
  createConsistencyIssue,
  createConsistencyReport
} = require('../queue-consistency-schema');

const {
  validateCoordinatorItem
} = require('../multi-project-queue-coordinator-schema');

const {
  compareGlobalQueueItems
} = require('./mira-multi-project-queue-coordinator');

function checkQueueConsistency({
  items = [],
  projectIds = []
} = {}) {
  if (!Array.isArray(items)) {
    throw new Error('items must be an array');
  }

  if (!Array.isArray(projectIds)) {
    throw new Error('projectIds must be an array');
  }

  const issues = [];
  const taskIds = new Set();
  const positions = new Set();
  const projectSet = new Set(projectIds);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!validateCoordinatorItem(item)) {
      issues.push(
        createConsistencyIssue({
          type: 'invalid_item',
          taskId:
            item && typeof item.taskId === 'string'
              ? item.taskId
              : '',
          projectId:
            item && typeof item.projectId === 'string'
              ? item.projectId
              : '',
          message: 'Coordinator item failed schema validation'
        })
      );
    }

    if (item && typeof item.taskId === 'string') {
      if (taskIds.has(item.taskId)) {
        issues.push(
          createConsistencyIssue({
            type: 'duplicate_task_id',
            taskId: item.taskId,
            projectId: item.projectId || '',
            message: 'Duplicate taskId detected'
          })
        );
      }

      taskIds.add(item.taskId);
    }

    if (
      item &&
      Number.isInteger(item.globalQueuePosition)
    ) {
      if (positions.has(item.globalQueuePosition)) {
        issues.push(
          createConsistencyIssue({
            type: 'duplicate_global_position',
            taskId: item.taskId || '',
            projectId: item.projectId || '',
            message: 'Duplicate global queue position detected'
          })
        );
      }

      positions.add(item.globalQueuePosition);
    }

    const expectedPosition = i + 1;

    if (
      !item ||
      item.globalQueuePosition !== expectedPosition
    ) {
      issues.push(
        createConsistencyIssue({
          type: 'missing_global_position',
          taskId: item && item.taskId || '',
          projectId: item && item.projectId || '',
          message:
            `Expected globalQueuePosition ${expectedPosition}`
        })
      );
    }

    if (
      item &&
      typeof item.projectId === 'string' &&
      projectSet.size > 0 &&
      !projectSet.has(item.projectId)
    ) {
      issues.push(
        createConsistencyIssue({
          type: 'project_reference_mismatch',
          taskId: item.taskId || '',
          projectId: item.projectId,
          message: 'Queue item references unknown project'
        })
      );
    }

    if (i > 0) {
      const previous = items[i - 1];

      const previousBlocked =
        previous.dependencyBlocked === true ? 1 : 0;

      const currentBlocked =
        item && item.dependencyBlocked === true ? 1 : 0;

      if (previousBlocked > currentBlocked) {
        issues.push(
          createConsistencyIssue({
            type: 'blocked_order_violation',
            taskId: item && item.taskId || '',
            projectId: item && item.projectId || '',
            message:
              'Blocked item appears before non-blocked item'
          })
        );
      }

      if (
        previousBlocked === currentBlocked &&
        Number.isFinite(previous.priorityScore) &&
        Number.isFinite(item && item.priorityScore) &&
        previous.priorityScore < item.priorityScore
      ) {
        issues.push(
          createConsistencyIssue({
            type: 'priority_order_violation',
            taskId: item.taskId || '',
            projectId: item.projectId || '',
            message:
              'Queue priority ordering is inconsistent'
          })
        );
      }
    }
  }

  return createConsistencyReport({
    status:
      items.length === 0
        ? 'empty'
        : issues.length === 0
          ? 'consistent'
          : 'inconsistent',
    checkedItems: items.length,
    issues,
    rebuilt: false
  });
}

function rebuildConsistentQueue(items = []) {
  if (!Array.isArray(items)) {
    throw new Error('items must be an array');
  }

  const unique = new Map();

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    if (typeof item.taskId !== 'string') continue;

    if (!unique.has(item.taskId)) {
      unique.set(item.taskId, item);
    }
  }

  const sorted = [...unique.values()]
    .sort(compareGlobalQueueItems);

  return sorted.map((item, index) => ({
    ...item,
    globalQueuePosition: index + 1,
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  }));
}

function checkAndRebuildQueue({
  items = [],
  projectIds = []
} = {}) {
  const initial =
    checkQueueConsistency({
      items,
      projectIds
    });

  if (
    initial.status === 'consistent' ||
    initial.status === 'empty'
  ) {
    return {
      ok: true,
      status: initial.status,
      original: items.map(item => ({ ...item })),
      queue: items.map(item => ({ ...item })),
      consistency: initial,
      rebuilt: false,
      executionAllowed: false,
      planningOnly: true,
      externalActionPerformed: false,
      paymentAllowed: false,
      paymentTransferAuthorized: false,
      contractSigningAllowed: false
    };
  }

  const rebuiltQueue =
    rebuildConsistentQueue(items);

  const verification =
    checkQueueConsistency({
      items: rebuiltQueue,
      projectIds
    });

  return {
    ok: verification.status === 'consistent',
    status:
      verification.status === 'consistent'
        ? 'rebuilt'
        : 'inconsistent',
    original: items.map(item => ({ ...item })),
    queue: rebuiltQueue,
    consistency: verification,
    originalIssueCount: initial.issueCount,
    rebuilt: true,
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };
}

module.exports = {
  checkQueueConsistency,
  rebuildConsistentQueue,
  checkAndRebuildQueue
};
