"use strict";

const TASK_TYPES = Object.freeze([
  "excel_data",
  "research",
  "writing",
  "coding",
  "automation",
  "web_research",
  "documents",
  "authorized_cybersecurity"
]);

const TASK_STATUSES = Object.freeze([
  "new",
  "active",
  "waiting",
  "completed",
  "cancelled"
]);

const TASK_DIFFICULTIES = Object.freeze([
  "unknown",
  "easy",
  "medium",
  "hard",
  "expert"
]);

const TASK_RISKS = Object.freeze([
  "low",
  "medium",
  "high",
  "critical"
]);

const FUTURE_TASK_TYPES = Object.freeze([
  "ui"
]);

function now() {
  return new Date().toISOString();
}

function createTaskId() {
  return `task-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 14)}`;
}

function cleanText(value, field, max = 2000) {
  if (value === undefined || value === null) {
    return "";
  }

  const text = String(value).trim();

  if (text.length > max) {
    throw new Error(
      `${field} exceeds maximum length.`
    );
  }

  return text;
}

function cleanList(
  value,
  field,
  maxItems = 100
) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(
      `${field} must be an array.`
    );
  }

  if (value.length > maxItems) {
    throw new Error(
      `${field} exceeds maximum item count.`
    );
  }

  return value.map(
    item =>
      cleanText(
        item,
        field,
        500
      )
  );
}

function normalizeEnum(
  value,
  allowed,
  field,
  fallback
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (!allowed.includes(normalized)) {
    throw new Error(
      `Invalid ${field}.`
    );
  }

  return normalized;
}

function createTask(input = {}) {
  const title =
    cleanText(
      input.title,
      "title",
      300
    );

  const description =
    cleanText(
      input.description,
      "description",
      5000
    );

  if (!title) {
    throw new Error(
      "title is required."
    );
  }

  const createdAt = now();

  return {
    id:
      input.id ||
      createTaskId(),

    title,

    description,

    type:
      normalizeEnum(
        input.type,
        TASK_TYPES,
        "task type",
        "research"
      ),

    requirements:
      cleanList(
        input.requirements,
        "requirements"
      ),

    deliverables:
      cleanList(
        input.deliverables,
        "deliverables"
      ),

    deadline:
      cleanText(
        input.deadline,
        "deadline",
        100
      ),

    difficulty:
      normalizeEnum(
        input.difficulty,
        TASK_DIFFICULTIES,
        "difficulty",
        "unknown"
      ),

    requiredSkills:
      cleanList(
        input.requiredSkills,
        "requiredSkills"
      ),

    risk:
      normalizeEnum(
        input.risk,
        TASK_RISKS,
        "risk",
        "low"
      ),

    status:
      normalizeEnum(
        input.status,
        TASK_STATUSES,
        "status",
        "new"
      ),

    source:
      cleanText(
        input.source,
        "source",
        500
      ),

    createdAt:
      input.createdAt ||
      createdAt,

    updatedAt:
      createdAt
  };
}

module.exports = {
  TASK_TYPES,
  TASK_STATUSES,
  TASK_DIFFICULTIES,
  TASK_RISKS,
  FUTURE_TASK_TYPES,
  createTask
};
