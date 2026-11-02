'use strict';

const { listProjects } = require('../project-store');
const { listTasks } = require('../task-store');
const { listSchedules } = require('../project-schedule-store');

const {
  analyzeTaskPriority,
  rankPriorityRecords
} = require('./mira-deadline-priority-engine');

function getProjectTasks(project, taskMap) {
  if (!project || !Array.isArray(project.taskIds)) {
    return [];
  }

  return project.taskIds
    .map(taskId => taskMap.get(taskId))
    .filter(Boolean);
}

function getScheduleContext(projectId, schedules) {
  const entries = [];

  for (const schedule of schedules) {
    if (
      schedule &&
      Array.isArray(schedule.entries)
    ) {
      for (const entry of schedule.entries) {
        entries.push({
          ...entry,
          projectId:
            entry.projectId ||
            schedule.projectId ||
            ''
        });
      }
    } else if (schedule) {
      entries.push({
        ...schedule,
        projectId:
          schedule.projectId ||
          projectId ||
          ''
      });
    }
  }

  return entries.filter(
    entry =>
      !entry.projectId ||
      entry.projectId === projectId
  );
}

function buildTaskPriority({
  project,
  task,
  schedules,
  now
}) {
  const matchingEntries =
    getScheduleContext(project.projectId, schedules)
      .filter(entry => entry.taskId === task.id);

  const entry = matchingEntries[0] || {};

  const dependencies =
    Array.isArray(entry.dependencies)
      ? entry.dependencies
      : [];

  const knownSubtaskIds =
    Array.isArray(entry.knownSubtaskIds)
      ? entry.knownSubtaskIds
      : [];

  const blockedDependencies =
    Array.isArray(entry.blockedDependencies)
      ? entry.blockedDependencies
      : [];

  return analyzeTaskPriority({
    task,
    projectId: project.projectId,
    planId: entry.planId || '',
    dependencies,
    knownSubtaskIds,
    blockedDependencies,
    sequence: entry.sequence,
    now
  });
}

function buildProjectPriorityQueue({
  projectId,
  now = new Date()
} = {}) {
  const projects = listProjects();

  const project =
    projects.find(
      item => item.projectId === projectId
    );

  if (!project) {
    return {
      ok: false,
      status: 'not_found',
      projectId,
      queue: []
    };
  }

  const taskMap = new Map(
    listTasks().map(task => [task.id, task])
  );

  const schedules = listSchedules();

  const tasks =
    getProjectTasks(project, taskMap);

  const records =
    tasks.map(task =>
      buildTaskPriority({
        project,
        task,
        schedules,
        now
      })
    );

  const queue =
    rankPriorityRecords(records);

  return {
    ok: true,
    status: 'ok',
    projectId: project.projectId,
    projectStatus: project.status,
    taskCount: tasks.length,
    queue,
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };
}

function buildAllProjectPriorityQueues({
  now = new Date()
} = {}) {
  return listProjects()
    .map(project =>
      buildProjectPriorityQueue({
        projectId: project.projectId,
        now
      })
    );
}

module.exports = {
  buildProjectPriorityQueue,
  buildAllProjectPriorityQueues
};
