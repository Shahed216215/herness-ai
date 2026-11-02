"use strict";
const assert = require("node:assert/strict");
const guard = require("../services/security/reject-unsupported-uploads");

function run(type) {
  let status, payload, next = 0;
  const res = {
    status(n) { status = n; return this; },
    json(v) { payload = v; return this; }
  };
  guard({ headers: { "content-type": type } }, res, () => next++);
  return { status, payload, next };
}

for (const type of [
  "multipart/form-data",
  "Multipart/Form-Data; boundary=abc"
]) {
  const r = run(type);
  assert.equal(r.status, 415);
  assert.equal(r.next, 0);
  assert.equal(r.payload.error, "Multipart uploads are not supported by this service");
}
for (const type of ["application/json", "text/plain", undefined]) {
  const r = run(type);
  assert.equal(r.next, 1);
  assert.equal(r.status, undefined);
}
console.log("PASS: multipart blocked; other content types continue");
