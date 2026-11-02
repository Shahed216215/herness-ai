"use strict";
const assert = require("node:assert/strict");
const engine = require("../autonomous-learning-engine");

function source(title, url, hash = title) {
  return { title, url, snippet: "Research snippet", sourceHash: hash };
}

const valid = engine.validateResearchSources([
  source("A", "https://docs.example.com/a", "a"),
  source("B", "https://security.example.org/b", "b")
]);
assert.equal(valid.valid, true);
assert.equal(valid.sources.length, 2);
console.log("PASS: independent HTTPS hostnames accepted");

const badUrls = [
  "javascript:alert(1)",
  "file:///etc/passwd",
  "ftp://example.com/file",
  "https://user:pass@example.com/",
  "http://localhost/",
  "http://sub.localhost/",
  "http://127.0.0.1/",
  "http://192.168.1.10/",
  "http://[::1]/",
  "http://service.local/",
  "http://host.internal/"
];

for (const url of badUrls) {
  const result = engine.validateResearchSources([
    source("Bad", url, "bad"),
    source("Good", "https://public.example.org/page", "good")
  ]);
  assert.equal(
    result.sources.some(item => item.url === url),
    false,
    `Unsafe research URL retained: ${url}`
  );
}
console.log("PASS: unsafe schemes, credentials, local names and IP literals rejected");

const duplicates = engine.validateResearchSources([
  source("A", "https://docs.example.com/a", "same"),
  source("A duplicate", "https://docs.example.com/a", "same"),
  source("B", "https://security.example.org/b", "other")
]);
assert.equal(duplicates.valid, true);
assert.equal(duplicates.sources.length, 2);
console.log("PASS: duplicate evidence deduplicated");

const invalidOnly = engine.validateResearchSources([
  source("Local", "http://localhost/private", "local"),
  source("Private IP", "http://10.0.0.1/secret", "ip")
]);
assert.equal(invalidOnly.valid, false);
assert.equal(invalidOnly.sources.length, 0);
console.log("PASS: invalid-only sources cannot meet source threshold");

console.log("STAGE194_RESEARCH_URL_TEST=PASS");
