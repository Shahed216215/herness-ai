"use strict";

const PLAN_STATUSES = Object.freeze([
  "draft",
  "validated",
  "blocked",
  "rejected",
  "ready_for_execution",
  "replanning_required"
]);

const PLAN_FEASIBILITY = Object.freeze([
  "feasible",
  "blocked_missing_requirements",
  "infeasible"
]);

function now() {
  return new Date().toISOString();
}

function cleanText(value, field, max = 5000) {
  if (value === undefined || value === null) {
    return "";
  }

  const text = String(value).trim();

  if (text.length > max) {
    throw new Error(`${field} exceeds maximum length.`);
  }

  return text;
}

function cleanList(value, field, maxItems = 100) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }

  if (value.length > maxItems) {
    throw new Error(`${field} exceeds maximum item count.`);
  }

  return value.map(item => cleanText(item, field, 2000));
}

function normalizeStatus(value) {
  const status = String(value || "draft").trim().toLowerCase();

  if (!PLAN_STATUSES.includes(status)) {
    throw new Error("Invalid plan status.");
  }

  return status;
}

function normalizeFeasibility(value) {
  const feasibility = String(value || "feasible").trim().toLowerCase();

  if (!PLAN_FEASIBILITY.includes(feasibility)) {
    throw new Error("Invalid plan feasibility.");
  }

  return feasibility;
}

function createPlanId() {
  return `plan-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 14)}`;
}

function createSubtask(input = {}, index = 0) {
  const id = cleanText(
    input.id || `subtask-${index + 1}`,
    "subtask.id",
    100
  );

  const title = cleanText(input.title, "subtask.title", 500);

  if (!title) {
    throw new Error("subtask.title is required.");
  }

  return {
    id,
    title,
    objective: cleanText(input.objective, "subtask.objective", 2000),
    dependencies: cleanList(
      input.dependencies,
      "subtask.dependencies",
      100
    ),
    inputs: cleanList(input.inputs, "subtask.inputs", 100),
    outputs: cleanList(input.outputs, "subtask.outputs", 100),
    verification: cleanList(
      input.verification,
      "subtask.verification",
      100
    ),
    order: Number.isInteger(input.order) ? input.order : index + 1
  };
}

function createPlan(input = {}) {
  const createdAt = now();

  if (!input.taskId) {
    throw new Error("taskId is required.");
  }

  const subtasks = Array.isArray(input.subtasks)
    ? input.subtasks.map((item, index) => createSubtask(item, index))
    : [];

  const executionSteps = Array.isArray(input.executionPlan)
    ? input.executionPlan.map((step, index) => ({
        step: index + 1,
        subtaskId: cleanText(
          step.subtaskId,
          "executionPlan.subtaskId",
          100
        ),
        action: cleanText(
          step.action,
          "executionPlan.action",
          2000
        ),
        expectedOutput: cleanText(
          step.expectedOutput,
          "executionPlan.expectedOutput",
          2000
        )
      }))
    : [];

  const verificationPlan = Array.isArray(input.verificationPlan)
    ? input.verificationPlan.map((item, index) => ({
        checkId: cleanText(
          item.checkId || `check-${index + 1}`,
          "verificationPlan.checkId",
          100
        ),
        target: cleanText(
          item.target,
          "verificationPlan.target",
          1000
        ),
        method: cleanText(
          item.method,
          "verificationPlan.method",
          2000
        ),
        expected: cleanText(
          item.expected,
          "verificationPlan.expected",
          2000
        ),
        required: item.required !== false
      }))
    : [];

  const deliverable = {
    type: cleanText(
      input.deliverable?.type,
      "deliverable.type",
      200
    ),
    description: cleanText(
      input.deliverable?.description,
      "deliverable.description",
      3000
    ),
    outputs: cleanList(
      input.deliverable?.outputs,
      "deliverable.outputs",
      100
    ),
    acceptanceCriteria: cleanList(
      input.deliverable?.acceptanceCriteria,
      "deliverable.acceptanceCriteria",
      100
    )
  };

  return {
    id: input.id || createPlanId(),
    version: Number.isInteger(input.version) ? input.version : 1,
    taskId: cleanText(input.taskId, "taskId", 200),
    goal: cleanText(input.goal, "goal", 5000),
    requirements: cleanList(
      input.requirements,
      "requirements",
      100
    ),
    subtasks,
    missingRequirements: cleanList(
      input.missingRequirements,
      "missingRequirements",
      100
    ),
    feasibility: normalizeFeasibility(input.feasibility),
    feasibilityReasons: cleanList(
      input.feasibilityReasons,
      "feasibilityReasons",
      100
    ),
    executionPlan: executionSteps,
    verificationPlan,
    deliverable,
    status: normalizeStatus(input.status),
    executionAllowed: false,
    planningOnly: true,
    createdAt: input.createdAt || createdAt,
    updatedAt: createdAt,
    parentPlanId: cleanText(
      input.parentPlanId,
      "parentPlanId",
      200
    ),
    replanningReason: cleanText(
      input.replanningReason,
      "replanningReason",
      3000
    )
  };
}

module.exports = {
  PLAN_STATUSES,
  PLAN_FEASIBILITY,
  createSubtask,
  createPlan
};
