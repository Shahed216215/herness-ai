"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');

const {
  createProject,
  validateProject
} = require("./project-schema");

const {
  getWorkAcceptance
} = require("./work-acceptance-store");

const PROJECT_FILE = storagePath("data/projects.json");

function ensureStore() {
  if (!fs.existsSync(PROJECT_FILE)) {
    fs.mkdirSync(path.dirname(PROJECT_FILE), {
      recursive: true
    });

    fs.writeFileSync(
      PROJECT_FILE,
      JSON.stringify({ projects: [] }, null, 2) + "\n",
      "utf8"
    );
  }
}

function readStore() {
  ensureStore();

  const raw = fs.readFileSync(
    PROJECT_FILE,
    "utf8"
  );

  const parsed = JSON.parse(raw);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.projects)
  ) {
    throw new Error(
      "Invalid project store format"
    );
  }

  return parsed;
}

function writeStore(data) {
  const directory = path.dirname(PROJECT_FILE);
  const tempFile =
    PROJECT_FILE +
    `.tmp-${process.pid}-${Date.now()}`;

  fs.mkdirSync(directory, {
    recursive: true
  });

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );

  fs.renameSync(
    tempFile,
    PROJECT_FILE
  );
}

function getProject(projectId) {
  const store = readStore();

  return (
    store.projects.find(
      project =>
        project.projectId === projectId
    ) || null
  );
}

function listProjects(filters = {}) {
  const store = readStore();

  return store.projects.filter(project => {
    if (
      filters.status !== undefined &&
      project.status !== filters.status
    ) {
      return false;
    }

    if (
      filters.acceptanceId !== undefined &&
      project.acceptanceId !==
        filters.acceptanceId
    ) {
      return false;
    }

    if (
      filters.opportunityId !== undefined &&
      project.opportunityId !==
        filters.opportunityId
    ) {
      return false;
    }

    return true;
  });
}

function countProjects(filters = {}) {
  return listProjects(filters).length;
}

function createStoredProject(input = {}) {
  const project = createProject(input);

  const validation =
    validateProject(project);

  if (!validation.valid) {
    throw new Error(
      `Invalid project: ${validation.errors.join("; ")}`
    );
  }

  const existing =
    getProject(project.projectId);

  if (existing) {
    throw new Error(
      `Project already exists: ${project.projectId}`
    );
  }

  const acceptance =
    getWorkAcceptance(
      project.acceptanceId
    );

  if (!acceptance) {
    throw new Error(
      `Work acceptance not found: ${project.acceptanceId}`
    );
  }

  if (acceptance.status !== "accepted") {
    throw new Error(
      `Work acceptance is not accepted: ${project.acceptanceId}`
    );
  }

  if (
    !acceptance.acceptanceDecision ||
    acceptance.acceptanceDecision.decision !== "accept"
  ) {
    throw new Error(
      `Work acceptance decision is not accept: ${project.acceptanceId}`
    );
  }

  if (
    acceptance.opportunityId !==
    project.opportunityId
  ) {
    throw new Error(
      "Project opportunityId does not match work acceptance"
    );
  }

  if (!project.workScopeSnapshot) {
    throw new Error(
      "Project work scope snapshot is required"
    );
  }

  if (
    acceptance.workScope &&
    project.workScopeSnapshot.scopeId !==
      acceptance.workScope.scopeId
  ) {
    throw new Error(
      "Project scope does not match accepted work scope"
    );
  }

  const store = readStore();

  store.projects.push(project);

  writeStore(store);

  return project;
}

function updateProject(
  projectId,
  updates = {}
) {
  const store = readStore();

  const index =
    store.projects.findIndex(
      project =>
        project.projectId === projectId
    );

  if (index === -1) {
    throw new Error(
      `Project not found: ${projectId}`
    );
  }

  const current =
    store.projects[index];

  const next = {
    ...current,
    ...updates,
    projectId: current.projectId,
    acceptanceId: current.acceptanceId,
    opportunityId: current.opportunityId,
    updatedAt:
      new Date().toISOString()
  };

  const validation =
    validateProject(next);

  if (!validation.valid) {
    throw new Error(
      `Invalid project update: ${validation.errors.join("; ")}`
    );
  }

  store.projects[index] = next;

  writeStore(store);

  return next;
}

function updateProjectStatus(
  projectId,
  status
) {
  return updateProject(
    projectId,
    { status }
  );
}

function deleteProject(projectId) {
  const store = readStore();

  const index =
    store.projects.findIndex(
      project =>
        project.projectId === projectId
    );

  if (index === -1) {
    return false;
  }

  store.projects.splice(index, 1);

  writeStore(store);

  return true;
}

function getProjectStorePath() {
  return PROJECT_FILE;
}

module.exports = {
  PROJECT_FILE,
  ensureStore,
  getProject,
  listProjects,
  countProjects,
  createStoredProject,
  updateProject,
  updateProjectStatus,
  deleteProject,
  getProjectStorePath
};
