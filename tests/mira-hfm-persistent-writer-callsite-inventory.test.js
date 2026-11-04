'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tests', 'docs', 'reports', 'backups', 'coverage']);
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);
const WRITER_CALL = /\b(addMemory|addKnowledge|addLearning|updateKnowledge|updateLearning|deleteKnowledge|replaceKnowledge|learnFromContent)\s*\(/g;

function walk(directory, relative = '') {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) continue;
    const rel = relative ? path.join(relative, entry.name) : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) output.push(...walk(full, rel));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      output.push({ full, relative: rel.split(path.sep).join('/') });
    }
  }
  return output;
}

const findings = [];
for (const file of walk(ROOT)) {
  const source = fs.readFileSync(file.full, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\\s*(?:\\/\\/|\\*|\\*\\/)/.test(line)) return;
    WRITER_CALL.lastIndex = 0;
    let match;
    while ((match = WRITER_CALL.exec(line)) !== null) {
      findings.push({
        file: file.relative,
        line: index + 1,
        operation: match[1]
      });
    }
  });
}

const actualFiles = [...new Set(findings.map(item => item.file))].sort();
const reviewedFiles = [
  'autonomous-learning-controlled-apply.js',
  'knowledge-controlled-apply.js',
  'knowledge.js',
  'memory.js',
  'server.js',
  'services/learning.js',
  'tools/knowledge-cleanup.js',
  'tools/knowledge-save.js',
  'tools/learning-save.js',
  'tools/memory-save.js'
].sort();

const unexpected = actualFiles.filter(file => !reviewedFiles.includes(file));
const missing = reviewedFiles.filter(file => !actualFiles.includes(file));

assert.deepEqual(unexpected, [], 'new persistent writer callsite file requires review');
assert.deepEqual(missing, [], 'reviewed persistent writer callsite inventory changed');

console.log('MIRA_HFM_PERSISTENT_WRITER_CALLSITE_INVENTORY=PASS');
console.log('MIRA_HFM_PERSISTENT_WRITER_FILE_COUNT=' + actualFiles.length);
console.log('MIRA_HFM_PERSISTENT_WRITER_MATCH_COUNT=' + findings.length);
console.log('MIRA_HFM_UNREVIEWED_WRITER_FILES=0');
console.log('MIRA_HFM_MISSING_REVIEWED_WRITER_FILES=0');
for (const item of findings) {
  console.log('MIRA_HFM_WRITER_CALLSITE=' + item.file + ':' + item.line + ':' + item.operation);
}
console.log('MIRA_HFM_PERSISTENT_WRITER_INVENTORY_TESTS_FAILED=0');
