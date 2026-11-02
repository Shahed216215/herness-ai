"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');

const {
  ACCEPTANCE_STATUSES,
  createWorkAcceptance,
  validateWorkAcceptance
} = require("./work-acceptance-schema");

const WORK_ACCEPTANCE_FILE =
  storagePath("data/work-acceptances.json");

function ensureStore() {
  const dir = path.dirname(WORK_ACCEPTANCE_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(WORK_ACCEPTANCE_FILE)) {
    fs.writeFileSync(
      WORK_ACCEPTANCE_FILE,
      JSON.stringify(
        { workAcceptances: [] },
        null,
        2
      )
    );
  }
}

function loadStore() {
  ensureStore();

  const raw =
    fs.readFileSync(
      WORK_ACCEPTANCE_FILE,
      "utf8"
    );

  const store =
    raw.trim()
      ? JSON.parse(raw)
      : { workAcceptances: [] };

  if (
    !store ||
    !Array.isArray(store.workAcceptances)
  ) {
    throw new Error(
      "Invalid work acceptance store format"
    );
  }

  return store;
}

function saveStore(store) {
  if (
    !store ||
    !Array.isArray(store.workAcceptances)
  ) {
    throw new Error(
      "Invalid work acceptance store"
    );
  }

  ensureStore();

  const tempFile =
    `${WORK_ACCEPTANCE_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(store, null, 2)
  );

  fs.renameSync(
    tempFile,
    WORK_ACCEPTANCE_FILE
  );

  return store;
}

function getWorkAcceptance(
  acceptanceId
) {
  if (
    typeof acceptanceId !== "string" ||
    acceptanceId.trim() === ""
  ) {
    throw new Error(
      "acceptanceId must be a non-empty string"
    );
  }

  return loadStore()
    .workAcceptances
    .find(
      record =>
        record.acceptanceId ===
        acceptanceId
    ) || null;
}

function listWorkAcceptances(
  filters = {}
) {
  const records =
    loadStore().workAcceptances;

  return records.filter(record => {
    if (
      filters.opportunityId &&
      record.opportunityId !==
        filters.opportunityId
    ) {
      return false;
    }

    if (
      filters.proposalId &&
      record.proposalId !==
        filters.proposalId
    ) {
      return false;
    }

    if (
      filters.status &&
      record.status !==
        filters.status
    ) {
      return false;
    }

    return true;
  });
}

function findByOpportunity(
  opportunityId
) {
  return listWorkAcceptances({
    opportunityId
  });
}

function findByProposal(
  proposalId
) {
  return listWorkAcceptances({
    proposalId
  });
}

function createStoredWorkAcceptance(
  input
) {
  const validation =
    validateWorkAcceptance(input);

  if (!validation.valid) {
    throw new Error(
      `Invalid work acceptance: ${validation.errors.join("; ")}`
    );
  }

  const store = loadStore();

  if (
    store.workAcceptances.some(
      record =>
        record.acceptanceId ===
        input.acceptanceId
    )
  ) {
    const error = new Error(
      `Work acceptance already exists: ${input.acceptanceId}`
    );

    error.code =
      "DUPLICATE_WORK_ACCEPTANCE";

    error.existingAcceptance =
      input.acceptanceId;

    throw error;
  }

  const record =
    createWorkAcceptance(input);

  store.workAcceptances.push(record);

  saveStore(store);

  return record;
}

function updateWorkAcceptance(
  acceptanceId,
  updates
) {
  const store = loadStore();

  const index =
    store.workAcceptances.findIndex(
      record =>
        record.acceptanceId ===
        acceptanceId
    );

  if (index === -1) {
    throw new Error(
      `Work acceptance not found: ${acceptanceId}`
    );
  }

  const current =
    store.workAcceptances[index];

  const merged = {
    ...current,
    ...updates,

    acceptanceId:
      current.acceptanceId,

    createdAt:
      current.createdAt,

    updatedAt:
      new Date().toISOString()
  };

  const validation =
    validateWorkAcceptance(merged);

  if (!validation.valid) {
    throw new Error(
      `Invalid work acceptance update: ${validation.errors.join("; ")}`
    );
  }

  const validated =
    createWorkAcceptance(merged);

  store.workAcceptances[index] =
    validated;

  saveStore(store);

  return validated;
}

function deleteWorkAcceptance(
  acceptanceId
) {
  const store = loadStore();

  const index =
    store.workAcceptances.findIndex(
      record =>
        record.acceptanceId ===
        acceptanceId
    );

  if (index === -1) {
    throw new Error(
      `Work acceptance not found: ${acceptanceId}`
    );
  }

  const removed =
    store.workAcceptances.splice(
      index,
      1
    )[0];

  saveStore(store);

  return removed;
}

function countWorkAcceptances() {
  return loadStore()
    .workAcceptances.length;
}

function getStorePath() {
  return WORK_ACCEPTANCE_FILE;
}

module.exports = {
  WORK_ACCEPTANCE_FILE,

  ACCEPTANCE_STATUSES,

  ensureStore,
  loadStore,
  saveStore,

  getWorkAcceptance,
  listWorkAcceptances,

  findByOpportunity,
  findByProposal,

  createStoredWorkAcceptance,
  updateWorkAcceptance,
  deleteWorkAcceptance,

  countWorkAcceptances,
  getStorePath
};
