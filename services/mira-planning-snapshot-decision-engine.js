'use strict';

const {
  createPlanningSnapshot,
  createDecisionResult,
  validatePlanningSnapshot,
  validateDecisionResult
} = require('../planning-snapshot-decision-schema');

const {
  getPlanningQueue
} = require('./mira-queue-planning-integration');

function normalizeItems(value) {
  return Array.isArray(value) ? value : [];
}

function buildSummary(items) {
  const summary = {
    queued: 0,
    blocked: 0,
    ready: 0,
    completed: 0,
    cancelled: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    overdue: 0
  };

  for (const item of items) {
    const status = item && item.status;
    const priority = item && item.priorityLevel;

    if (Object.prototype.hasOwnProperty.call(summary, status)) {
      summary[status] += 1;
    }

    if (Object.prototype.hasOwnProperty.call(summary, priority)) {
      summary[priority] += 1;
    }

    if (
      item &&
      item.deadline &&
      !Number.isNaN(Date.parse(item.deadline)) &&
      Date.parse(item.deadline) < Date.now() &&
      status !== 'completed' &&
      status !== 'cancelled'
    ) {
      summary.overdue += 1;
    }
  }

  return summary;
}

function uniqueTaskCount(items) {
  return new Set(
    items
      .filter(item => item && typeof item === 'object')
      .map(item => item.taskId)
      .filter(Boolean)
  ).size;
}

function buildPlanningSnapshot({
  now = new Date()
} = {}) {
  const queueResult = getPlanningQueue({ now });

  if (!queueResult || typeof queueResult !== 'object') {
    return createPlanningSnapshot({
      status: 'error'
    });
  }

  const items = normalizeItems(queueResult.queue);

  const snapshot = createPlanningSnapshot({
    status:
      queueResult.status === 'ready' && items.length > 0
        ? 'ready'
        : 'empty',
    generatedAt: now.toISOString(),
    projectCount: queueResult.projectCount || 0,
    projectsWithItems: queueResult.projectsWithItems || 0,
    taskCount: uniqueTaskCount(items),
    queueItems: items,
    lifecycle: normalizeItems(queueResult.lifecycle),
    consistencyStatus:
      queueResult.consistency &&
      queueResult.consistency.status
        ? queueResult.consistency.status
        : 'unknown',
    summary: buildSummary(items)
  });

  if (!validatePlanningSnapshot(snapshot)) {
    throw new Error('INVALID_PLANNING_SNAPSHOT');
  }

  return snapshot;
}

function buildPlanningDecisionLayer({
  now = new Date()
} = {}) {
  const snapshot = buildPlanningSnapshot({ now });
  const items = normalizeItems(snapshot.queueItems);

  const ready = items
    .filter(item => item && item.status === 'ready')
    .sort((a, b) => {
      const ap = Number(a.priorityScore || 0);
      const bp = Number(b.priorityScore || 0);

      if (bp !== ap) return bp - ap;

      const ad = a.deadline
        ? Date.parse(a.deadline)
        : Number.MAX_SAFE_INTEGER;
      const bd = b.deadline
        ? Date.parse(b.deadline)
        : Number.MAX_SAFE_INTEGER;

      if (ad !== bd) return ad - bd;

      return String(a.taskId || '').localeCompare(
        String(b.taskId || '')
      );
    });

  const recommendations = ready
    .slice(0, 10)
    .map((item, index) => ({
      rank: index + 1,
      taskId: item.taskId,
      projectId: item.projectId,
      priorityScore: item.priorityScore || 0,
      priorityLevel: item.priorityLevel || 'low',
      deadline: item.deadline || null,
      reason:
        item.priorityLevel === 'critical'
          ? 'critical_priority'
          : item.deadline
            ? 'priority_and_deadline'
            : 'highest_ready_priority',
      action: 'review_for_human_approval',
      executionAllowed: false,
      planningOnly: true
    }));

  const decision = createDecisionResult({
    status:
      recommendations.length > 0
        ? 'recommendations_available'
        : 'no_ready_recommendations',
    snapshotStatus: snapshot.status,
    recommendations,
    counts: {
      projects: snapshot.projectCount,
      projectsWithItems: snapshot.projectsWithItems,
      tasks: snapshot.taskCount,
      ready: snapshot.summary.ready,
      blocked: snapshot.summary.blocked,
      critical: snapshot.summary.critical,
      high: snapshot.summary.high,
      overdue: snapshot.summary.overdue
    }
  });

  if (!validateDecisionResult(decision)) {
    throw new Error('INVALID_PLANNING_DECISION');
  }

  return decision;
}

module.exports = {
  buildPlanningSnapshot,
  buildPlanningDecisionLayer
};
