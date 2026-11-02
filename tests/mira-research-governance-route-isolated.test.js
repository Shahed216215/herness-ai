"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const routePath = require.resolve("../routes/mira-research-governance");
const taskStorePath = require.resolve("../task-store");
const auditPath = require.resolve("../audit-log");
const governancePath = require.resolve("../services/mira-research-governance");

const handlers = {};
const mockTask = {
  id: "route-urgent-test",
  title: "Offline route test",
  type: "research",
  status: "new",
  risk: "low"
};
let auditMode = "success";
let auditCalls = 0;

const fakeTaskStore = {
  getTask(id) {
    return id === mockTask.id ? { ...mockTask } : null;
  },
  listTasks() {
    return [{ ...mockTask }];
  }
};

const fakeAudit = {
  recordAudit() {
    auditCalls += 1;
    if (auditMode === "fail") throw new Error("simulated audit failure");
  }
};

const fakeGovernance = {
  getGovernanceSnapshot() {
    return {
      approvals: [],
      day: "2026-10-25",
      normalLimit: 3,
      normalCount: 0,
      urgentCount: 0
    };
  },
  validateResearchTask(task) {
    if (!task) throw new Error("Task not found; urgent approval refused.");
    if (task.status !== "new" || task.risk !== "low") {
      throw new Error("Task must be new and low-risk for urgent approval.");
    }
    if (!["research", "web_research"].includes(task.type)) {
      throw new Error("Only research tasks may receive urgent approval.");
    }
  },
  approveUrgentTask(input, options) {
    options.audit({
      action: "URGENT_RESEARCH_APPROVAL",
      resourceId: input.taskId
    });
    return {
      ok: true,
      taskId: input.taskId,
      status: "approved"
    };
  }
};

function installMock(id, exports) {
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    exports
  };
}

installMock(taskStorePath, fakeTaskStore);
installMock(auditPath, fakeAudit);
installMock(governancePath, fakeGovernance);

const fakeExpress = {
  Router() {
    return {
      get(route, handler) {
        handlers["GET " + route] = handler;
      },
      post(route, handler) {
        handlers["POST " + route] = handler;
      }
    };
  }
};

const expressPath = require.resolve("express");
const realExpressCache = require.cache[expressPath];
installMock(expressPath, fakeExpress);

try {
  delete require.cache[routePath];
  const register = require(routePath);
  const mounted = [];

  register({
    use(...args) { mounted.push(args); }
  }, permission => (_req, _res, next) => next(), {
    SYSTEM_ADMIN: "SYSTEM_ADMIN"
  });

  assert.equal(mounted.length, 1);
  assert.equal(mounted[0][0], "/api/admin/research-governance");
  assert.equal(typeof mounted[0][1], "function");
  console.log("ADMIN_ROUTE_MOUNT=PASS");

  function response() {
    return {
      code: 200,
      body: null,
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
  }

  const post = handlers["POST /tasks/:taskId/approve-urgent"];
  assert.equal(typeof post, "function");

  const denied = response();
  post({
    session: null,
    role: "admin",
    params: { taskId: mockTask.id },
    body: { reason: "Urgent deadline requires review" }
  }, denied);

  assert.equal(denied.code, 503);
  assert.equal(denied.body.success, false);
  assert.match(denied.body.error, /no authorization granted/i);
  console.log("MISSING_SESSION_DENIED=PASS");

  auditMode = "fail";
  const failedAudit = response();
  post({
    session: {
      authenticated: true,
      role: "admin",
      username: "offline-admin"
    },
    role: "admin",
    params: { taskId: mockTask.id },
    body: { reason: "Urgent deadline requires review" }
  }, failedAudit);

  assert.equal(failedAudit.code, 503);
  assert.equal(failedAudit.body.success, false);
  assert.match(failedAudit.body.error, /no authorization granted/i);
  assert.equal(auditCalls, 1);
  console.log("AUDIT_FAILURE_RETURNS_SAFE_ERROR=PASS");

  auditMode = "success";
  const approved = response();
  post({
    session: {
      authenticated: true,
      role: "admin",
      username: "offline-admin"
    },
    role: "admin",
    params: { taskId: mockTask.id },
    body: { reason: "Urgent deadline requires review" }
  }, approved);

  assert.equal(approved.code, 200);
  assert.equal(approved.body.success, true);
  assert.equal(approved.body.status, "approved");
  assert.equal(approved.body.taskId, mockTask.id);
  console.log("VALID_SESSION_APPROVAL_RESPONSE=PASS");

  const get = handlers["GET /tasks"];
  const listed = response();
  get({}, listed);

  assert.equal(listed.code, 200);
  assert.equal(listed.body.success, true);
  assert.equal(listed.body.tasks.length, 1);
  assert.equal(listed.body.tasks[0].urgentApprovalStatus, "none");
  console.log("TASK_LIST_RESPONSE=PASS");

  console.log("HTTP_SERVER_STARTED=NO");
  console.log("NETWORK_TEST=NOT_RUN");
  console.log("LIVE_API_TEST=NOT_RUN");
} finally {
  delete require.cache[routePath];
  delete require.cache[taskStorePath];
  delete require.cache[auditPath];
  delete require.cache[governancePath];

  if (realExpressCache) require.cache[expressPath] = realExpressCache;
  else delete require.cache[expressPath];
}
