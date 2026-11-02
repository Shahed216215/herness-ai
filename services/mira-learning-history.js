"use strict";

const experienceMemory =
  require("./mira-experience-memory");

const futureStrategyEngine =
  require("./mira-future-strategy-engine");

const ENGINE_VERSION = "6.4.8.1";

const MAX_RESULTS = 100;

function cleanText(
  value,
  maxLength = 2000
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
  maxItems = 100
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      item =>
        typeof item === "string"
    )
    .map(
      item =>
        cleanText(item, 2000)
    )
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeHistoryEntry(
  experience
) {
  if (
    !experience ||
    typeof experience !== "object"
  ) {
    return null;
  }

  const source =
    experience.source || {};

  const task =
    experience.task || {};

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

  const lessonValue =
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
        );

  const lessons =
    cleanList(lessonValue);

  return {
    historyId:
      cleanText(
        experience.experienceId,
        200
      ),

    source: {
      type:
        "experience-memory",
      learningId:
        cleanText(
          source.learningId,
          200
        ),
      taskId:
        cleanText(
          source.taskId,
          200
        ),
      executionId:
        cleanText(
          source.executionId,
          200
        ),
      planId:
        cleanText(
          source.planId,
          200
        )
    },

    task: {
      id:
        cleanText(
          task.id,
          200
        ),
      title:
        cleanText(
          task.title,
          300
        ),
      description:
        cleanText(
          task.description
        ),
      type:
        cleanText(
          task.type,
          100
        ),
      difficulty:
        cleanText(
          task.difficulty,
          100
        ),
      risk:
        cleanText(
          task.risk,
          100
        )
    },

    approach:
      experience.approach || {},

    result: {
      success:
        result.success === true,
      status:
        cleanText(
          result.status,
          100
        ),
      completedAt:
        cleanText(
          result.completedAt,
          100
        )
    },

    feedback: {
      provided:
        feedback.provided === true,
      comments:
        cleanText(
          feedback.comments
        ),
      requestedChanges:
        cleanList(
          feedback.requestedChanges
        )
    },

    performance: {
      qaStatus:
        cleanText(
          performance.qaStatus,
          100
        ),
      qaSuccess:
        performance.qaSuccess === true,
      failedChecks:
        cleanList(
          performance.failedChecks
        ),
      reworkRequired:
        performance.reworkRequired === true,
      evaluatedAt:
        cleanText(
          performance.evaluatedAt,
          100
        )
    },

    error: {
      executionFailed:
        error.executionFailed === true,
      executionStatus:
        cleanText(
          error.executionStatus,
          100
        ),
      recoveryRequired:
        error.recoveryRequired === true,
      recoveryReason:
        cleanText(
          error.recoveryReason
        ),
      failedChecks:
        cleanList(
          error.failedChecks
        ),
      reasons:
        cleanList(
          error.reasons
        )
    },

    correction: {
      reworkRequired:
        correction.reworkRequired === true,
      reworkContext:
        correction.reworkContext || null,
      requestedChanges:
        cleanList(
          correction.requestedChanges
        ),
      status:
        cleanText(
          correction.status,
          100
        )
    },

    lessons,

    timestamps: {
      createdAt:
        cleanText(
          experience.timestamps?.createdAt,
          100
        ),
      startedAt:
        cleanText(
          experience.timestamps?.startedAt,
          100
        ),
      completedAt:
        cleanText(
          experience.timestamps?.completedAt,
          100
        )
    },

    integrity: {
      sourceValid:
        experienceMemory.verifyExperienceIntegrity(
          experience
        ) === true
    },

    governance: {
      readOnly:
        true,
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

function listLearningHistory(
  options = {}
) {
  const experiences =
    experienceMemory.listExperiences({
      taskId:
        options.taskId,
      status:
        options.status,
      qaStatus:
        options.qaStatus,
      limit:
        experienceMemory.MAX_EXPERIENCES
    });

  let history =
    experiences
      .map(
        normalizeHistoryEntry
      )
      .filter(Boolean);

  history.sort(
    (a, b) =>
      String(
        b.timestamps.createdAt || ""
      ).localeCompare(
        String(
          a.timestamps.createdAt || ""
        )
      )
  );

  if (
    typeof options.success === "boolean"
  ) {
    history =
      history.filter(
        entry =>
          entry.result.success ===
          options.success
      );
  }

  if (
    typeof options.executionStatus ===
      "string" &&
    options.executionStatus.trim()
  ) {
    history =
      history.filter(
        entry =>
          entry.result.status ===
          options.executionStatus.trim()
      );
  }

  if (
    typeof options.historyId ===
      "string" &&
    options.historyId.trim()
  ) {
    history =
      history.filter(
        entry =>
          entry.historyId ===
          options.historyId.trim()
      );
  }

  return history.slice(
    0,
    options.limit ||
      MAX_RESULTS
  );
}

function getLearningHistory(
  historyId
) {
  const experience =
    experienceMemory.getExperience(
      historyId
    );

  if (!experience) {
    return null;
  }

  return normalizeHistoryEntry(
    experience
  );
}

function getLearningHistoryTimeline(
  historyId
) {
  const history =
    getLearningHistory(
      historyId
    );

  if (!history) {
    return null;
  }

  const timeline = [];

  function addEvent(
    type,
    timestamp,
    data,
    order
  ) {
    timeline.push({
      type,
      timestamp:
        cleanText(
          timestamp,
          100
        ),
      order,
      data:
        data || {}
    });
  }

  addEvent(
    "task",
    history.timestamps.createdAt,
    {
      taskId:
        history.task.id,
      title:
        history.task.title,
      description:
        history.task.description
    },
    1
  );

  addEvent(
    "approach",
    history.timestamps.startedAt ||
      history.timestamps.createdAt,
    {
      approach:
        history.approach
    },
    2
  );

  addEvent(
    "result",
    history.timestamps.completedAt ||
      history.result.completedAt,
    {
      success:
        history.result.success,
      status:
        history.result.status
    },
    3
  );

  if (
    history.feedback.provided ||
    history.feedback.comments ||
    history.feedback.requestedChanges.length > 0
  ) {
    addEvent(
      "feedback",
      history.performance.evaluatedAt ||
        history.timestamps.completedAt,
      {
        provided:
          history.feedback.provided,
        comments:
          history.feedback.comments,
        requestedChanges:
          history.feedback.requestedChanges
      },
      4
    );
  }

  if (
    history.performance.qaStatus ||
    history.performance.failedChecks.length > 0 ||
    history.performance.reworkRequired
  ) {
    addEvent(
      "performance",
      history.performance.evaluatedAt ||
        history.timestamps.completedAt,
      {
        qaStatus:
          history.performance.qaStatus,
        qaSuccess:
          history.performance.qaSuccess,
        failedChecks:
          history.performance.failedChecks,
        reworkRequired:
          history.performance.reworkRequired
      },
      5
    );
  }

  if (
    history.error.executionFailed ||
    history.error.recoveryRequired ||
    history.error.failedChecks.length > 0 ||
    history.error.reasons.length > 0
  ) {
    addEvent(
      "error",
      history.timestamps.completedAt,
      {
        executionFailed:
          history.error.executionFailed,
        executionStatus:
          history.error.executionStatus,
        recoveryRequired:
          history.error.recoveryRequired,
        recoveryReason:
          history.error.recoveryReason,
        failedChecks:
          history.error.failedChecks,
        reasons:
          history.error.reasons
      },
      6
    );
  }

  if (
    history.correction.reworkRequired ||
    history.correction.reworkContext ||
    history.correction.requestedChanges.length > 0
  ) {
    addEvent(
      "correction",
      history.timestamps.completedAt,
      {
        reworkRequired:
          history.correction.reworkRequired,
        reworkContext:
          history.correction.reworkContext,
        requestedChanges:
          history.correction.requestedChanges,
        status:
          history.correction.status
      },
      7
    );
  }

  if (
    history.lessons.length > 0
  ) {
    addEvent(
      "lesson",
      history.timestamps.completedAt ||
        history.timestamps.createdAt,
      {
        lessons:
          history.lessons
      },
      8
    );
  }

  timeline.sort(
    (a, b) => {
      const timeCompare =
        String(
          a.timestamp || ""
        ).localeCompare(
          String(
            b.timestamp || ""
          )
        );

      if (timeCompare !== 0) {
        return timeCompare;
      }

      return (
        a.order -
        b.order
      );
    }
  );

  return timeline.map(
    event => {
      const {
        order,
        ...cleanEvent
      } = event;

      return cleanEvent;
    }
  );
}

function getLearningHistoryDetail(
  historyId
) {
  const history =
    getLearningHistory(
      historyId
    );

  if (!history) {
    return null;
  }

  const strategies =
    futureStrategyEngine.getAllStrategies({
      limit:
        futureStrategyEngine.MAX_STRATEGIES
    });

  const relatedStrategies =
    (
      Array.isArray(strategies)
        ? strategies
        : []
    ).filter(
      strategy =>
        strategy.source?.learningId ===
        history.source.learningId
    );

  return {
    ...history,

    timeline:
      getLearningHistoryTimeline(
        historyId
      ),

    futureStrategy: {
      derived:
        true,
      readOnly:
        true,
      strategies:
        relatedStrategies
    },

    governance: {
      readOnly:
        true,
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

function getLearningHistoryStats() {
  const history =
    listLearningHistory({
      limit:
        experienceMemory.MAX_EXPERIENCES
    });

  const strategies =
    futureStrategyEngine.getAllStrategies({
      limit:
        futureStrategyEngine.MAX_STRATEGIES
    });

  return {
    engineVersion:
      ENGINE_VERSION,

    historyCount:
      history.length,

    sourceExperienceCount:
      experienceMemory.listExperiences({
        limit:
          experienceMemory.MAX_EXPERIENCES
      }).length,

    lessonEntryCount:
      history.reduce(
        (total, entry) =>
          total +
          entry.lessons.length,
        0
      ),

    strategyCount:
      Array.isArray(strategies)
        ? strategies.length
        : 0,

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

  normalizeHistoryEntry,
  getLearningHistory,
  listLearningHistory,
  getLearningHistoryTimeline,
  getLearningHistoryDetail,
  getLearningHistoryStats
};
