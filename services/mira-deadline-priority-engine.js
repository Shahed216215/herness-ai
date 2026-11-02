'use strict';

const {
  DIFFICULTY_SCORES,
  RISK_SCORES,
  createPriorityRecord
} = require('../priority-schema');

function parseDeadline(deadline, now = new Date()) {
  if (!deadline || typeof deadline !== 'string') return null;

  const value = deadline.trim().toLowerCase();

  if (!value) return null;

  if (value === 'today') {
    const result = new Date(now);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  if (value === 'tomorrow') {
    const result = new Date(now);
    result.setDate(result.getDate() + 1);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  const parsed = new Date(deadline);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function calculateUrgencyScore(deadline, now = new Date()) {
  const due = parseDeadline(deadline, now);

  if (!due) return 0;

  const diffMs = due.getTime() - now.getTime();

  if (diffMs <= 0) return 1;

  const hours = diffMs / (1000 * 60 * 60);

  if (hours <= 24) return 0.75;
  if (hours <= 72) return 0.50;
  if (hours <= 168) return 0.25;

  return 0;
}

function calculateEffortScore(task = {}) {
  return DIFFICULTY_SCORES[task.difficulty] ?? 0;
}

function calculateRiskScore(task = {}) {
  return RISK_SCORES[task.risk] ?? 0;
}

function normalizeDependencies(dependencies) {
  if (!Array.isArray(dependencies)) return [];

  return [
    ...new Set(
      dependencies
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .filter(Boolean)
    )
  ];
}

function calculateDependencyState({
  dependencies = [],
  knownSubtaskIds = [],
  blockedDependencies = []
} = {}) {
  const normalized = normalizeDependencies(dependencies);

  if (normalized.length === 0) {
    return {
      dependencyScore: 1,
      dependencyBlocked: false,
      unresolvedDependencies: []
    };
  }

  const known = new Set(
    Array.isArray(knownSubtaskIds)
      ? knownSubtaskIds
      : []
  );

  const blocked = new Set(
    Array.isArray(blockedDependencies)
      ? blockedDependencies
      : []
  );

  const unresolved = normalized.filter(
    dependency =>
      blocked.has(dependency) ||
      !known.has(dependency)
  );

  if (unresolved.length > 0) {
    return {
      dependencyScore: 0,
      dependencyBlocked: true,
      unresolvedDependencies: unresolved
    };
  }

  return {
    dependencyScore: 0.75,
    dependencyBlocked: false,
    unresolvedDependencies: []
  };
}

function analyzeTaskPriority({
  task = {},
  projectId = '',
  planId = '',
  dependencies = [],
  knownSubtaskIds = [],
  blockedDependencies = [],
  sequence,
  now = new Date()
} = {}) {
  const dependencyState = calculateDependencyState({
    dependencies,
    knownSubtaskIds,
    blockedDependencies
  });

  const urgencyScore =
    calculateUrgencyScore(task.deadline, now);

  const effortScore =
    calculateEffortScore(task);

  const riskScore =
    calculateRiskScore(task);

  return createPriorityRecord({
    taskId: task.id || '',
    projectId,
    planId,
    priorityScore: 0,
    urgencyScore,
    effortScore,
    dependencyScore: dependencyState.dependencyScore,
    riskScore,
    deadline: task.deadline || '',
    difficulty: task.difficulty || 'unknown',
    risk: task.risk || 'low',
    dependencies: normalizeDependencies(dependencies),
    dependencyBlocked: dependencyState.dependencyBlocked,
    sequence
  });
}

function comparePriorityRecords(a, b) {
  if (a.dependencyBlocked !== b.dependencyBlocked) {
    return a.dependencyBlocked ? 1 : -1;
  }

  if (b.priorityScore !== a.priorityScore) {
    return b.priorityScore - a.priorityScore;
  }

  const aDeadline = parseDeadline(a.deadline);
  const bDeadline = parseDeadline(b.deadline);

  if (aDeadline && bDeadline) {
    const diff =
      aDeadline.getTime() - bDeadline.getTime();

    if (diff !== 0) return diff;
  } else if (aDeadline && !bDeadline) {
    return -1;
  } else if (!aDeadline && bDeadline) {
    return 1;
  }

  const aSequence =
    Number.isFinite(a.sequence)
      ? a.sequence
      : Number.MAX_SAFE_INTEGER;

  const bSequence =
    Number.isFinite(b.sequence)
      ? b.sequence
      : Number.MAX_SAFE_INTEGER;

  if (aSequence !== bSequence) {
    return aSequence - bSequence;
  }

  return String(a.taskId).localeCompare(String(b.taskId));
}

function rankPriorityRecords(records) {
  if (!Array.isArray(records)) return [];

  return [...records]
    .sort(comparePriorityRecords)
    .map((record, index) => ({
      ...record,
      queuePosition: index + 1
    }));
}

module.exports = {
  parseDeadline,
  calculateUrgencyScore,
  calculateEffortScore,
  calculateRiskScore,
  calculateDependencyState,
  analyzeTaskPriority,
  comparePriorityRecords,
  rankPriorityRecords
};
