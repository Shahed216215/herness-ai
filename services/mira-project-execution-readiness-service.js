"use strict";

const {
  validateProjectExecutionReadiness,
  createProjectExecutionReadiness,
  createReadinessCheck
} = require("../project-execution-readiness-schema");

const {
  getProject
} = require("../project-store");

const {
  getSchedule
} = require("../project-schedule-store");

const {
  getTask
} = require("../task-store");

const {
  validatePlan
} = require("./mira-task-planner");

function assertObject(value, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${name} must be an object.`);
  }
}

function resolvePlanningProject(projectId) {
  const project =
    getProject(projectId);

  if (!project) {
    throw new Error(
      `Project not found: ${projectId}`
    );
  }

  if (project.status !== "planning") {
    throw new Error(
      `Project must remain planning for readiness evaluation: ${projectId}`
    );
  }

  if (project.executionAllowed !== false) {
    throw new Error(
      "Project executionAllowed must remain false."
    );
  }

  if (project.planningOnly !== true) {
    throw new Error(
      "Project planningOnly must remain true."
    );
  }

  if (project.externalActionPerformed !== false) {
    throw new Error(
      "Project externalActionPerformed must remain false."
    );
  }

  if (project.paymentAllowed !== false) {
    throw new Error(
      "Project paymentAllowed must remain false."
    );
  }

  if (
    project.paymentTransferAuthorized !==
    false
  ) {
    throw new Error(
      "Project paymentTransferAuthorized must remain false."
    );
  }

  if (
    project.contractSigningAllowed !==
    false
  ) {
    throw new Error(
      "Project contractSigningAllowed must remain false."
    );
  }

  return project;
}

function resolveProjectSchedule(
  projectId,
  scheduleId
) {
  const schedule =
    getSchedule(scheduleId);

  if (!schedule) {
    throw new Error(
      `Schedule not found: ${scheduleId}`
    );
  }

  if (schedule.projectId !== projectId) {
    throw new Error(
      `Schedule does not belong to project: ${scheduleId}`
    );
  }

  return schedule;
}

function resolveProjectTasks(project) {
  if (
    !Array.isArray(project.taskIds) ||
    project.taskIds.length === 0
  ) {
    throw new Error(
      `Project has no linked tasks: ${project.projectId}`
    );
  }

  const tasks = [];

  for (const taskId of project.taskIds) {
    const task =
      getTask(taskId);

    if (!task) {
      throw new Error(
        `Linked project task not found: ${taskId}`
      );
    }

    tasks.push(task);
  }

  return tasks;
}

function normalizePlans(
  project,
  plans
) {
  if (!Array.isArray(plans)) {
    throw new Error(
      "plans must be an array."
    );
  }

  const byTaskId = new Map();

  for (const item of plans) {
    assertObject(
      item,
      "plan item"
    );

    const taskId =
      String(
        item.taskId ||
        item.plan?.taskId ||
        ""
      ).trim();

    if (!taskId) {
      throw new Error(
        "Every plan item requires taskId."
      );
    }

    if (byTaskId.has(taskId)) {
      throw new Error(
        `Duplicate plan for task: ${taskId}`
      );
    }

    if (
      !item.plan ||
      typeof item.plan !== "object" ||
      Array.isArray(item.plan)
    ) {
      throw new Error(
        `Plan is required for task: ${taskId}`
      );
    }

    byTaskId.set(
      taskId,
      item
    );
  }

  return byTaskId;
}

function buildCheck(
  checkId,
  passed,
  reason,
  details = {}
) {
  return createReadinessCheck({
    checkId,
    passed,
    reason,
    details
  });
}

function evaluateProjectExecutionReadiness(
  input
) {
  assertObject(
    input,
    "input"
  );

  const projectId =
    String(
      input.projectId || ""
    ).trim();

  if (!projectId) {
    throw new Error(
      "projectId is required."
    );
  }

  const scheduleId =
    String(
      input.scheduleId || ""
    ).trim();

  if (!scheduleId) {
    throw new Error(
      "scheduleId is required."
    );
  }

  const project =
    resolvePlanningProject(
      projectId
    );

  const schedule =
    resolveProjectSchedule(
      projectId,
      scheduleId
    );

  const tasks =
    resolveProjectTasks(
      project
    );

  const planMap =
    normalizePlans(
      project,
      input.plans
    );

  const checks = [];
  const blockingReasons = [];

  function addCheck(
    checkId,
    passed,
    reason,
    details
  ) {
    checks.push(
      buildCheck(
        checkId,
        passed,
        reason,
        details
      )
    );

    if (!passed) {
      blockingReasons.push(
        reason
      );
    }
  }

  addCheck(
    "project-planning-state",
    project.status === "planning",
    project.status === "planning"
      ? "Project is in planning state."
      : `Project status is ${project.status}.`,
    {
      projectStatus:
        project.status
    }
  );

  addCheck(
    "project-safety-flags",
    project.executionAllowed === false &&
      project.planningOnly === true &&
      project.externalActionPerformed === false &&
      project.paymentAllowed === false &&
      project.paymentTransferAuthorized === false &&
      project.contractSigningAllowed === false,
    "Project safety flags must remain non-executable.",
    {
      executionAllowed:
        project.executionAllowed,
      planningOnly:
        project.planningOnly,
      externalActionPerformed:
        project.externalActionPerformed,
      paymentAllowed:
        project.paymentAllowed,
      paymentTransferAuthorized:
        project.paymentTransferAuthorized,
      contractSigningAllowed:
        project.contractSigningAllowed
    }
  );

  addCheck(
    "schedule-project-link",
    schedule.projectId === project.projectId,
    schedule.projectId === project.projectId
      ? "Schedule belongs to the project."
      : "Schedule project linkage is invalid.",
    {
      projectId:
        project.projectId,
      scheduleProjectId:
        schedule.projectId
    }
  );

  addCheck(
    "schedule-planned-state",
    schedule.status === "planned",
    schedule.status === "planned"
      ? "Schedule is planned."
      : `Schedule status is ${schedule.status}.`,
    {
      scheduleStatus:
        schedule.status
    }
  );

  addCheck(
    "schedule-safety-flags",
    schedule.executionAllowed === false &&
      schedule.planningOnly === true &&
      schedule.externalActionPerformed === false &&
      schedule.paymentAllowed === false &&
      schedule.paymentTransferAuthorized === false &&
      schedule.contractSigningAllowed === false,
    "Schedule safety flags must remain non-executable.",
    {
      executionAllowed:
        schedule.executionAllowed,
      planningOnly:
        schedule.planningOnly,
      externalActionPerformed:
        schedule.externalActionPerformed,
      paymentAllowed:
        schedule.paymentAllowed,
      paymentTransferAuthorized:
        schedule.paymentTransferAuthorized,
      contractSigningAllowed:
        schedule.contractSigningAllowed
    }
  );

  const projectTaskIds =
    project.taskIds;

  const scheduleTaskIds =
    schedule.entries.map(
      entry => entry.taskId
    );

  const projectTaskSet =
    new Set(projectTaskIds);

  const scheduleTaskSet =
    new Set(scheduleTaskIds);

  const exactTaskLinkage =
    projectTaskIds.length ===
      scheduleTaskIds.length &&
    projectTaskIds.every(
      taskId =>
        scheduleTaskSet.has(taskId)
    ) &&
    scheduleTaskIds.every(
      taskId =>
        projectTaskSet.has(taskId)
    );

  addCheck(
    "schedule-task-linkage",
    exactTaskLinkage,
    exactTaskLinkage
      ? "Schedule entries exactly match project task IDs."
      : "Schedule entries do not exactly match project task IDs.",
    {
      projectTaskIds,
      scheduleTaskIds
    }
  );

  const allTasksNew =
    tasks.every(
      task => task.status === "new"
    );

  addCheck(
    "all-tasks-new",
    allTasksNew,
    allTasksNew
      ? "All linked tasks remain new."
      : "Every linked task must remain new before execution readiness.",
    {
      taskStatuses:
        tasks.map(task => ({
          taskId: task.id,
          status: task.status
        }))
    }
  );

  const scheduleEntryIds =
    new Set(
      schedule.entries.map(
        entry => entry.taskId
      )
    );

  for (const task of tasks) {
    const entry =
      schedule.entries.find(
        item =>
          item.taskId === task.id
      );

    const item =
      planMap.get(
        task.id
      );

    const plan =
      item &&
      item.plan;

    const hasPlan =
      Boolean(plan);

    addCheck(
      `plan-present-${task.id}`,
      hasPlan,
      hasPlan
        ? `Plan is present for task ${task.id}.`
        : `Plan is missing for task ${task.id}.`,
      {
        taskId: task.id,
        planId:
          plan?.id || ""
      }
    );

    if (!hasPlan) {
      continue;
    }

    const planTaskMatch =
      plan.taskId === task.id;

    addCheck(
      `plan-task-link-${task.id}`,
      planTaskMatch,
      planTaskMatch
        ? `Plan task linkage is valid for ${task.id}.`
        : `Plan taskId does not match task ${task.id}.`,
      {
        taskId: task.id,
        planTaskId:
          plan.taskId
      }
    );

    const planValidation =
      validatePlan(
        plan
      );

    addCheck(
      `plan-validation-${task.id}`,
      planValidation.valid === true,
      planValidation.valid
        ? `Plan validation passed for ${task.id}.`
        : `Plan validation failed for ${task.id}.`,
      {
        errors:
          planValidation.errors,
        warnings:
          planValidation.warnings
      }
    );

    addCheck(
      `plan-feasibility-${task.id}`,
      plan.feasibility === "feasible",
      plan.feasibility === "feasible"
        ? `Plan is feasible for ${task.id}.`
        : `Plan is not feasible for ${task.id}.`,
      {
        feasibility:
          plan.feasibility
      }
    );

    addCheck(
      `plan-safety-${task.id}`,
      plan.executionAllowed === false &&
        plan.planningOnly === true,
      "Plan must remain planning-only and non-executable.",
      {
        executionAllowed:
          plan.executionAllowed,
        planningOnly:
          plan.planningOnly
      }
    );

    const entryPlanMatch =
      Boolean(entry) &&
      entry.planId === plan.id;

    addCheck(
      `schedule-plan-link-${task.id}`,
      entryPlanMatch,
      entryPlanMatch
        ? `Schedule plan linkage is valid for ${task.id}.`
        : `Schedule planId does not match the supplied plan for ${task.id}.`,
      {
        taskId: task.id,
        schedulePlanId:
          entry?.planId || "",
        suppliedPlanId:
          plan.id
      }
    );

    const subtaskIds =
      new Set(
        (plan.subtasks || []).map(
          subtask => subtask.id
        )
      );

    const dependencies =
      entry &&
      Array.isArray(entry.dependencies)
        ? entry.dependencies
        : [];

    const dependenciesValid =
      Boolean(entry) &&
      dependencies.every(
        dependency =>
          subtaskIds.has(
            dependency
          )
      );

    addCheck(
      `schedule-dependencies-${task.id}`,
      dependenciesValid,
      dependenciesValid
        ? `Schedule dependencies are valid for ${task.id}.`
        : `Schedule contains unknown subtask dependency for ${task.id}.`,
      {
        taskId: task.id,
        dependencies,
        subtaskIds:
          Array.from(subtaskIds)
      }
    );
  }

  const allPlansExact =
    planMap.size ===
      projectTaskIds.length &&
    projectTaskIds.every(
      taskId =>
        planMap.has(taskId)
    ) &&
    Array.from(planMap.keys()).every(
      taskId =>
        projectTaskSet.has(taskId)
    );

  addCheck(
    "plan-set-exact",
    allPlansExact,
    allPlansExact
      ? "Supplied plans exactly match project tasks."
      : "Supplied plans do not exactly match project tasks.",
    {
      projectTaskIds,
      suppliedPlanTaskIds:
        Array.from(planMap.keys())
    }
  );

  const readiness =
    createProjectExecutionReadiness({
      readinessId:
        input.readinessId,

      projectId,

      scheduleId,

      status:
        blockingReasons.length === 0
          ? "ready"
          : "blocked",

      decision:
        blockingReasons.length === 0
          ? "ready"
          : "blocked",

      checks,

      blockingReasons
    });

  const validation =
    validateProjectExecutionReadiness(
      readiness
    );

  if (!validation.valid) {
    throw new Error(
      `Generated readiness artifact is invalid: ${validation.errors.join("; ")}`
    );
  }

  return {
    readiness,
    project,
    schedule,
    tasks,
    plans: Array.from(
      planMap.values()
    ).map(
      item => item.plan
    ),
    validation
  };
}

module.exports = {
  resolvePlanningProject,
  resolveProjectSchedule,
  resolveProjectTasks,
  normalizePlans,
  evaluateProjectExecutionReadiness
};
