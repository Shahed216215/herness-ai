'use strict';

const {
  createQueueHealthAuditResult,
  validateQueueHealthAuditResult
} = require('../queue-health-planning-audit-schema');

const {
  buildConsistentMultiProjectQueue
} = require('./mira-project-queue-consistency-service');

function auditQueueItems(items = []) {
  const issues = [];
  const taskIds = new Set();
  const positions = new Set();

  let blocked = 0;
  let ready = 0;
  let completed = 0;
  let cancelled = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      issues.push('INVALID_QUEUE_ITEM');
      continue;
    }

    if (!item.taskId) {
      issues.push('MISSING_TASK_ID');
    } else if (taskIds.has(item.taskId)) {
      issues.push(`DUPLICATE_TASK_ID:${item.taskId}`);
    } else {
      taskIds.add(item.taskId);
    }

    const queuePosition = item.globalQueuePosition;

    if (!Number.isInteger(queuePosition)) {
      issues.push(`INVALID_QUEUE_POSITION:${item.taskId || 'unknown'}`);
    } else if (positions.has(queuePosition)) {
      issues.push(`DUPLICATE_QUEUE_POSITION:${queuePosition}`);
    } else {
      positions.add(queuePosition);
    }

    if (item.dependencyBlocked === true) blocked += 1;

    if (item.status === 'ready') ready += 1;
    if (item.status === 'completed') completed += 1;
    if (item.status === 'cancelled') cancelled += 1;

    if (
      item.executionAllowed !== false ||
      item.planningOnly !== true ||
      item.externalActionPerformed !== false ||
      item.paymentAllowed !== false ||
      item.paymentTransferAuthorized !== false ||
      item.contractSigningAllowed !== false
    ) {
      issues.push(`SAFETY_BOUNDARY:${item.taskId || 'unknown'}`);
    }

    if (
      item.priorityScore !== undefined &&
      (
        typeof item.priorityScore !== 'number' ||
        item.priorityScore < 0 ||
        item.priorityScore > 1
      )
    ) {
      issues.push(`INVALID_PRIORITY_SCORE:${item.taskId || 'unknown'}`);
    }
  }

  return {
    issues,
    metrics: {
      totalItems: items.length,
      uniqueTaskIds: taskIds.size,
      uniqueQueuePositions: positions.size,
      blocked,
      ready,
      completed,
      cancelled
    }
  };
}

function buildQueueHealthPlanningAudit({
  now = new Date()
} = {}) {
  const result =
    buildConsistentMultiProjectQueue({ now });

  if (!result || result.ok !== true) {
    return createQueueHealthAuditResult({
      status: 'error',
      health: 'unhealthy',
      issues: ['QUEUE_CONSISTENCY_FAILED']
    });
  }

  const queue =
    Array.isArray(result.queue)
      ? result.queue
      : [];

  const audit =
    auditQueueItems(queue);

  const health =
    audit.issues.length === 0
      ? 'healthy'
      : 'unhealthy';

  const output =
    createQueueHealthAuditResult({
      status: queue.length === 0 ? 'empty' : 'audited',
      projectCount: result.projectCount || 0,
      projectsWithItems: result.projectsWithItems || 0,
      taskCount: audit.metrics.uniqueTaskIds,
      health,
      issues: audit.issues,
      metrics: audit.metrics
    });

  if (!validateQueueHealthAuditResult(output)) {
    throw new Error('INVALID_QUEUE_HEALTH_AUDIT_RESULT');
  }

  return output;
}

module.exports = {
  auditQueueItems,
  buildQueueHealthPlanningAudit
};
