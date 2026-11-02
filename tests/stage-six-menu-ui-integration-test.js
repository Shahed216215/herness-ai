"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");

const server = fs.readFileSync("server.js", "utf8");
const ui = fs.readFileSync("public/index.html", "utf8");
const contract = fs.readFileSync("docs/architecture/UI-ACCEPTANCE-CONTRACT.md", "utf8");

const slugs = [
  "find-work", "clients", "projects", "deliveries", "earnings", "activity-audit"
];
for (const slug of slugs) {
  assert.match(ui, new RegExp('id="section-' + slug + '"'));
  assert.match(ui, new RegExp('six-menu-status-' + slug));
  assert.match(ui, new RegExp('six-menu-data-' + slug));
}
for (const endpoint of [
  "/api/admin/opportunities",
  "/api/client-profiles",
  "/api/admin/projects",
  "/deliverables",
  "/api/admin/work-economics",
  "/api/admin/audit-log?limit=100"
]) assert.ok(ui.includes(endpoint), "missing UI endpoint: " + endpoint);

assert.match(server, /SIX_MENU_READ_ONLY_PROJECTS_ROUTE/);
assert.match(server, /requireAdminPermission\(PERMISSIONS\.SYSTEM_ADMIN\)/);
assert.match(server, /listProjectsForSixMenu\(\)/);
assert.match(ui, /credentials:\s*"same-origin"/);
assert.match(ui, /response\.status === 401/);
assert.match(ui, /response\.status === 403/);
assert.match(ui, /SIX_MENU_UI_INTEGRATION_V1/);
assert.match(ui, /pre\.textContent\s*=\s*safeText/);
assert.ok(!/SIX_MENU_UI_INTEGRATION_V1[\s\S]*?\.innerHTML\s*=/.test(ui),
  "integration must not render API data using innerHTML");
assert.ok(contract.includes("UI-ACCEPTANCE") || contract.length > 0);
console.log("STAGE_SIX_MENU_UI_INTEGRATION_TEST=PASS");
