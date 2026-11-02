"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-seo-history-")
);

process.env.MIRA_STORAGE_DIR = temp;

const tool = require("../tools/seo-workflow-history");
const policy = require("../services/mira-work-execution-engine");
const store = require("../services/mira-seo-workflow-store");

async function main() {
  const trusted = {
    permissionGranted: true,
    actor: {
      role: "admin",
      username: "history-test-admin"
    }
  };

  try {
    const execute = tool.createHistoryExecutor({
      listWorkflowRecords: store.listWorkflowRecords
    });

    const denied = JSON.parse(await execute({
      clientId: "client-a"
    }));

    assert.equal(denied.status, "BLOCKED");
    console.log("PASS: missing trusted context rejected");

    const wrongRole = JSON.parse(await execute({
      clientId: "client-a"
    }, {
      permissionGranted: true,
      actor: { role: "user", username: "user-one" }
    }));

    assert.equal(wrongRole.status, "BLOCKED");
    console.log("PASS: non-admin context rejected");

    const missingName = JSON.parse(await execute({
      clientId: "client-a"
    }, {
      permissionGranted: true,
      actor: { role: "admin", username: " " }
    }));

    assert.equal(missingName.status, "BLOCKED");
    console.log("PASS: unnamed admin context rejected");

    const extraField = JSON.parse(await execute({
      clientId: "client-a",
      allClients: true
    }, trusted));

    assert.equal(extraField.reason, "SEO_WORKFLOW_HISTORY_FIELD_NOT_ALLOWED");
    console.log("PASS: cross-client query fields rejected");

    const invalidLimit = JSON.parse(await execute({
      clientId: "client-a",
      limit: 11
    }, trusted));

    assert.equal(invalidLimit.reason, "SEO_WORKFLOW_HISTORY_LIMIT_INVALID");
    console.log("PASS: retrieval limit enforced");

    store.appendWorkflowRecord({
      clientId: "client-a",
      brief: {
        clientName: "Client A",
        clientAuthorization: {
          status: "authorized",
          scopes: ["seo_audit"]
        }
      },
      query: "keyword research A",
      audit: { success: true },
      research: {
        success: true,
        keywords: ["alpha", "beta"]
      }
    });

    store.appendWorkflowRecord({
      clientId: "client-b",
      brief: { clientName: "Client B" },
      query: "private client B query",
      audit: { success: true },
      research: { success: true, privateData: "client-b-only" }
    });

    const result = JSON.parse(await execute({
      clientId: "client-a"
    }, trusted));

    assert.equal(result.success, true);
    assert.equal(result.recordCount, 1);
    assert.equal(result.records[0].clientId, "client-a");
    assert.deepEqual(
      result.records[0].research.keywords,
      ["alpha", "beta"]
    );
    assert.equal(
      Object.hasOwn(result.records[0].brief, "clientAuthorization"),
      false
    );
    assert.equal(
      JSON.stringify(result).includes("client-b-only"),
      false
    );
    console.log("PASS: client-scoped retrieval and data isolation");
    console.log("PASS: authorization omitted from returned record");

    const limited = JSON.parse(await execute({
      clientId: "client-a",
      limit: 1
    }, trusted));

    assert.equal(limited.recordCount, 1);
    console.log("PASS: bounded retrieval");

    assert.equal(
      policy.getToolPolicy("seo_workflow_history")?.autonomous,
      false
    );
    assert.equal(
      policy.getToolPolicy("seo_workflow_history")?.humanApprovalRequired,
      true
    );
    console.log("PASS: autonomous execution policy blocks history tool");

    const server = fs.readFileSync("server.js", "utf8");

    assert.ok(server.includes('"seo_workflow_history"'));
    assert.ok(server.includes("historyTool.execute("));
    assert.ok(server.includes("requiresNamedAdminSession"));
    console.log("PASS: server dispatch has named-admin gate");

    console.log("SEO_WORKFLOW_HISTORY_TOOL_TEST=PASS");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error("SEO_WORKFLOW_HISTORY_TOOL_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
