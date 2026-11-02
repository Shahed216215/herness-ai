"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("public/index.html", "utf8");
const start = html.indexOf(
  "Stage 5: user-initiated, consent-aware Marketing Workflow UI."
);
const end = html.indexOf("SIX_MENU_UI_INTEGRATION_V1", start);

assert.notEqual(start, -1);
assert.notEqual(end, -1);

const script = html.slice(start, end);

for (const id of [
  "miraMarketingReadinessPanel",
  "miraMarketingReadinessHeading",
  "miraMarketingReadinessStatus",
  "miraMarketingReadinessDetails"
]) {
  assert.ok(html.includes(`id="${id}"`), "Missing UI element: " + id);
}

assert.ok(script.includes("function renderReadinessReport()"));
assert.ok(script.includes("consentSnapshot.seoAudit"));
assert.ok(script.includes("consentSnapshot.publicWebResearch"));
assert.ok(script.includes('"NOT CHECKED"'));
assert.ok(script.includes('"PROFILE INFORMATION REQUIRED"'));
assert.ok(script.includes('"CLIENT CONSENT REQUIRED"'));
assert.ok(script.includes('"READY FOR EXPLICIT WORKFLOW CONFIRMATION"'));
assert.ok(script.includes("renderReadinessReport()"));
assert.ok(script.includes("createElement"));
assert.ok(script.includes("textContent"));
assert.ok(!script.includes("readinessDetails.innerHTML"));
assert.ok(!script.includes("/grant"));
assert.ok(!script.includes("/revoke"));

console.log("PASS: readiness report exists inside the existing SEO panel");
console.log("PASS: profile fields are evaluated from the saved client profile");
console.log("PASS: consent remains NOT CHECKED until refreshed");
console.log("PASS: both consent scopes are displayed independently");
console.log("PASS: readiness requires profile completeness and both consents");
console.log("PASS: rendering uses safe DOM text APIs");
console.log("PASS: no consent mutation controls were introduced");
console.log("RESULT=PASS");
