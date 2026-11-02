'use strict';

const {
  createOptimizationResult,
  validateOptimizationResult
} = require('../cross-project-planning-optimization-schema');

const {
  getPlanningQueue
} = require('./mira-queue-planning-integration');

function buildComparator() {
  return (a, b) => {
    const ab = a && a.status === 'blocked' ? 1 : 0;
    const bb = b && b.status === 'blocked' ? 1 : 0;

    if (ab !== bb) return ab - bb;

    const ap = Number(a && a.priorityScore || 0);
    const bp = Number(b && b.priorityScore || 0);

    if (bp !== ap) return bp - ap;

    const ad = a && a.deadline
      ? Date.parse(a.deadline)
      : Number.MAX_SAFE_INTEGER;

    const bd = b && b.deadline
      ? Date.parse(b.deadline)
      : Number.MAX_SAFE_INTEGER;

    if (ad !== bd) return ad - bd;

    const aq = Number(a && a.queuePosition || 0);
    const bq = Number(b && b.queuePosition || 0);

    if (aq !== bq) return aq - bq;

    const apid = String(a && a.projectId || '');
    const bpid = String(b && b.projectId || '');

    if (apid !== bpid) {
      return apid.localeCompare(bpid);
    }

    return String(a && a.taskId || '')
      .localeCompare(String(b && b.taskId || ''));
  };
}

function buildProjectSummary(items) {
  const map = new Map();

  for (const item of items) {
    if (!item || !item.projectId) continue;

    if (!map.has(item.projectId)) {
      map.set(item.projectId, {
        projectId: item.projectId,
        taskCount: 0,
        readyCount: 0,
        blockedCount: 0,
        criticalCount: 0,
        highCount: 0,
        overdueCount: 0
      });
    }

    const entry = map.get(item.projectId);
    entry.taskCount += 1;

    if (item.status === 'ready') entry.readyCount += 1;
    if (item.status === 'blocked') entry.blockedCount += 1;
    if (item.priorityLevel === 'critical') entry.criticalCount += 1;
    if (item.priorityLevel === 'high') entry.highCount += 1;

    if (
      item.deadline &&
      !Number.isNaN(Date.parse(item.deadline)) &&
      Date.parse(item.deadline) < Date.now() &&
      item.status !== 'completed' &&
      item.status !== 'cancelled'
    ) {
      entry.overdueCount += 1;
    }
  }

  return Array.from(map.values())
    .sort((a, b) =>
      b.criticalCount - a.criticalCount ||
      b.highCount - a.highCount ||
      b.readyCount - a.readyCount ||
      a.projectId.localeCompare(b.projectId)
    );
}

function buildConflicts(items) {
  const conflicts = [];
  const seen = new Map();

  for (const item of items) {
    if (!item || !item.taskId) continue;

    if (seen.has(item.taskId)) {
      conflicts.push({
        type: 'duplicate_task',
        taskId: item.taskId,
        projectIds: [
          seen.get(item.taskId),
          item.projectId
        ]
      });
    } else {
      seen.set(item.taskId, item.projectId);
    }
  }

  return conflicts;
}

function buildCrossProjectPlanningOptimization({
  now = new Date()
} = {}) {
  const planning = getPlanningQueue({ now });

  if (!planning || typeof planning !== 'object') {
    return createOptimizationResult({
      status: 'error'
    });
  }

  const sourceQueue =
    Array.isArray(planning.queue)
      ? planning.queue
      : [];

  const optimizedQueue =
    sourceQueue
      .slice()
      .sort(buildComparator())
      .map((item, index) => ({
        ...item,
        optimizedPosition: index + 1,
        executionAllowed: false,
        planningOnly: true,
        externalActionPerformed: false
      }));

  const result = createOptimizationResult({
    status:
      optimizedQueue.length > 0
        ? 'optimized'
        : 'empty',
    generatedAt: now.toISOString(),
    projectCount: planning.projectCount || 0,
    projectsWithItems: planning.projectsWithItems || 0,
    taskCount: new Set(
      optimizedQueue
        .map(item => item.taskId)
        .filter(Boolean)
    ).size,
    optimizedQueue,
    projectSummary:
      buildProjectSummary(optimizedQueue),
    conflicts:
      buildConflicts(optimizedQueue)
  });

  if (!validateOptimizationResult(result)) {
    throw new Error(
      'INVALID_CROSS_PROJECT_OPTIMIZATION_RESULT'
    );
  }

  return result;
}

module.exports = {
  buildCrossProjectPlanningOptimization
};
