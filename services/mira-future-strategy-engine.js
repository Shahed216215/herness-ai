"use strict";

const experienceMemory =
  require(
    "./mira-experience-memory"
  );

const ENGINE_VERSION =
  "6.4.6";

const MAX_STRATEGIES =
  5000;

const MAX_RESULTS =
  20;

function cleanText(
  value,
  maxLength = 2000
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(
      0,
      maxLength
    );
}

function cleanList(
  value,
  maxItems = 100
) {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter(
          item =>
            typeof item ===
            "string"
        )
        .map(
          item =>
            item.trim()
        )
        .filter(Boolean)
    )
  ].slice(
    0,
    maxItems
  );
}

function tokenize(
  text
) {
  return [
    ...new Set(
      cleanText(
        text,
        10000
      )
        .toLowerCase()
        .replace(
          /[^a-z0-9\u0980-\u09ff]+/gi,
          " "
        )
        .split(/\s+/)
        .filter(
          token =>
            token.length >= 3
        )
    )
  ];
}

function buildStrategyText(
  lesson
) {
  const value =
    cleanText(
      lesson,
      2000
    );

  if (!value) {
    return "";
  }

  return value;
}

function strategyFromLesson(
  lessonEntry
) {
  const lesson =
    buildStrategyText(
      lessonEntry.lesson
    );

  if (!lesson) {
    return null;
  }

  return {
    strategy:
      lesson,

    type:
      "lesson_derived",

    source: {
      learningId:
        cleanText(
          lessonEntry.learningId,
          200
        ),
      taskId:
        cleanText(
          lessonEntry.taskId,
          200
        ),
      executionId:
        cleanText(
          lessonEntry.executionId,
          200
        ),
      createdAt:
        cleanText(
          lessonEntry.createdAt,
          100
        )
    },

    applicability:
      {
        taskId:
          cleanText(
            lessonEntry.taskId,
            200
          )
      },

    governance:
      {
        executable:
          false,

        modifiesCode:
          false,

        bypassesPolicy:
          false,

        requiresNormalTaskChecks:
          true
      }
  };
}

function getAllStrategies(
  options = {}
) {
  const lessons =
    experienceMemory.listLessons(
      {
        taskId:
          options.taskId,
        status:
          options.status,
        qaStatus:
          options.qaStatus,
        limit:
          MAX_STRATEGIES
      }
    );

  const strategies = [];

  const seen =
    new Set();

  for (
    const lesson of lessons
  ) {
    const strategy =
      strategyFromLesson(
        lesson
      );

    if (!strategy) {
      continue;
    }

    const key =
      [
        strategy.strategy
          .toLowerCase(),
        strategy.source.learningId
      ].join(
        "::"
      );

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    strategies.push(
      strategy
    );
  }

  return strategies.slice(
    0,
    MAX_STRATEGIES
  );
}

function calculateRelevance(
  taskText,
  strategyText
) {
  const taskTokens =
    tokenize(
      taskText
    );

  const strategyTokens =
    tokenize(
      strategyText
    );

  if (
    taskTokens.length === 0 ||
    strategyTokens.length === 0
  ) {
    return {
      score: 0,
      matchedTerms: []
    };
  }

  const strategySet =
    new Set(
      strategyTokens
    );

  const matchedTerms =
    taskTokens.filter(
      token =>
        strategySet.has(
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

function retrieveStrategies(
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

  const strategies =
    getAllStrategies(
      options
    );

  return strategies
    .map(
      strategy => {
        const relevance =
          calculateRelevance(
            text,
            strategy.strategy
          );

        return {
          ...strategy,
          relevance
        };
      }
    )
    .filter(
      item =>
        item.relevance.score >
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

function getStrategiesForTask(
  task = {},
  options = {}
) {
  const taskText =
    [
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

  return retrieveStrategies(
    taskText,
    options
  );
}

function getStrategyStats() {
  const strategies =
    getAllStrategies();

  return {
    engineVersion:
      ENGINE_VERSION,

    strategyCount:
      strategies.length,

    sourceLessonCount:
      strategies.length,

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
  MAX_STRATEGIES,
  MAX_RESULTS,

  cleanText,
  cleanList,
  tokenize,

  strategyFromLesson,
  getAllStrategies,

  calculateRelevance,
  retrieveStrategies,
  getStrategiesForTask,

  getStrategyStats
};
