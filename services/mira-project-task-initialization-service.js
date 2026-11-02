"use strict";

const {
  getProject,
  updateProject
} = require("../project-store");

const {
  createStoredTask
} = require("../task-store");

const {
  TASK_STATUSES
} = require("../task-schema");

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

function normalizeTaskSpecification(
  specification
) {
  assertObject(
    specification,
    "task specification"
  );

  const title =
    typeof specification.title === "string"
      ? specification.title.trim()
      : "";

  const description =
    typeof specification.description === "string"
      ? specification.description.trim()
      : title;

  if (!title) {
    throw new Error(
      "Task title is required."
    );
  }

  if (!description) {
    throw new Error(
      "Task description is required."
    );
  }

  return {
    title,
    description,
    type:
      specification.type ||
      "research",
    requirements:
      Array.isArray(
        specification.requirements
      )
        ? specification.requirements
        : [],
    deliverables:
      Array.isArray(
        specification.deliverables
      )
        ? specification.deliverables
        : [],
    deadline:
      specification.deadline,
    difficulty:
      specification.difficulty ||
      "unknown",
    requiredSkills:
      Array.isArray(
        specification.requiredSkills
      )
        ? specification.requiredSkills
        : [],
    risk:
      specification.risk ||
      "low",
    source:
      specification.source ||
      "mira-project-task-initialization"
  };
}

function resolvePlanningProject(
  projectId
) {
  if (
    typeof projectId !== "string" ||
    projectId.trim().length === 0
  ) {
    throw new Error(
      "projectId is required."
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
    project.executionAllowed !== false ||
    project.planningOnly !== true
  ) {
    throw new Error(
      `Project is not planning-only: ${projectId}`
    );
  }

  return project;
}

function initializeProjectTasks(
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

  if (
    !Array.isArray(
      input.tasks
    ) ||
    input.tasks.length === 0
  ) {
    throw new Error(
      "At least one task specification is required."
    );
  }

  const existingTaskIds =
    Array.isArray(project.taskIds)
      ? [...project.taskIds]
      : [];

  const createdTasks = [];

  for (
    const specification of input.tasks
  ) {
    const normalized =
      normalizeTaskSpecification(
        specification
      );

    const created =
      createStoredTask({
        ...normalized,
        status:
          TASK_STATUSES.includes("new")
            ? "new"
            : undefined
      });

    if (
      !created ||
      created.ok !== true ||
      !created.task
    ) {
      throw new Error(
        `Failed to create task: ${normalized.title}`
      );
    }

    createdTasks.push(
      created.task
    );

    existingTaskIds.push(
      created.task.id
    );
  }

  const uniqueTaskIds = [
    ...new Set(existingTaskIds)
  ];

  const updated =
    updateProject(
      project.projectId,
      {
        taskIds:
          uniqueTaskIds
      }
    );

  if (!updated) {
    throw new Error(
      `Failed to update project task linkage: ${project.projectId}`
    );
  }

  return {
    project:
      updated,
    tasks:
      createdTasks,
    taskIds:
      createdTasks.map(
        task => task.id
      ),
    executionAllowed:
      false,
    planningOnly:
      true
  };
}

module.exports = {
  resolvePlanningProject,
  normalizeTaskSpecification,
  initializeProjectTasks
};
