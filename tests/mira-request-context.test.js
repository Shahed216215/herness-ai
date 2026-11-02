"use strict";

const assert = require("node:assert/strict");
const { selectRecentMessages } =
  require("../services/mira-request-context");

const history = [
  { role: "user", content: "old question" },
  { role: "assistant", content: "old answer" },
  { role: "agent", content: "recent answer" },
  { role: "user", content: "latest question" }
];

assert.deepEqual(selectRecentMessages(history), [
  { role: "user", content: "old question" },
  { role: "assistant", content: "old answer" },
  { role: "assistant", content: "recent answer" },
  { role: "user", content: "latest question" }
]);

assert.deepEqual(
  selectRecentMessages([
    { role: "user", content: "x".repeat(2000) },
    { role: "user", content: "keep this" },
    { role: "tool", content: "ignore this" }
  ]),
  [{ role: "user", content: "keep this" }]
);

const bounded = selectRecentMessages(
  Array.from({ length: 20 }, (_, i) => ({
    role: "user",
    content: `message-${i}`
  })),
  { maxMessages: 3, maxChars: 100, maxMessageChars: 50 }
);

assert.deepEqual(bounded.map(entry => entry.content), [
  "message-17",
  "message-18",
  "message-19"
]);

assert.deepEqual(selectRecentMessages(null), []);

console.log("PASS: request-context selection tests");
