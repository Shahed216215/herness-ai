'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const middlewarePath = path.join(root, 'services/security/reject-unsupported-uploads.js');
const serverPath = path.join(root, 'server.js');
const middleware = require(middlewarePath);
const server = fs.readFileSync(serverPath, 'utf8');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`PASS=${name}`); }
  catch (e) { failed++; console.log(`FAIL=${name};${e.message}`); }
}
function invoke(contentType) {
  let nextCalled = false;
  let statusCode = 200;
  let body;
  const req = { headers: { 'content-type': contentType }, method: 'POST', url: '/test' };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
    send(value) { body = value; return this; },
    end(value) { body = value; return this; }
  };
  middleware(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, body };
}

test('MULTIPART_RUNTIME_REJECTED', () => {
  const r = invoke('multipart/form-data; boundary=test');
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 415);
});
test('JSON_REQUEST_PASSES_GUARD', () => {
  const r = invoke('application/json');
  assert.equal(r.nextCalled, true);
});
test('URLENCODED_REQUEST_PASSES_GUARD', () => {
  const r = invoke('application/x-www-form-urlencoded');
  assert.equal(r.nextCalled, true);
});
test('SERVER_INSTALLS_GUARD_BEFORE_JSON_PARSER', () => {
  const g = server.indexOf('rejectUnsupportedUploads');
  const j = server.indexOf('express.json');
  assert.ok(g >= 0 && j >= 0 && g < j, `guard=${g}, jsonParser=${j}`);
});

console.log(`ATTACHMENT_GUARD_RUNTIME_TESTS=${passed}/${passed + failed}`);
console.log('ATTACHMENT_SECURITY=NOT_PROVEN');
console.log('OUTBOUND_NETWORK_COVERAGE=NOT_PROVEN');
console.log('NOTE=Middleware behavior is tested; this does not prove all attachment paths or outbound runtime safety.');
process.exitCode = failed ? 1 : 0;
