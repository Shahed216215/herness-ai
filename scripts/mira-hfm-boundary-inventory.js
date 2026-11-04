'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx']);
const EXCLUDED = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next']);
const RULES = [
  ['DOMAIN_IMPORT', /(?:require\s*\(\s*['"][^'"]*(?:memory|knowledge|conversation|learning)[^'"]*['"]\s*\)|from\s*['"][^'"]*(?:memory|knowledge|conversation|learning)[^'"]*['"])/i],
  ['DOMAIN_API', /\b(?:getMemory|addMemory|saveMemory|loadMemory|restoreMemory|getKnowledge|addKnowledge|updateKnowledge|replaceKnowledge|addLearning|updateLearning|deleteKnowledge|searchKnowledge|loadKnowledgeFromDrive|saveKnowledgeToDrive|loadMemoryFromDrive|saveMemoryToDrive|listMessages|createStoredMessage|updateConversationMemory|getConversationMemory|createKnowledgeBackup|restoreKnowledge|createBackup)\s*\(/],
  ['STATE_IO', /\b(?:readJsonArray|writeArrayState|atomicWriteJson|readFileSync|writeFileSync|createReadStream|createWriteStream|renameSync|copyFileSync|unlinkSync)\s*\(/],
  ['RECOVERY_OR_SNAPSHOT', /\b(?:createSnapshot|verifySnapshot|restoreSnapshot|restoreVersion|createBackup|restoreMemory|restoreKnowledge)\s*\(/]
];

function classifySource(relativePath, source) {
  const matches = [];
  const lines = String(source).split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    for (const [category, pattern] of RULES) {
      if (pattern.test(lines[index])) {
        matches.push({ line: index + 1, category, excerpt: lines[index].trim().slice(0, 220) });
      }
    }
  }
  const domainPath = /(?:memory|knowledge|conversation|learning|backup|restore|evolution|retriev|export|import|drive|snapshot)/i.test(relativePath);
  return { relativePath, domainPath, matches };
}
function walk(root, relative = '') {
  const absolute = path.join(root, relative);
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED.has(entry.name)) files.push(...walk(root, path.join(relative, entry.name)));
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.join(relative, entry.name));
    }
  }
  return files;
}
function scanRepository(root = process.cwd()) {
  const files = walk(root);
  const results = [];
  for (const relativePath of files) {
    const absolute = path.join(root, relativePath);
    const source = fs.readFileSync(absolute, 'utf8');
    const result = classifySource(relativePath, source);
    if (result.domainPath || result.matches.length) results.push(result);
  }
  return {
    scannedCodeFiles: files.length,
    relevantFiles: results.length,
    matchCount: results.reduce((total, item) => total + item.matches.length, 0),
    results
  };
}
if (require.main === module) {
  const report = scanRepository(process.cwd());
  const summary = {
    SCANNED_CODE_FILES: report.scannedCodeFiles,
    DOMAIN_RELEVANT_FILES: report.relevantFiles,
    DOMAIN_CALLSITE_MATCHES: report.matchCount,
    STATIC_REGEX_AUDIT_ONLY: true,
    RUNTIME_DATA_ACCESSED: false,
    NETWORK_REQUESTS: 0
  };
  for (const [key, value] of Object.entries(summary)) console.log(key + '=' + value);
  if (process.env.MIRA_HFM_INVENTORY_FULL === '1') {
    for (const item of report.results) {
      if (!item.matches.length) continue;
      for (const match of item.matches) {
        console.log([item.relativePath, match.line, match.category, match.excerpt].join('\t'));
      }
    }
  }
}
module.exports = { classifySource, scanRepository };
