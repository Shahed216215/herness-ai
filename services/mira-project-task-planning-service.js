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

function assertObject(
  value,
  name
) {
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

function resolvePlanningProject(
  projectId
) {
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

  if (
    project.status !== "planning"
  ) {
    throw new Error(
      `Project is not in planning status: ${projectId}`
    );
  }

  if (
    project.executionAllowed !== false
  ) {
    throw new Error(
      `Project execution must remain disabled: ${projectId}`
    );
  }

  if (
    project.planningOnly !== true
  ) {
    throw new Error(
      `Project must remain planningOnly: ${projectId}`
    );
  }

  return project;
}

function resolveProjectTasks(
  project
) {
  assertObject(
    project,
    "project"
  );

  const taskIds =
    Array.isArray(project.taskIds)
      ? project.taskIds
      : [];

  const tasks = [];

  for (
    const taskId of taskIds
  ) {
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

function buildPlannerInput(
  task
) {
  assertObject(
    task,
    "task"
  );

  return {
    taskId: task.id,
    title: task.title,
    description: task.description,
    type: task.type,
    requirements: task.requirements || [],
    deliverables: task.deliverables || [],
    deadline: task.deadline || "",
    difficulty: task.difficulty || "unknown",
    requiredSkills: task.requiredSkills || [],
    risk: task.risk || "low"
  };
}

async function planProjectTasks(
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

  const tasks =
    resolveProjectTasks(
      project
    );

  if (
    tasks.length === 0
  ) {
    throw new Error(
      `Project has no linked tasks: ${project.projectId}`
    );
  }

  const plans = [];

  for (
    const task of tasks
  ) {
    const result =
      await createTaskPlan(
        buildPlannerInput(task),
        {
          persist:
            input.persistUnderstanding !== false
        }
      );

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
      validatePlan(
        plan
      );

    if (!validation.valid) {
      throw new Error(
        `Generated task plan is invalid: ${task.id}`
      );
    }

    plans.push({
      taskId: task.id,
      plan,
      validation,
      feasibility:
        plan.feasibility,
      executionAllowed: false,
      planningOnly: true
    });
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
    executionAllowed: false,
    planningOnly: true
  };
}

module.exports = {
  resolvePlanningProject,
  resolveProjectTasks,
  buildPlannerInput,
  planProjectTasks
};
