"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("public/index.html", "utf8");
const scriptMatch = html.match(
  /<script id="mira-seo-report-ui-script">([\\s\\S]*?)<\\/script>/
);
assert.ok(scriptMatch, "SEO report dashboard script must exist");
new vm.Script(scriptMatch[1], { filename: "mira-seo-report-ui-script.js" });

for (const marker of [
  'id="miraSeoReportForm"',
  'id="miraSeoReportKeywords"',
  'id="miraSeoReportCsv"',
  'id="miraSeoReportOutput"',
  'mira:seo-audit-ready',
  'mira:marketing-workflow-ready',
  '/api/admin/mira-seo/report',
  'navigator.clipboard.writeText',
  'mira-seo-report.md'
]) {
  assert.ok(html.includes(marker), "Missing dashboard integration marker: " + marker);
}
console.log("SEO_REPORT_DASHBOARD_SCRIPT_SYNTAX=PASS");
console.log("SEO_REPORT_DASHBOARD_WORKFLOW_WIRING=PASS");
console.log("SEO_REPORT_DASHBOARD_TEST_STATUS=PASS");
