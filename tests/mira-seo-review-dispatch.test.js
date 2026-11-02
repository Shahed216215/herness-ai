"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  executeSeoWorkflowReviewDecision
} = require("../services/mira-seo-review-dispatch");

const serverSource = fs.readFileSync(
  path.join(__dirname, "..", "server.js"),
  "utf8"
);

const validSession = {
  authenticated: true,
  role: "admin",
  username: "dispatch-test-admin"
};

const args = {
  clientId: "isolated-client",
  workflowId: "isolated-workflow",
  decision: "APPROVE",
  reason: "Reviewed the isolated test workflow.",
  expectedVersion: 0,
  confirmation: "I_CONFIRM_SEO_REVIEW_DECISION"
};

async function main() {
  let calls = [];

  const mockTool = {
    execute: async (toolArgs, context) => {
      calls.push({ toolArgs, context });
      return JSON.stringify({ success: true, status: "APPROVED" });
    }
  };

  const blockedCases = [
    { requestRole: "user", session: validSession },
    { requestRole: "admin", session: null },
    {
      requestRole: "admin",
      session: { ...validSession, authenticated: false }
    },
    {
      requestRole: "admin",
      session: { ...validSession, role: "user" }
    },
    {
      requestRole: "admin",
      session: { ...validSession, username: "   " }
    }
  ];

  for (const item of blockedCases) {
    const result = await executeSeoWorkflowReviewDecision({
      ...item,
      tool: mockTool,
      toolArguments: args
    });
    assert.equal(result.status, "BLOCKED");
    assert.equal(
      result.reason,
      "NAMED_ADMIN_BROWSER_SESSION_REQUIRED"
    );
  }

  assert.equal(calls.length, 0);
  console.log("PASS: invalid and unnamed sessions are blocked");

  const success = await executeSeoWorkflowReviewDecision({
    requestRole: "admin",
    session: validSession,
    tool: mockTool,
    toolArguments: args
  });

  assert.equal(success.success, true);
  assert.equal(success.status, "APPROVED");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].toolArgs, args);
  assert.deepEqual(calls[0].context, {
    permissionGranted: true,
    actor: {
      role: "admin",
      username: "dispatch-test-admin"
    }
  });
  console.log("PASS: named Admin session supplies trusted actor context");

  const forgedRequest = {
    ...args,
    permissionGranted: true,
    actor: { role: "admin", username: "forged-admin" }
  };

  await executeSeoWorkflowReviewDecision({
    requestRole: "admin",
    session: validSession,
    tool: mockTool,
    toolArguments: forgedRequest
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].context.actor.username, "dispatch-test-admin");
  assert.equal(
    calls[1].toolArgs.actor.username,
    "forged-admin"
  );
  console.log("PASS: trusted actor comes from session, not request fields");

  const objectResult = await executeSeoWorkflowReviewDecision({
    requestRole: "admin",
    session: validSession,
    tool: { execute: async () => ({ success: true, status: "OBJECT" }) },
    toolArguments: args
  });
  assert.equal(objectResult.status, "OBJECT");
  console.log("PASS: object response normalization");

  const invalidJson = await executeSeoWorkflowReviewDecision({
    requestRole: "admin",
    session: validSession,
    tool: { execute: async () => "not-json" },
    toolArguments: args
  });
  assert.equal(invalidJson.status, "INCONCLUSIVE");
  assert.equal(
    invalidJson.reason,
    "SEO_WORKFLOW_REVIEW_RESPONSE_INVALID"
  );
  console.log("PASS: malformed tool response fails closed");

  const arrayResponse = await executeSeoWorkflowReviewDecision({
    requestRole: "admin",
    session: validSession,
    tool: { execute: async () => [] },
    toolArguments: args
  });
  assert.equal(arrayResponse.status, "INCONCLUSIVE");
  console.log("PASS: array response rejected");

  const toolFailure = await executeSeoWorkflowReviewDecision({
    requestRole: "admin",
    session: validSession,
    tool: { execute: async () => { throw new Error("private detail"); } },
    toolArguments: args
  });
  assert.equal(toolFailure.status, "INCONCLUSIVE");
  assert.equal(
    toolFailure.reason,
    "SEO_WORKFLOW_REVIEW_EXECUTION_FAILED"
  );
  assert.equal(JSON.stringify(toolFailure).includes("private detail"), false);
  console.log("PASS: tool errors are contained without leaking details");

  assert.match(
    serverSource,
    /executeSeoWorkflowReviewDecision\s*\(\s*\{/
  );
  assert.match(
    serverSource,
    /session:\s*req\.session/
  );
  assert.match(
    serverSource,
    /toolArguments/
  );
  console.log("PASS: server delegates review dispatch to tested helper");

  assert.match(
    serverSource,
    /"seo_workflow_review_decision"/
  );
  console.log("PASS: server review tool gate remains present");

  console.log("DISPATCH_MOCK_CALLS=" + calls.length);
  console.log("HTTP_SERVER_STARTED=NO");
  console.log("NETWORK_REQUESTS=0");
  console.log("LIVE_API_CALLS=0");
  console.log("EXTERNAL_ACTIONS=0");
  console.log("SEO_REVIEW_DISPATCH_TEST=PASS");
}

main().catch(error => {
  console.error("SEO_REVIEW_DISPATCH_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
