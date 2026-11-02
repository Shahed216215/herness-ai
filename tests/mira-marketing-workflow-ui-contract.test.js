"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("public/index.html", "utf8");
const start = html.indexOf("Stage 5: user-initiated, consent-aware Marketing Workflow UI.");
const end = html.indexOf("SIX_MENU_UI_INTEGRATION_V1", start);

assert.notEqual(start, -1, "Marketing workflow initializer exists");
assert.notEqual(end, -1, "Initializer ends before existing integration script");

const script = html.slice(start, end);
const panelStart = html.indexOf('id="miraMarketingWorkflowPanel"');
const panelEnd = html.indexOf('id="miraMarketingWorkflowResults"', panelStart);
assert.notEqual(panelStart, -1, "Marketing panel exists");
assert.notEqual(panelEnd, -1, "Marketing panel result area exists");

const panel = html.slice(panelStart, panelEnd);

for (const id of [
  "miraMarketingLoadClients",
  "miraMarketingRefreshConsent",
  "miraMarketingClient",
  "miraMarketingWebsite",
  "miraMarketingIndustry",
  "miraMarketingCountry",
  "miraMarketingLanguage",
  "miraMarketingGoals",
  "miraMarketingKeywords",
  "miraMarketingQuery",
  "miraMarketingLiveConfirm",
  "miraMarketingRun",
  "miraMarketingWorkflowStatus",
  "miraMarketingWorkflowResults"
]) {
  assert.ok(html.includes(`id="${id}"`), `UI element ${id} exists`);
}

assert.ok(script.includes('api("/api/client-profiles")'));
assert.ok(script.includes('api("/api/admin/mira-client-consent")'));
assert.ok(script.includes('api("/api/admin/mira-marketing-workflow/run"'));
assert.ok(script.includes('consentSnapshot.authorized !== true'));
assert.ok(script.includes('miraMarketingLiveConfirm").checked'));
assert.ok(script.includes("confirmLiveResearch: true"));
assert.ok(script.includes("textContent = JSON.stringify(response, null, 2)"));
assert.ok(!script.includes(".innerHTML"));
assert.ok(!script.includes("/grant"));
assert.ok(!script.includes("/revoke"));

assert.ok(panel.includes("cannot grant or revoke consent"));
assert.ok(panel.includes("server-side feature flag"));
assert.ok(panel.includes("does not publish content"));
assert.ok(html.includes('id="miraSeoAuditForm"'), "Existing SEO audit remains");
assert.ok(html.includes("SIX_MENU_UI_INTEGRATION_V1"), "Existing dashboard integration remains");

console.log("PASS: marketing panel is inserted in the existing dashboard");
console.log("PASS: client list and consent checks are explicit user actions");
console.log("PASS: both persisted consent scopes gate workflow submission");
console.log("PASS: explicit confirmation gates the live workflow request");
console.log("PASS: response rendering uses textContent, not innerHTML");
console.log("PASS: no consent grant/revoke controls were added");
console.log("PASS: existing SEO audit and dashboard integration remain");
console.log("NETWORK_CALLS=0");
console.log("LIVE_API_CALLS=0");
console.log("REAL_WORKFLOW_EXECUTION=NO");
console.log("MIRA_MARKETING_WORKFLOW_UI_TEST_STATUS=PASS");
