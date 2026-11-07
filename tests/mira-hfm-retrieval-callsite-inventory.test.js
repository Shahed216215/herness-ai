'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tests', 'docs', 'reports', 'backups', 'coverage']);
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);
const RETRIEVAL_CALL = /\b(getKnowledge|searchKnowledge|getMemory|searchMemory|loadKnowledgeFromDrive|loadMemoryFromDrive)\s*\(/g;
const TRUST_FILTER = /\bfilterTrustedRecords\s*\(/;
const QUARANTINE_FILTER = /\b(?:filterQuarantinedRecords|isConflictQuarantined|isQuarantined|conflictQuarantineRegistry)\b/;
const LEGACY_HFM_GUARD = /assertLegacyStorageDisabled\s*\(|denyLegacyKnowledgeImprovementAccess\s*\(|HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY|HFM_READ_ONLY_AUTHORITY_BLOCKS_LOCAL_EXPERIENCE|MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED\s*===\s*["']true["']/;

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
const consumerFiles = new Map();
const sourceByRelative = new Map();
for (const file of walk(ROOT)) {
  const source = fs.readFileSync(file.full, 'utf8');
  sourceByRelative.set(file.relative, source);
  const lines = source.split(/\r?\n/);
  const filters = {
    trusted: TRUST_FILTER.test(source),
    quarantine: QUARANTINE_FILTER.test(source),
    legacyGuarded: LEGACY_HFM_GUARD.test(source)
  };
  lines.forEach((line, index) => {
    if (/^\s*(?:\/\/|\*|\*\/)/.test(line)) return;
    RETRIEVAL_CALL.lastIndex = 0;
    let match;
    while ((match = RETRIEVAL_CALL.exec(line)) !== null) {
      findings.push({
        file: file.relative,
        line: index + 1,
        operation: match[1],
        trustedFilterInFile: filters.trusted,
        quarantineFilterInFile: filters.quarantine,
        legacyHfmGuardInFile: filters.legacyGuarded
      });
      consumerFiles.set(file.relative, filters);
    }
  });
}

const unguardedFiles = [...consumerFiles.entries()]
  .filter(([, filters]) => (!filters.trusted || !filters.quarantine) && !filters.legacyGuarded)
  .map(([file]) => file)
  .sort();

const requiredBoundaryContracts = [
  ['google-drive.js', /async function loadKnowledgeFromDrive\(\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'Drive Knowledge reader'],
  ['google-drive.js', /async function loadMemoryFromDrive\(\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'Drive Memory reader'],
  ['google-drive.js', /async function saveKnowledgeToDrive\(data\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'Drive Knowledge writer'],
  ['google-drive.js', /async function saveMemoryToDrive\(data\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'Drive Memory writer'],
  ['knowledge.js', /function loadKnowledge\(\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'local Knowledge reader'],
  ['knowledge.js', /function saveLocalKnowledge\(data\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'local Knowledge writer'],
  ['memory.js', /function loadMemory\(\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'local Memory reader'],
  ['memory.js', /function saveMemory\(memory\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'local Memory writer'],
  ['knowledge-memory-evolution.js', /function readJsonFile\(filePath\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'legacy evolution JSON reader'],
  ['knowledge-memory-evolution.js', /function atomicWriteJson\(filePath, value\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'legacy evolution JSON writer'],
  ['autonomous-learning-controlled-apply.js', /function readLocalKnowledge\(\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'controlled-learning local reader'],
  ['autonomous-learning-controlled-apply.js', /function writeLocalKnowledge\(data\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'controlled-learning local writer'],
  ['knowledge-controlled-apply.js', /async function applyKnowledgeImprovementControlled\(\s*options = \{\}\s*\)\s*\{\s*assertLegacyStorageDisabled\(\);/, 'controlled Knowledge apply boundary'],
  ['services/learning.js', /async function learnFromContent\([\s\S]{0,180}?\)\s*\{\s*assertLegacyLearningStorageAllowed\(\);/, 'Learning source save boundary'],
  ['services/learning.js', /async function improveExistingKnowledge\([\s\S]{0,180}?\)\s*\{\s*assertLegacyLearningStorageAllowed\(\);/, 'Learning improvement boundary'],
  ['services/learning.js', /async function applyKnowledgeImprovement\([\s\S]{0,180}?\)\s*\{\s*assertLegacyLearningStorageAllowed\(\);/, 'Learning apply boundary'],
  ['routes/knowledge-improvements.js', /app\.get\(\s*"\\/api\\/admin\\/knowledge-improvements",[\s\S]{0,350}?denyLegacyKnowledgeImprovementAccess\(req, res, "listing"\)/, 'Knowledge improvement list route'],
  ['routes/knowledge-improvements.js', /app\.get\(\s*"\\/api\\/admin\\/knowledge-improvements\/:id",[\s\S]{0,350}?denyLegacyKnowledgeImprovementAccess\(req, res, "detail read"\)/, 'Knowledge improvement detail route'],
  ['routes/knowledge-improvements.js', /app\.post\(\s*"\\/api\\/admin\\/knowledge-improvements\/:id\\/approve",[\s\S]{0,350}?denyLegacyKnowledgeImprovementAccess\(req, res, "approval"\)/, 'Knowledge improvement approval route'],
  ['routes/knowledge-improvements.js', /app\.post\(\s*"\\/api\\/admin\\/knowledge-improvements\/:id\\/reject",[\s\S]{0,350}?denyLegacyKnowledgeImprovementAccess\(req, res, "rejection"\)/, 'Knowledge improvement rejection route'],
  ['routes/knowledge-improvements.js', /app\.post\(\s*"\\/api\\/admin\\/knowledge-improvements\/:id\\/apply",[\s\S]{0,350}?denyLegacyKnowledgeImprovementAccess\(req, res, "apply"\)/, 'Knowledge improvement apply route']
];

for (const [file, pattern, label] of requiredBoundaryContracts) {
  const source = sourceByRelative.get(file);
  assert.ok(source, 'Required legacy storage boundary file missing: ' + file);
  assert.match(source, pattern, 'HFM fail-closed guard missing at ' + label);
}
console.log('MIRA_HFM_LEGACY_STORAGE_BOUNDARY_GUARDS=PASS');

console.log('MIRA_HFM_RETRIEVAL_CALLSITE_INVENTORY=GENERATED');
console.log('MIRA_HFM_RETRIEVAL_CALL_COUNT=' + findings.length);
console.log('MIRA_HFM_RETRIEVAL_CONSUMER_FILE_COUNT=' + consumerFiles.size);
console.log('MIRA_HFM_RETRIEVAL_FILES_WITHOUT_BOTH_FILTER_MARKERS=' +
  [...consumerFiles.values()].filter(filters => !filters.trusted || !filters.quarantine).length);
console.log('MIRA_HFM_RETRIEVAL_UNGUARDED_LEGACY_FILES=' + unguardedFiles.length);
for (const item of findings) {
  console.log(
    'MIRA_HFM_RETRIEVAL_CALLSITE=' +
    item.file + ':' + item.line + ':' + item.operation +
    ':trustedFilterInFile=' + item.trustedFilterInFile +
    ':quarantineFilterInFile=' + item.quarantineFilterInFile +
    ':legacyHfmGuardInFile=' + item.legacyHfmGuardInFile
  );
}
for (const file of unguardedFiles) {
  console.log('MIRA_HFM_RETRIEVAL_REVIEW_REQUIRED=' + file);
}
console.log('MIRA_HFM_LEGACY_RETRIEVAL_GUARD_COVERAGE=' +
  (unguardedFiles.length === 0 ? 'PASS' : 'REVIEW_REQUIRED'));
console.log('MIRA_HFM_RETRIEVAL_TRUST_FILTER_COVERAGE=' +
  (unguardedFiles.length === 0 ? 'PASS_WITH_FAIL_CLOSED_LEGACY_GUARDS' : 'REVIEW_REQUIRED'));
console.log('PRODUCTION_MEMORY_KNOWLEDGE_TOUCHED=NO');
console.log('NETWORK_REQUESTS=0');
console.log('EXTERNAL_ACTIONS=0');
