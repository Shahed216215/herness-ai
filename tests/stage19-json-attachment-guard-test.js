"use strict";

const assert = require("node:assert/strict");
const guard = require("../services/security/reject-unsupported-uploads");

function run({ type = "application/json", body } = {}) {
  let nextCalled = false;
  let statusCode = 200;
  let responseBody;
  const req = { headers: { "content-type": type }, body };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    }
  };
  guard(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, responseBody };
}

assert.equal(run({ body: { task: "summarize this paragraph" } }).nextCalled, true);
assert.equal(run({ body: { input: "normal user text", options: { language: "en" } } }).nextCalled, true);

for (const body of [
  { attachment: "payload" },
  { attachments: [{ name: "x", content: "payload" }] },
  { fileData: "payload" },
  { nested: { file_content: "payload" } },
  { image: "data:image/png;base64,AAAA" },
]) {
  const result = run({ body });
  assert.equal(result.statusCode, 415, JSON.stringify(body));
  assert.equal(result.nextCalled, false, JSON.stringify(body));
}

const multipart = run({
  type: "multipart/form-data; boundary=demo",
  body: undefined
});
assert.equal(multipart.statusCode, 415);
assert.equal(multipart.nextCalled, false);

const urlencoded = run({
  type: "application/x-www-form-urlencoded",
  body: { attachment: "legacy-form-field" }
});
assert.equal(urlencoded.nextCalled, true);

console.log("STAGE19_JSON_ATTACHMENT_GUARD=PASS");
console.log("NORMAL_JSON_TEXT=PASS");
console.log("EXPLICIT_ATTACHMENT_KEYS=BLOCKED");
console.log("BASE64_DATA_URI=BLOCKED");
console.log("MULTIPART=BLOCKED");
console.log("URLENCODED_POLICY_UNCHANGED=PASS");
