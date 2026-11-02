'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync(
  'scripts/mira-control-agent.js',
  'utf8'
);

assert.match(
  source,
  /if \(r\.error\) throw new Error\('COMMAND_EXECUTION_FAILED'\);/,
  'execution errors must use a fixed, non-sensitive message'
);

assert.match(
  source,
  /if \(r\.status !== 0\) \{\s*throw new Error\('COMMAND_FAILED'\);\s*\}/,
  'nonzero command exit must use a fixed message'
);

assert.doesNotMatch(
  source,
  /String\(r\.stderr\s*\|\|\s*''\)\.slice/,
  'raw stderr must not be included in thrown command errors'
);

assert.doesNotMatch(
  source,
  /new Error\(`\$\{bin\} failed \(exit \$\{r\.status\}\):/,
  'stderr-bearing error template must not remain'
);

assert.match(
  source,
  /result = 'TASK_FAILED=ACTION_FAILED';/,
  'task failure reporting path should remain bounded'
);

console.log('PASS: execution error uses fixed message');
console.log('PASS: nonzero exit uses fixed message');
console.log('PASS: raw stderr is not included in command errors');
console.log('PASS: unsafe error template is absent');
console.log('PASS: task failure output remains bounded');
console.log('ERROR_DISCLOSURE_STATIC_REGRESSION=PASS');
