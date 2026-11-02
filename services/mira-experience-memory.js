"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const learningEngine = require("./mira-work-learning-engine");

const ENGINE_VERSION = "6.4.1";
const SOURCE_ENGINE_VERSION =
  learningEngine.ENGINE_VERSION;

const MAX_EXPERIENCES = 5000;

function cleanText(value, maxLength = 2000) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .trim()
    .slice(0, maxLength);
}

function cleanList(
  value,
  maxItems = 50,
  maxLength = 2000
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item =>
      cleanText(item, maxLength)
    )
    .filter(Boolean)
    .slice(0, maxItems);
}

function stableStringify(value) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(item =>
        stableStringify(item)
      )
      .join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${stableStringify(
          value[key]
        )}`
    )
    .join(",")}}`;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function normalizeApproach(record) {
  const execution =
    record.execution || {};

  return {
    planId:
      cleanText(
        execution.planId,
        200
      ),
    executionStage:
      cleanText(
        execution.stage,
        100
      ),
    executionStatus:
      cleanText(
        execution.status,
        150
      ),
    autonomousApproval:
      execution.autonomousApproval === true,
    executionStarted:
      execution.executionStarted === true
  };
}

function normalizeResult(record) {
  const execution =
    record.execution || {};

  return {
    success:
      execution.success === true,
    status:
      cleanText(
        execution.status,
        150
      ),
    resultCount:
      Number.isInteger(
        execution.resultCount
      )
        ? execution.resultCount
        : Array.isArray(
            execution.results
          )
        ? execution.results.length
        : 0,
    results:
      Array.isArray(
        execution.results
      )
        ? execution.results
            .slice(0, 100)
            .map(item => item)
        : [],
    completedAt:
      cleanText(
        execution.completedAt,
        100
      )
  };
}

function normalizeFeedback(record) {
  const feedback =
    record.feedback || {};

  return {
    provided:
      feedback.provided === true,
    summary:
      cleanText(
        feedback.summary
      ),
    positive:
      cleanList(
        feedback.positive
      ),
    negative:
      cleanList(
        feedback.negative
      ),
    requestedChanges:
      cleanList(
        feedback.requestedChanges
      )
  };
}

function normalizePerformance(record) {
  const qa =
    record.qa || {};

  const failedChecks =
    Array.isArray(qa.failedChecks)
      ? qa.failedChecks
      : [];

  return {
    qaStatus:
      cleanText(
        qa.status,
        100
      ),
    qaSuccess:
      qa.success === true,
    failedChecks:
      cleanList(
        failedChecks
      ),
    reworkRequired:
      qa.reworkRequired === true,
    evaluatedAt:
      cleanText(
        qa.evaluatedAt,
        100
      )
  };
}

function normalizeError(record) {
  const execution =
    record.execution || {};

  const qa =
    record.qa || {};

  return {
    executionFailed:
      execution.success === false,
    executionStatus:
      cleanText(
        execution.status,
        150
      ),
    recoveryRequired:
      execution.recoveryRequired === true ||
      qa.recoveryRequired === true,
    recoveryReason:
      cleanText(
        execution.recoveryReason
      ),
    failedChecks:
      cleanList(
        qa.failedChecks
      ),
    reasons:
      cleanList(
        qa.reasons
      ),
    whatFailed:
      cleanList(
        record.whatFailed
      )
  };
}

function normalizeCorrection(record) {
  const qa =
    record.qa || {};

  return {
    reworkRequired:
      qa.reworkRequired === true,
    reworkContext:
      qa.reworkContext || null,
    requestedChanges:
      cleanList(
        record.feedback?.requestedChanges
      ),
    status:
      qa.reworkRequired === true
        ? "rework_required"
        : null
  };
}

function normalizeLesson(record) {
  return cleanList(
    record.lessons
  );
}

function normalizeFutureStrategy() {
  return null;
}

function normalizeLessonEntry(
  lesson,
  record
) {
  return {
    lesson: cleanText(
      lesson,
      2000
    ),
    learningId:
      cleanText(
        record.learningId,
        200
      ),
    taskId:
      cleanText(
        record.taskId,
        200
      ),
    executionId:
      cleanText(
        record.executionId,
        200
      ),
    createdAt:
      cleanText(
        record.createdAt,
        100
      )
  };
}

function getLessons(
  learningId
) {
  const record =
    learningEngine.getLearningRecord(
      learningId
    );

  if (!record) {
    return [];
  }

  return cleanList(
    record.lessons
  ).map(
    lesson =>
      normalizeLessonEntry(
        lesson,
        record
      )
  );
}

function listLessons(
  options = {}
) {
  const records =
    learningEngine.listLearningRecords(
      {
        taskId:
          options.taskId,
        status:
          options.status,
        qaStatus:
          options.qaStatus,
        limit:
          options.limit ||
          MAX_EXPERIENCES
      }
    );

  const lessons = [];

  for (
    const record of records
  ) {
    for (
      const lesson of
        cleanList(record.lessons)
    ) {
      lessons.push(
        normalizeLessonEntry(
          lesson,
          record
        )
      );
    }
  }

  return lessons;
}

