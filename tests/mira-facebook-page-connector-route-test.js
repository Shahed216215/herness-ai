"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");

const routes = {};
const router = {
  get(path, handler) { routes["GET " + path] = handler; },
  post(path, handler) { routes["POST " + path] = handler; }
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "express") return { Router: () => router };
  return originalLoad.call(this, request, parent, isMain);
};

let register;
try {
  register = require("../routes/mira-facebook-page-connector");
} finally {
  Module._load = originalLoad;
}

const calls = [];
const connector = {
  async detectCapabilities() {
    calls.push("capabilities");
    return { read: "VERIFIED", write: "NOT_VERIFIED" };
  },
  createManualPostDraft(input) {
    calls.push(["draft", input]);
    return { status: "PENDING_MANUAL_POST", published: false };
  },
  async publishPost(input) {
    calls.push(["publish", input]);
    return { status: "PENDING_READBACK", verified: false };
  },
  async importPostUrl(input) {
    calls.push(["import", input]);
    return { status: "VERIFIED", canonicalMemoryWrite: false };
  },
  async verifyPost(input) {
    calls.push(["verify", input]);
    return { status: "VERIFIED", canonicalMemoryWrite: false };
  }
};

let mounted;
const app = {
  use(...args) { mounted = args; }
};
const adminGuard = () => function adminOnly() {};
register(app, adminGuard, { SYSTEM_ADMIN: "SYSTEM_ADMIN" }, {
  createConnector: () => connector
});

assert.equal(mounted[0], "/api/admin/facebook-page");
assert.equal(typeof mounted[1], "function");
assert.equal(mounted[2], router);

async function invoke(method, path, body = {}) {
  const handler = routes[method + " " + path];
  assert.equal(typeof handler, "function", "route registered: " + method + " " + path);
  const result = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  await handler({ body }, result);
  return result;
}

(async () => {
  let response = await invoke("GET", "/capabilities");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.capabilities.write, "NOT_VERIFIED");

  response = await invoke("POST", "/draft", { message: "draft" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.draft.status, "PENDING_MANUAL_POST");

  response = await invoke("POST", "/publish", { message: "must not publish" });
  assert.equal(response.statusCode, 403);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "publish"), false);

  response = await invoke("POST", "/publish", {
    confirmPublish: "PUBLISH_TO_FACEBOOK_PAGE",
    message: "approved"
  });
  assert.equal(response.statusCode, 202);
  assert.equal(calls.find(call => Array.isArray(call) && call[0] === "publish")[1].approved, true);

  response = await invoke("POST", "/import-url", { url: "https://www.facebook.com/123/posts/456" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.result.canonicalMemoryWrite, false);

  response = await invoke("POST", "/verify", { postId: "123_456" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.result.status, "VERIFIED");

  console.log("MOCK_ONLY_FACEBOOK_ROUTE_TEST=PASS");
  console.log("LIVE_FACEBOOK_REQUESTS=0");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
