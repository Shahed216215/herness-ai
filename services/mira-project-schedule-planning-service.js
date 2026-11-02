"use strict";

const {
  getProject
} = require("../project-store");

const {
  getTask
} = require("../task-store");

const {
  createTaskPlan,
  validatePlan
} = require("./mira-task-planner");

const {
  listSchedules,
  createStoredProjectSchedule
} = require("../project-schedule-store");

function assertObject(value, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      `${name} must be an object`
    );
  }
}

function resolvePlanningProject(projectId) {
  if (
    typeof projectId !== "string" ||
    projectId.trim().length === 0
  ) {
    throw new Error(
      "projectId is required"
    );
  }

  const project =
    getProject(projectId);

  if (!project) {
    throw new Error(
      `Project not found: ${projectId}`
    );
  }

  if (project.status !== "planning") {
    throw new Error(
      `Project is not in planning status: ${projectId}`
    );
  }

  if (project.executionAllowed !== false) {
    throw new Error(
      `Project execution must remain disabled: ${projectId}`
    );
  }

  if (project.planningOnly !== true) {
    throw new Error(
      `Project must remain planningOnly: ${projectId}`
    );
  }

  return project;
}

function resolveProjectTasks(project) {
  assertObject(
    project,
    "project"
  );

  const taskIds =
    Array.isArray(project.taskIds)
      ? project.taskIds
      : [];

  if (taskIds.length === 0) {
    throw new Error(
      `Project has no linked tasks: ${project.projectId}`
    );
  }

  const tasks = [];

  for (const taskId of taskIds) {
    const task =
      getTask(taskId);

    if (!task) {
      throw new Error(
        `Project task not found: ${taskId}`
      );
    }

    tasks.push(task);
  }

  return tasks;
}

function buildPlannerInput(task) {
  assertObject(
    task,
    "task"
  );

  return {
    taskId: task.id,
    title: task.title,
    description: task.description,
    type: task.type,
    requirements:
      task.requirements || [],
    deliverables:
      task.deliverables || [],
    deadline:
      task.deadline || "",
    difficulty:
      task.difficulty || "unknown",
    requiredSkills:
      task.requiredSkills || [],
    risk:
      task.risk || "low"
  };
}

function normalizeTaskPlan(task, result) {
  if (
    !result ||
    result.success !== true ||
    !result.plan
  ) {
    throw new Error(
      `Task planning failed: ${task.id}`
    );
  }

  const plan = {
    ...result.plan,
    taskId: task.id
  };

  const validation =
    validatePlan(plan);

  if (!validation.valid) {
    throw new Error(
      `Generated task plan is invalid: ${task.id}`
    );
  }

  if (plan.executionAllowed !== false) {
    throw new Error(
      `Task plan execution must remain disabled: ${task.id}`
    );
  }

  if (plan.planningOnly !== true) {
    throw new Error(
      `Task plan must remain planningOnly: ${task.id}`
    );
  }

  return {
    plan,
    validation
  };
}

function buildScheduleEntry(
  task,
  plan,
  sequence
) {
  assertObject(
    task,
    "task"
  );

  assertObject(
    plan,
    "plan"
  );

  const dependencies = [];

  for (const subtask of plan.subtasks || []) {
    for (const dependency of
      subtask.dependencies || []) {
      if (
        !dependencies.includes(
          dependency
        )
      ) {
        dependencies.push(
          dependency
        );
      }
    }
  }

  return {
    taskId: task.id,

    planId: plan.id,

    sequence,

    dependencies,

    deadline:
      task.deadline || "",

    estimatedDuration:
      null,

    scheduledStart: "",

    scheduledEnd: "",

    status:
      plan.feasibility === "feasible"
        ? "planned"
        : "blocked"
  };
}

async function buildProjectSchedule(input) {
  assertObject(
    input,
    "input"
  );

  const project =
    resolvePlanningProject(
      input.projectId
    );

  const tasks =
    resolveProjectTasks(project);

  const plans = [];
  const entries = [];

  for (
    let index = 0;
    index < tasks.length;
    index += 1
  ) {
    const task =
      tasks[index];

    const result =
      await createTaskPlan(
        buildPlannerInput(task),
        {
          persist:
            input.persistUnderstanding !== false
        }
      );

    const normalized =
      normalizeTaskPlan(
        task,
        result
      );

    plans.push({
      taskId: task.id,
      plan:
        normalized.plan,
      validation:
        normalized.validation,
      feasibility:
        normalized.plan.feasibility
    });

    entries.push(
      buildScheduleEntry(
        task,
        normalized.plan,
        index + 1
      )
    );
  }

  return {
    projectId:
      project.projectId,

    acceptanceId:
      project.acceptanceId,

    taskIds:
      tasks.map(
        task => task.id
      ),

    plans,

    entries,

    executionAllowed:
      false,

    planningOnly:
      true
  };
}

async function createProjectSchedulePlan(
  input
) {
  assertObject(
    input,
    "input"
  );

  const project =
    resolvePlanningProject(
      input.projectId
    );

  const existing =
    getScheduleForProject(
      project.projectId
    );

  if (existing) {
    throw new Error(
      `Project schedule already exists: ${project.projectId}`
    );
  }

  const built =
    await buildProjectSchedule(
      input
    );

  const schedule =
    createStoredProjectSchedule({
      scheduleId:
        input.scheduleId,

      projectId:
        project.projectId,

      entries:
        built.entries,

      status:
        built.entries.some(
          entry =>
            entry.status === "blocked"
        )
          ? "blocked"
          : "planned"
    });

  return {
    projectId:
      project.projectId,

    schedule,

    plans:
      built.plans,

    taskIds:
      built.taskIds,

    executionAllowed:
      false,

    planningOnly:
      true
  };
}

function getScheduleForProject(
  projectId
) {
  const schedules =
    listSchedules({
      projectId
    });

  return schedules.length > 0
    ? schedules[0]
    : null;
}

module.exports = {
  resolvePlanningProject,
  resolveProjectTasks,
  buildPlannerInput,
  normalizeTaskPlan,
  buildScheduleEntry,
  buildProjectSchedule,
  createProjectSchedulePlan,
  getScheduleForProject
};
