"use strict";

const {
  executeWork
} = require("./mira-work-execution-engine");

const {
  runQualityAssurance
} = require("./mira-quality-assurance-engine");

const {
  learnFromWork
} = require("./mira-work-learning-engine");

const {
  getTask
} = require("../task-store");

const ENGINE_VERSION = "6.2.2";

function asObject(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : {};
}

function resolveTask(input = {}, executionResult = {}) {
  const requestedTask =
    asObject(input.task);

  const taskId =
    requestedTask.id ||
    requestedTask.taskId ||
    executionResult.taskId ||
    asObject(input.plan).taskId ||
    "";

  if (taskId) {
    const storedTask = getTask(taskId);

    if (storedTask) {
      return storedTask;
    }
  }

  return requestedTask;
}

function assertTask(task) {
  if (!task || typeof task !== "object") {
    throw new Error(
      "Integration requires a canonical task object."
    );
  }

  if (!task.id && !task.taskId) {
    throw new Error(
      "Integration task must contain id or taskId."
    );
  }

  return task;
}

async function executeQualityLearningHandoff(
  input = {},
  options = {}
) {
  const plan =
    asObject(input.plan);

  if (!plan.taskId) {
    return {
      success: false,
      stage: "6.2",
      engineVersion: ENGINE_VERSION,
      status: "handoff_rejected",
      error:
        "A validated plan with taskId is required."
    };
  }

  const executionResult =
    input.executionResult ||
    await executeWork(
      input.task ||
      input.description ||
      "",
      {
        plan,
        taskUnderstanding:
          input.taskUnderstanding,
        toolCalls:
          Array.isArray(options.toolCalls)
            ? options.toolCalls
            : input.toolCalls,
        persist:
          options.persist !== false,
        permissionGranted:
          options.permissionGranted === true
      }
    );

  const task =
    assertTask(
      resolveTask(
        input,
        executionResult
      )
    );

  const qaResult =
    input.qaResult ||
    await runQualityAssurance({
      task,
      plan,
      executionResult,
      persistAudit:
        options.persistAudit !== false,
      reworkAttempts:
        Number.isInteger(
          options.reworkAttempts
        )
          ? options.reworkAttempts
          : 0,
      maxReworkAttempts:
        Number.isInteger(
          options.maxReworkAttempts
        )
          ? options.maxReworkAttempts
          : undefined
    });

  const learningResult =
    input.learningResult ||
    await learnFromWork(
      {
        task,
        plan,
        executionResult,
        qaResult,
        feedback:
          input.feedback || {}
      },
      {
        createImprovementProposal:
          options.createImprovementProposal !== false
      }
    );

  return {
    success:
      executionResult.success === true &&
      qaResult.finalAcceptance === true &&
      learningResult.success === true,

    stage: "6.2",
    engineVersion: ENGINE_VERSION,

    status:
      learningResult.status,

    taskId:
      task.id ||
      task.taskId,

    planId:
      plan.id || "",

    execution: executionResult,

    qualityAssurance: qaResult,

    learning: learningResult,

    governanceBoundary: {
      proposalCreated:
        learningResult.proposal !== null,

      approvalRequired: true,

      autoApproved: false,

      autoApplied: false
    }
  };
}

module.exports = {
  ENGINE_VERSION,
  resolveTask,
  executeQualityLearningHandoff
};
