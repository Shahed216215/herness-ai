"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');

const {
  TASK_STATUSES,
  createTask
} = require("./task-schema");

const TASK_FILE = process.env.MIRA_TASK_FILE || storagePath("data/tasks.json");

function ensureStore() {
  const directory =
    path.dirname(TASK_FILE);

  fs.mkdirSync(
    directory,
    { recursive: true }
  );

  if (!fs.existsSync(TASK_FILE)) {
    fs.writeFileSync(
      TASK_FILE,
      JSON.stringify(
        {
          version: 1,
          updatedAt:
            new Date().toISOString(),
          tasks: []
        },
        null,
        2
      ) + "\n"
    );
  }
}

function loadStore() {
  ensureStore();

  const raw =
    fs.readFileSync(
      TASK_FILE,
      "utf8"
    );

  const parsed =
    JSON.parse(raw);

  if (
    !parsed ||
    !Array.isArray(parsed.tasks)
  ) {
    throw new Error(
      "Invalid task store."
    );
  }

  return parsed;
}

function saveStore(store) {
  store.updatedAt =
    new Date().toISOString();

  const temporaryFile =
    `${TASK_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(
      store,
      null,
      2
    ) + "\n"
  );

  fs.renameSync(
    temporaryFile,
    TASK_FILE
  );
}

function getTask(taskId) {
  const store =
    loadStore();

  return (
    store.tasks.find(
      task =>
        task.id === taskId
    ) || null
  );
}

function listTasks(options = {}) {
  const store =
    loadStore();

  let tasks =
    [...store.tasks];

  if (options.status) {
    tasks =
      tasks.filter(
        task =>
          task.status ===
          options.status
      );
  }

  if (options.type) {
    tasks =
      tasks.filter(
        task =>
          task.type ===
          options.type
      );
  }

  if (options.risk) {
    tasks =
      tasks.filter(
        task =>
          task.risk ===
          options.risk
      );
  }

  return tasks;
}

function createStoredTask(input = {}) {
  const task =
    createTask(input);

  const store =
    loadStore();

  const duplicate =
    store.tasks.some(
      existing =>
        existing.id === task.id
    );

  if (duplicate) {
    return {
      ok: false,
      status: "duplicate",
      task: null
    };
  }

  store.tasks.push(task);

  saveStore(store);

  return {
    ok: true,
    status: "created",
    task
  };
}

function updateTask(
  taskId,
  updates = {}
) {
  const store =
    loadStore();

  const index =
    store.tasks.findIndex(
      task =>
        task.id === taskId
    );

  if (index === -1) {
    return {
      ok: false,
      status: "not_found",
      task: null
    };
  }

  const current =
    store.tasks[index];

  const merged =
    {
      ...current,
      ...updates,
      id: current.id,
      createdAt:
        current.createdAt
    };

  const updated =
    createTask(merged);

  updated.updatedAt =
    new Date().toISOString();

  store.tasks[index] =
    updated;

  saveStore(store);

  return {
    ok: true,
    status: "updated",
    task: updated
  };
}

function updateTaskStatus(
  taskId,
  status
) {
  if (
    !TASK_STATUSES.includes(
      status
    )
  ) {
    throw new Error(
      "Invalid task status."
    );
  }

  return updateTask(
    taskId,
    { status }
  );
}

function deleteTask(taskId) {
  const store =
    loadStore();

  const index =
    store.tasks.findIndex(
      task =>
        task.id === taskId
    );

  if (index === -1) {
    return {
      ok: false,
      status: "not_found"
    };
  }

  store.tasks.splice(
    index,
    1
  );

  saveStore(store);

  return {
    ok: true,
    status: "deleted",
    taskId
  };
}

function getTaskSummary() {
  const tasks =
    loadStore().tasks;

  const summary = {
    total: tasks.length,
    new: 0,
    active: 0,
    waiting: 0,
    completed: 0,
    cancelled: 0
  };

  tasks.forEach(
    task => {
      if (
        Object.prototype.hasOwnProperty.call(
          summary,
          task.status
        )
      ) {
        summary[task.status]++;
      }
    }
  );

  return summary;
}

module.exports = {
  TASK_FILE,
  ensureStore,
  getTask,
  listTasks,
  createStoredTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  getTaskSummary
};
