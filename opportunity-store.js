"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');

const {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_RISKS,
  OPPORTUNITY_SOURCES,
  MATCH_STATUSES,
  createOpportunity
} = require("./opportunity-schema");

const OPPORTUNITY_FILE = process.env.MIRA_OPPORTUNITY_FILE || storagePath("data/opportunities.json");

function ensureStore() {
  const dataDir = path.dirname(OPPORTUNITY_FILE);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(OPPORTUNITY_FILE)) {
    const initialStore = {
      version: 1,
      updatedAt: new Date().toISOString(),
      opportunities: []
    };

    fs.writeFileSync(
      OPPORTUNITY_FILE,
      JSON.stringify(initialStore, null, 2),
      "utf8"
    );
  }
}

function loadStore() {
  ensureStore();

  const raw = fs.readFileSync(
    OPPORTUNITY_FILE,
    "utf8"
  );

  const store = JSON.parse(raw);

  if (
    !store ||
    typeof store !== "object" ||
    !Array.isArray(store.opportunities)
  ) {
    throw new Error(
      "Invalid opportunity store format"
    );
  }

  return store;
}

function saveStore(store) {
  ensureStore();

  store.updatedAt = new Date().toISOString();

  const tempFile =
    `${OPPORTUNITY_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(store, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    OPPORTUNITY_FILE
  );
}

function getOpportunity(opportunityId) {
  const store = loadStore();

  return (
    store.opportunities.find(
      opportunity =>
        opportunity.opportunityId ===
        opportunityId
    ) || null
  );
}

function findDuplicateOpportunity(input = {}) {
  const store = loadStore();

  if (
    input.source &&
    input.sourceId
  ) {
    const bySourceId =
      store.opportunities.find(
        opportunity =>
          opportunity.source === input.source &&
          opportunity.sourceId === input.sourceId
      );

    if (bySourceId) {
      return bySourceId;
    }
  }

  if (input.sourceUrl) {
    const bySourceUrl =
      store.opportunities.find(
        opportunity =>
          opportunity.sourceUrl &&
          opportunity.sourceUrl === input.sourceUrl
      );

    if (bySourceUrl) {
      return bySourceUrl;
    }
  }

  return null;
}

function createStoredOpportunity(input = {}) {
  const opportunity =
    createOpportunity(input);

  const store = loadStore();

  if (
    store.opportunities.some(
      item =>
        item.opportunityId ===
        opportunity.opportunityId
    )
  ) {
    throw new Error(
      `Opportunity already exists: ${opportunity.opportunityId}`
    );
  }

  const duplicate =
    findDuplicateOpportunity(opportunity);

  if (duplicate) {
    const error = new Error(
      "Duplicate opportunity detected"
    );

    error.code = "DUPLICATE_OPPORTUNITY";
    error.existingOpportunity =
      duplicate;

    throw error;
  }

  store.opportunities.push(
    opportunity
  );

  saveStore(store);

  return opportunity;
}

function listOpportunities(options = {}) {
  const store = loadStore();

  let results = [
    ...store.opportunities
  ];

  if (options.status) {
    results = results.filter(
      opportunity =>
        opportunity.status ===
        options.status
    );
  }

  if (options.type) {
    results = results.filter(
      opportunity =>
        opportunity.type ===
        options.type
    );
  }

  if (options.risk) {
    results = results.filter(
      opportunity =>
        opportunity.risk &&
        opportunity.risk.level ===
        options.risk
    );
  }

  if (options.source) {
    results = results.filter(
      opportunity =>
        opportunity.source ===
        options.source
    );
  }

  if (options.domain) {
    results = results.filter(
      opportunity =>
        opportunity.domain ===
        options.domain
    );
  }

  if (options.matchStatus) {
    results = results.filter(
      opportunity =>
        opportunity.capabilityMatch &&
        opportunity.capabilityMatch.status ===
        options.matchStatus
    );
  }

  return results;
}

function updateOpportunity(
  opportunityId,
  updates = {}
) {
  const store = loadStore();

  const index =
    store.opportunities.findIndex(
      opportunity =>
        opportunity.opportunityId ===
        opportunityId
    );

  if (index === -1) {
    throw new Error(
      `Opportunity not found: ${opportunityId}`
    );
  }

  const current =
    store.opportunities[index];

  const merged = {
    ...current,
    ...updates,

    opportunityId:
      current.opportunityId,

    createdAt:
      current.createdAt,

    updatedAt:
      new Date().toISOString()
  };

  const validated =
    createOpportunity(merged);

  store.opportunities[index] =
    validated;

  saveStore(store);

  return validated;
}

function countOpportunities() {
  return loadStore()
    .opportunities.length;
}

function getStorePath() {
  return OPPORTUNITY_FILE;
}

module.exports = {
  OPPORTUNITY_FILE,

  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_RISKS,
  OPPORTUNITY_SOURCES,
  MATCH_STATUSES,

  ensureStore,
  loadStore,
  saveStore,

  getOpportunity,
  findDuplicateOpportunity,
  createStoredOpportunity,
  listOpportunities,
  updateOpportunity,
  countOpportunities,
  getStorePath
};
