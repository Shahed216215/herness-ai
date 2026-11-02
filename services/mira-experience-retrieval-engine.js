"use strict";

const experienceMemory =
  require("./mira-experience-memory");

const ENGINE_VERSION = "6.4.7";
const MAX_RESULTS = 20;

function cleanText(
  value,
  maxLength = 5000
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(0, maxLength);
}

function cleanList(
  value,
  maxItems = 50
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      item =>
        typeof item ===
        "string"
    )
    .map(
      item =>
        cleanText(
          item,
          2000
        )
    )
    .filter(Boolean)
    .slice(
      0,
      maxItems
    );
}

function tokenize(text) {
  return [
    ...new Set(
      cleanText(
        text,
        10000
      )
        .toLowerCase()
        .match(
          /[\p{L}\p{N}]+/gu
        ) || []
    )
  ];
}

function buildExperienceText(
  experience
) {
  if (
    !experience ||
    typeof experience !==
      "object"
  ) {
    return "";
  }

  const task =
    experience.task || {};

  const approach =
    experience.approach || {};

  const result =
    experience.result || {};

  const feedback =
    experience.feedback || {};

  const performance =
    experience.performance || {};

  const error =
    experience.error || {};

  const correction =
    experience.correction || {};

  const parts = [
    task.title,
    task.description,
    ...cleanList(
      task.requirements
    ),

    approach.goal,
    approach.executionStage,
    approach.executionStatus,

    result.status,

    ...cleanList(
      feedback.comments
    ),
    ...cleanList(
      feedback.requestedChanges
    ),

    performance.qaStatus,

    error.executionStatus,
    error.recoveryReason,
    ...cleanList(
      error.failedChecks
    ),
    ...cleanList(
      error.reasons
    ),
    ...cleanList(
      error.whatFailed
    ),

    correction.status,
    correction.reworkContext,
    ...cleanList(
      correction.requestedChanges
    ),

    ...cleanList(
      experience.lessons
    )
  ];

  return parts
    .filter(
      value =>
        typeof value ===
          "string" &&
        value.trim()
    )
    .join(" ");
}

function calculateRelevance(
  taskText,
  experience
) {
  const taskTokens =
    tokenize(
      taskText
    );

  const experienceTokens =
    tokenize(
      buildExperienceText(
        experience
      )
    );

  if (
    taskTokens.length === 0 ||
    experienceTokens.length === 0
  ) {
    return {
      score: 0,
      matchedTerms: []
    };
  }

  const experienceSet =
    new Set(
      experienceTokens
    );

  const matchedTerms =
    taskTokens.filter(
      token =>
        experienceSet.has(
          token
        )
    );

  const score =
    matchedTerms.length /
    taskTokens.length;

  return {
    score:
      Number(
        score.toFixed(4)
      ),
    matchedTerms
  };
}

function normalizeRetrievedExperience(
  experience,
  relevance
) {
  return {
    experienceId:
      experience.experienceId,

    source:
      experience.source,

    task:
      experience.task,

    approach:
      experience.approach,

    result:
      experience.result,

    feedback:
      experience.feedback,

    performance:
      experience.performance,

    error:
      experience.error,

    correction:
      experience.correction,

    lessons:
      Array.isArray(experience.lessons)
        ? experience.lessons
        : (
            Array.isArray(experience.lesson)
              ? experience.lesson
              : (
                  experience.lesson
                    ? [experience.lesson]
                    : []
                )
          ),

    relevance,

    governance: {
      executable: false,
      modifiesCode: false,
      bypassesPolicy: false,
      requiresNormalTaskChecks:
        true
    }
  };
}

function retrieveExperiences(
  taskText,
  options = {}
) {
  const text =
    cleanText(
      taskText,
      10000
    );

  if (!text) {
    return [];
  }

  const experiences =
    experienceMemory.listExperiences(
      {
        taskId:
          options.taskId,
        status:
          options.status,
        qaStatus:
          options.qaStatus,
        limit:
          experienceMemory.MAX_EXPERIENCES
      }
    );

  return experiences
    .map(
      experience => {
        const relevance =
          calculateRelevance(
            text,
            experience
          );

        return normalizeRetrievedExperience(
          experience,
          relevance
        );
      }
    )
    .filter(
      experience =>
        experience.relevance.score >
        0
    )
    .sort(
      (a, b) =>
        b.relevance.score -
        a.relevance.score
    )
    .slice(
      0,
      options.limit ||
        MAX_RESULTS
    );
}

function getExperiencesForTask(
  task = {},
  options = {}
) {
  const taskText = [
    task.title,
    task.description,
    ...(Array.isArray(
      task.requirements
    )
      ? task.requirements
      : [])
  ]
    .filter(
      value =>
        typeof value ===
        "string"
    )
    .join(" ");

  return retrieveExperiences(
    taskText,
    options
  );
}

function getRetrievalStats() {
  const experiences =
    experienceMemory.listExperiences(
      {
        limit:
          experienceMemory.MAX_EXPERIENCES
      }
    );

  return {
    engineVersion:
      ENGINE_VERSION,

    sourceEngineVersion:
      experienceMemory.ENGINE_VERSION,

    sourceExperienceCount:
      experiences.length,

    retrievalIsReadOnly:
      true,

    autonomousExecution:
      false,

    sourceWritable:
      false,

    governanceBypass:
      false
  };
}

module.exports = {
  ENGINE_VERSION,
  MAX_RESULTS,

  cleanText,
  cleanList,
  tokenize,

  buildExperienceText,
  calculateRelevance,

  normalizeRetrievedExperience,

  retrieveExperiences,
  getExperiencesForTask,

  getRetrievalStats
};
