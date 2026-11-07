'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
for (const file of walk(ROOT)) {
  const source = fs.readFileSync(file.full, 'utf8');
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