function calculateExperienceHash(
  experience
) {
  const payload = {
    ...experience,
    integrity: null
  };

  return sha256(
    stableStringify(payload)
  );
}

function normalizeExperience(
  record
) {
  if (
    !record ||
    typeof record !== "object"
  ) {
    throw new Error(
      "Learning record is required."
    );
  }

  if (!record.learningId) {
    throw new Error(
      "Learning record learningId is required."
    );
  }

  const task =
    record.task || {};

  const execution =
    record.execution || {};

  const experience = {
    schemaVersion: 1,
    engineVersion:
      ENGINE_VERSION,

    experienceId:
      cleanText(
        record.learningId,
        200
      ),

    source: {
      type:
        "work-learning-record",
      learningId:
        cleanText(
          record.learningId,
          200
        ),
      taskId:
        cleanText(
          record.taskId ||
            task.id,
          200
        ),
      executionId:
        cleanText(
          record.executionId ||
            execution.executionId,
          200
        ),
      planId:
        cleanText(
          execution.planId,
          200
        ),
      learningEngineVersion:
        cleanText(
          record.engineVersion ||
            SOURCE_ENGINE_VERSION,
          100
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
      requirements:
        cleanList(
          task.requirements
        ),
      deliverables:
        cleanList(
          task.deliverables
        ),
      requiredSkills:
        cleanList(
          task.requiredSkills
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
      normalizeApproach(
        record
      ),

    result:
      normalizeResult(
        record
      ),

    feedback:
      normalizeFeedback(
        record
      ),

    performance:
      normalizePerformance(
        record
      ),

    error:
      normalizeError(
        record
      ),

    correction:
      normalizeCorrection(
        record
      ),

    lesson:
      normalizeLesson(
        record
      ),

    futureStrategy:
      normalizeFutureStrategy(),

    quality: {
      qaStatus:
        cleanText(
          record.qa?.status,
          100
        ),
      qaSuccess:
        record.qa?.success === true,
      finalAcceptance:
        record.qa?.finalAcceptance === true,
      reworkRequired:
        record.qa?.reworkRequired === true
    },

    timestamps: {
      createdAt:
        cleanText(
          record.createdAt,
          100
        ),
      startedAt:
        cleanText(
          execution.startedAt,
          100
        ),
      completedAt:
        cleanText(
          execution.completedAt,
          100
        )
    },

    integrity: null
  };

  experience.integrity =
    calculateExperienceHash(
      experience
    );

  return experience;
}

function verifyExperienceIntegrity(
  experience
) {
  if (
    !experience ||
    typeof experience !== "object"
  ) {
    return false;
  }

  if (
    !experience.integrity
  ) {
    return false;
  }

  const expected =
    calculateExperienceHash(
      experience
    );

  return (
    expected ===
    experience.integrity
  );
}

function getExperience(
  learningId
) {
  if (!learningId) {
    return null;
  }

  const record =
    learningEngine.getLearningRecord(
      learningId
    );

  if (!record) {
    return null;
  }

  return normalizeExperience(
    record
  );
}

function listExperiences(
  options = {}
) {
  const records =
    learningEngine.listLearningRecords(
      {
        taskId:
          options.taskId,
        status:
          options.status,
        qaStatus:
          options.qaStatus,
        limit:
          options.limit ||
          MAX_EXPERIENCES
      }
    );

  return records.map(
    normalizeExperience
  );
}

function getExperienceStats() {
  const experiences =
    listExperiences({
      limit:
        MAX_EXPERIENCES
    });

  return {
    total:
      experiences.length,

    successful:
      experiences.filter(
        item =>
          item.result.success
      ).length,

    failed:
      experiences.filter(
        item =>
          !item.result.success
      ).length,

    feedbackProvided:
      experiences.filter(
        item =>
          item.feedback.provided
      ).length,

    errors:
      experiences.filter(
        item =>
          item.error.executionFailed ||
          item.error.failedChecks.length > 0 ||
          item.error.reasons.length > 0
      ).length,

    corrections:
      experiences.filter(
        item =>
          item.correction.reworkRequired ||
          item.correction.requestedChanges.length > 0
      ).length,

    lessons:
      experiences.filter(
        item =>
          item.lesson.length > 0
      ).length,

    futureStrategies:
      experiences.filter(
        item =>
          item.futureStrategy !== null
      ).length
  };
}

module.exports = {
  ENGINE_VERSION,
  SOURCE_ENGINE_VERSION,
  MAX_EXPERIENCES,

  stableStringify,
  sha256,

  normalizeExperience,
  calculateExperienceHash,
  verifyExperienceIntegrity,

  getExperience,
  listExperiences,
  getLessons,
  listLessons,
  getExperienceStats
};
