'use strict';
const assert = require('node:assert/strict');
const { classifySource } = require('../scripts/mira-hfm-boundary-inventory');

const source = [
  "const { getKnowledge } = require('../knowledge');",
  "const { loadKnowledgeFromDrive } = require('../google-drive');",
  "getKnowledge(); loadKnowledgeFromDrive();",
  "const data = fs.readFileSync(file, 'utf8');",
  "const safe = true;"
].join('\n');
const result = classifySource('tools/knowledge-search.js', source);
assert.equal(result.domainPath, true);
assert.ok(result.matches.some(x => x.category === 'DOMAIN_IMPORT'));
assert.ok(result.matches.some(x => x.category === 'DOMAIN_API'));
assert.ok(result.matches.some(x => x.category === 'STATE_IO'));
console.log('DOMAIN_IMPORTS_AND_IO_CLASSIFIED=PASS');

const unrelated = classifySource('utils/math.js', 'function add(a,b){ return a+b; }');
assert.equal(unrelated.matches.length, 0);
assert.equal(unrelated.domainPath, false);
console.log('UNRELATED_SOURCE_EXCLUDED=PASS');

const recovery = classifySource('services/recovery.js', 'restoreSnapshot(id);');
assert.ok(recovery.matches.some(x => x.category === 'RECOVERY_OR_SNAPSHOT'));
console.log('RECOVERY_CALLSITE_CLASSIFIED=PASS');

console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_STATIC_BOUNDARY_SCANNER_TEST_PASS');
