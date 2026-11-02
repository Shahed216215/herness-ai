"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");

const cases = [
  ["tools/web-search.js", "../services/security/secure-provider-request"],
  ["providers/openrouter.js", "../services/security/secure-provider-request"],
  ["providers/deepseek.js", "../services/security/secure-provider-request"],
  ["providers/huggingface.js", "../services/security/secure-provider-request"]
];

for (const [file, importPath] of cases) {
  const source = fs.readFileSync(file, "utf8");

  assert.ok(
    source.includes(importPath),
    `${file}: approved secure request wrapper import missing`
  );
  assert.match(
    source,
    /secureProviderRequest\s*\(/,
    `${file}: secure request wrapper call missing`
  );
  assert.doesNotMatch(
    source,
    /\bfetch\s*\(|\baxios\s*[.]\s*(?:request|post|get)\s*\(/,
    `${file}: direct outbound network call remains`
  );
  assert.match(
    source,
    /https:\/\//,
    `${file}: expected fixed HTTPS endpoint missing`
  );

  console.log("PASS:", file);
}

console.log("STAGE19_OUTBOUND_CALLSITE_INTEGRATION=PASS");
