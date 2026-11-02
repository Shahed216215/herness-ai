"use strict";

const {
  createStoredOpportunity
} = require("../opportunity-store");

const TYPE_KEYWORDS = Object.freeze({
  job: [
    "job",
    "position",
    "employee",
    "employment",
    "hiring"
  ],
  freelance: [
    "freelance",
    "freelancer"
  ],
  project: [
    "project",
    "project-based"
  ],
  task: [
    "task",
    "assignment",
    "research task"
  ],
  gig: [
    "gig",
    "gig work"
  ]
});

const DOMAIN_KEYWORDS = Object.freeze({
  Research: [
    "research",
    "evidence",
    "literature",
    "analysis"
  ],
  Writing: [
    "writing",
    "writer",
    "editing",
    "content",
    "article"
  ],
  Coding: [
    "coding",
    "developer",
    "programming",
    "javascript",
    "python",
    "software"
  ],
  Data: [
    "data",
    "dataset",
    "data analysis",
    "data cleaning"
  ],
  Excel: [
    "excel",
    "spreadsheet",
    "formula",
    "pivot table"
  ],
  Automation: [
    "automation",
    "automate",
    "workflow"
  ],
  Web: [
    "web",
    "website",
    "web research"
  ],
  Documents: [
    "document",
    "documentation",
    "formatting"
  ]
});

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeOpportunityInput(input = {}) {
  const title =
    normalizeText(input.title);

  const description =
    normalizeText(input.description);

  const requirements =
    Array.isArray(input.requirements)
      ? input.requirements
          .map(normalizeText)
          .filter(Boolean)
      : [];

  const skills =
    Array.isArray(input.skills)
      ? input.skills
          .map(normalizeText)
          .filter(Boolean)
      : [];

  return {
    ...input,
    title,
    description,
    requirements,
    skills
  };
}

function containsKeyword(text, keyword) {
  return text.includes(
    keyword.toLowerCase()
  );
}

function classifyType(input) {
  if (input.type && input.type !== "other") {
    return input.type;
  }

  const text = [
    input.title,
    input.description,
    ...(input.requirements || [])
  ]
    .join(" ")
    .toLowerCase();

  for (const [type, keywords] of Object.entries(
    TYPE_KEYWORDS
  )) {
    if (
      keywords.some(
        keyword =>
          containsKeyword(
            text,
            keyword
          )
      )
    ) {
      return type;
    }
  }

  return "other";
}

function classifyDomain(input) {
  if (
    input.domain &&
    input.domain !== "unknown"
  ) {
    return input.domain;
  }

  const text = [
    input.title,
    input.description,
    ...(input.requirements || []),
    ...(input.skills || [])
  ]
    .join(" ")
    .toLowerCase();

  for (const [domain, keywords] of Object.entries(
    DOMAIN_KEYWORDS
  )) {
    if (
      keywords.some(
        keyword =>
          containsKeyword(
            text,
            keyword
          )
      )
    ) {
      return domain;
    }
  }

  return "unknown";
}

function discoverOpportunity(input = {}) {
  const normalized =
    normalizeOpportunityInput(input);

  const classified = {
    ...normalized,

    type: classifyType(normalized),

    domain: classifyDomain(normalized),

    status: "classified",

    provenance: {
      ...(normalized.provenance || {}),
      discoveredAt:
        normalized.provenance?.discoveredAt ||
        new Date().toISOString(),
      normalizedAt:
        new Date().toISOString(),
      classifiedAt:
        new Date().toISOString()
    }
  };

  return createStoredOpportunity(
    classified
  );
}

module.exports = {
  TYPE_KEYWORDS,
  DOMAIN_KEYWORDS,

  normalizeText,
  normalizeOpportunityInput,
  classifyType,
  classifyDomain,
  discoverOpportunity
};
