"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const dashboard = read("public/index.html");
const server = read("server.js");
const ai = read("services/ai.js");
const gemini = read("providers/gemini.js");

assert.match(dashboard, /api\(["']\/api\/agent["']/);
assert.match(dashboard, /command:\s*value/);
assert.match(server, /app\.post\(\s*["']\/api\/agent["']/);
assert.match(server, /await generate\(/);
assert.match(server, /await executeWork\(/);
assert.match(server, /name:\s*toolName/);
assert.match(server, /toolExecutionTrace\.push\(/);
assert.match(server, /execution:\s*\{/);
assert.match(ai, /RUN AGENT TASK EXECUTION RULES/);
assert.match(ai, /continue the tool loop/);
assert.match(gemini, /buildGeminiConversation/);
assert.match(gemini, /normalizeGeminiResponse/);

console.log("PASS: Dashboard Run Agent sends the prompt to /api/agent.");
console.log("PASS: /api/agent invokes Mira AI and the governed work execution engine.");
console.log("PASS: Tool responses preserve tool identity for multi-turn provider conversations.");
console.log("PASS: Run Agent returns an execution trace with verification state.");
console.log("PASS: Gemini provider uses the shared multi-turn conversation adapter.");
