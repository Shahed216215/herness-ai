"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const tool = require("../tools/project-connection-audit");
  assert.equal(tool.name, "project_connection_audit");
  assert.equal(tool.declaration.name, tool.name);
  assert.equal(typeof tool.execute, "function");

  const raw = await tool.execute({});
  const report = JSON.parse(raw);

  assert.equal(report.tool, tool.name);
  assert.ok(Array.isArray(report.checks));
  assert.ok(Array.isArray(report.findings));
  assert.equal(report.scope.filesModified, false);
  assert.equal(report.scope.networkRequests, 0);
  assert.equal(report.scope.liveApiRequests, 0);
  assert.equal(report.scope.secretsRead, false);
  assert.equal(report.scope.testExecutionPerformed, false);

  const engine = fs.readFileSync(
    path.join(__dirname, "../services/mira-work-execution-engine.js"),
    "utf8"
  );
  assert.match(engine, /project_connection_audit:\s*\{\s*operation:\s*"inspect"/);

  console.log("PROJECT_CONNECTION_AUDIT_TEST=PASS");
  console.log("AUDIT_STATUS=" + report.status);
  console.log("CHECK_COUNT=" + report.checks.length);
  console.log("FINDING_COUNT=" + report.findings.length);
  console.log("NETWORK_REQUESTS=0");
  console.log("LIVE_API_REQUESTS=0");
  console.log("FILES_MODIFIED_BY_TOOL=0");
}

main().catch(error => {
  console.error("PROJECT_CONNECTION_AUDIT_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
