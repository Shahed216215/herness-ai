"use strict";

const assert = require("node:assert/strict");
const { _internals } = require("../tools/mira-one-run-audit");

const compare = _internals.compareHashes(
  { a: "same", b: "old" },
  { a: "same", b: "new", c: "added" }
);
assert.deepEqual(compare.unchanged, ["a"]);
assert.deepEqual(compare.changed, ["b", "c"]);

const tail = _internals.safeTail(
  "line one\napi_key=supersecret\nline three",
  2
);
assert.equal(tail.length, 2);
assert.match(tail[0], /REDACTED/);
assert.doesNotMatch(tail.join("\n"), /supersecret/);

console.log("MIRA_ONE_RUN_AUDIT_UNIT_TEST=PASS");
