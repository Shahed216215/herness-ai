"use strict";

const experienceRetrievalEngine =
  require("./mira-experience-retrieval-engine");

const futureStrategyEngine =
  require("./mira-future-strategy-engine");

const ENGINE_VERSION = "6.4.10";
const MAX_RESULTS = 20;

function cleanText(value, maxLength = 5000) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 50) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(item => typeof item === "string")
    .map(item => cleanText(item, 2000))
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildTaskText(task = {}) {
  return [
    task.title,
    task.description,
    ...cleanList(task.requirements)
  ]
    .filter(Boolean)
    .join(" ");
}

function isCrossTaskExperience(experience, currentTaskId) {
  if (!experience || typeof experience !== "object") {
    return false;
  }

  const sourceTaskId =
    cleanText(
      experience.source?.taskId ||
      experience.task?.id ||
      "",
      200
    );

  const currentId =
    cleanText(currentTaskId, 200);

  if (
    !currentId ||
    !sourceTaskId
  ) {
    return true;
  }

  return sourceTaskId !== currentId;
}

function normalizeTransfer(
  experience,
  strategyMatches
) {
  return {
    experienceId:
      experience.experienceId,

    source: {
      ...experience.source
    },

    sourceTask: {
      id: experience.task?.id || "",
      title: experience.task?.title || "",
      description:
        experience.task?.description || ""
    },

    relevance:
      experience.relevance || {
        score: 0,
        matchedTerms: []
      },

    lessons:
      cleanList(
        experience.lessons
      ),

    strategies:
      strategyMatches.map(
        strategy => ({
          strategy:
            strategy.strategy,

          type:
            strategy.type,

          relevance:
            strategy.relevance,

          source:
            strategy.source
        })
      ),

    governance: {
      executable: false,
      modifiesCode: false,
      bypassesPolicy: false,
      requiresNormalTaskChecks: true
    }
  };
}

function getCrossTaskLearning(
  task,
  options = {}
) {
  const taskObject =
    task && typeof task === "object"
      ? task
      : {};

  const taskText =
    buildTaskText(taskObject);

  const currentTaskId =
    cleanText(
      taskObject.id ||
      taskObject.taskId ||
      "",
      200
    );

  if (!taskText) {
    return {
      engineVersion: ENGINE_VERSION,
      taskId: currentTaskId,
      transfers: [],
      count: 0,
      governance: {
        readOnly: true,
        executable: false,
        modifiesCode: false,
        bypassesPolicy: false,
        requiresNormalTaskChecks: true
      }
    };
  }

  const requestedLimit =
    Number.isInteger(options.limit)
      ? options.limit
      : MAX_RESULTS;

  const limit =
    Math.max(
      1,
      Math.min(
        requestedLimit,
        MAX_RESULTS
      )
    );

  const retrieved =
    experienceRetrievalEngine.retrieveExperiences(
      taskText,
      {
        limit:
          Math.max(
            limit * 3,
            limit
          )
      }
    );

  const crossTask =
    retrieved.filter(
      experience =>
        isCrossTaskExperience(
          experience,
          currentTaskId
        )
    );

  const transfers = [];

  for (
    const experience of crossTask
  ) {
    const strategyMatches =
      futureStrategyEngine.getStrategiesForTask(
        taskText,
        {
          limit: 10
        }
      ).filter(
        strategy =>
          strategy.source?.learningId ===
          experience.source?.learningId
      );

    const transfer =
      normalizeTransfer(
        experience,
        strategyMatches
      );

    if (
      transfer.lessons.length === 0 &&
      transfer.strategies.length === 0
    ) {
      continue;
    }

    transfers.push(
      transfer
    );

    if (
      transfers.length >= limit
    ) {
      break;
    }
  }

  return {
    engineVersion:
      ENGINE_VERSION,

    taskId:
      currentTaskId,

    transfers,

    count:
      transfers.length,

    governance: {
      readOnly: true,
      executable: false,
      modifiesCode: false,
      bypassesPolicy: false,
      requiresNormalTaskChecks: true
    }
  };
}

function getCrossTaskLearningStats() {
  return {
    engineVersion:
      ENGINE_VERSION,

    maxResults:
      MAX_RESULTS,

    readOnly:
      true,

    sourceWritable:
      false,

    autonomousExecution:
      false,

    governanceBypass:
      false
  };
}

module.exports = {
  ENGINE_VERSION,
  MAX_RESULTS,
  getCrossTaskLearning,
  getCrossTaskLearningStats
};
