"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("public/index.html", "utf8");

function extractFunction(start, end) {
  const from = html.indexOf(start);
  assert.notEqual(from, -1, `Missing source marker: ${start}`);
  const to = html.indexOf(end, from);
  assert.notEqual(to, -1, `Missing end marker: ${end}`);
  return html.slice(from, to);
}

const safeCodeSource = extractFunction(
  "  function safeCode(value, fallback) {",
  "  async function request(path, options) {"
);
assert.match(safeCodeSource, /return \/\^\[A-Za-z0-9_-\]\{1,64\}\$\/\.test\(code\)/);
assert.match(safeCodeSource, /return \/\^\[A-Za-z0-9_-\]\{1,64\}\$\/\.test\(code\) \? code : fallback;/);
console.log("PASS: status sanitizer allowlists simple status codes");

const requestSource = extractFunction(
  "  async function request(path, options) {",
  "  async function run(label, operation) {"
);
assert.match(requestSource, /credentials:\s*"same-origin"/);
assert.ok(requestSource.includes("const error = new Error(status);"));
assert.ok(requestSource.includes("error.rollbackCompleted = true;"));
assert.ok(requestSource.includes("error.verificationStatus = safeCode("));
assert.match(requestSource, /typeof payload\.verification === "string"/);
assert.ok(requestSource.includes("throw error;"));
assert.doesNotMatch(requestSource, /payload\.error/);
console.log("PASS: HTTP errors do not forward raw payload.error");

const runSource = extractFunction(
  "  async function run(label, operation) {",
  '  $("miraProviderProposal").addEventListener'
);
assert.match(runSource, /result\.success === false/);
assert.match(runSource, /safeCode\(\s*error && error\.message/);
assert.ok(runSource.includes("error && error.rollbackCompleted === true"));
assert.ok(runSource.includes('failureParts.push("rollback_completed")'));
assert.ok(runSource.includes("error && error.verificationStatus"));
assert.doesNotMatch(runSource, /String\(result\.error\)/);
assert.doesNotMatch(runSource, /String\(result\.health\.error\)/);
console.log("PASS: failure UI does not directly render provider error strings");

assert.match(runSource, /result\.rollback === "completed"/);
assert.match(runSource, /result\.verification && result\.verification\.status/);
assert.match(runSource, /typeof result\.verification === "string"/);
console.log("PASS: rollback and verification status are handled");

const proposalHandler = extractFunction(
  '  $("miraProviderProposal").addEventListener',
  '  $("miraProviderHealth").addEventListener'
);
assert.match(proposalHandler, /result\.success/);
assert.match(proposalHandler, /proposal\.changeId \|\| proposal\.id/);
console.log("PASS: proposal success requires an ID");

const stageHandler = extractFunction(
  '  $("miraProviderApply").addEventListener',
  '  $("miraProviderActivate").addEventListener'
);
assert.match(stageHandler, /state\.staged = Boolean\(result\.success && result\.status === "staged"\)/);
assert.ok(stageHandler.includes('"/apply"'));
console.log("PASS: staging state requires successful stage response");

const activateHandler = extractFunction(
  '  $("miraProviderActivate").addEventListener',
  '  $("miraProviderVerify").addEventListener'
);
assert.match(activateHandler, /state\.applied = Boolean\(result\.success\)/);
assert.ok(activateHandler.includes('"/activate"'));
assert.ok(activateHandler.includes("window.confirm"));
console.log("PASS: live activation is separate and explicitly confirmed");

console.log("MOCK_ONLY_PROVIDER_UI_ERROR_CONTRACT=PASS");
console.log("LIVE_PROVIDER_REQUESTS=0");
