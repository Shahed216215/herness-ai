'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const toolsDir = path.join(__dirname, '..', 'tools');
const enginePath = path.join(__dirname, '..', 'services', 'mira-work-execution-engine.js');
const registryPath = path.join(toolsDir, 'index.js');

function extractExportObject(source, file) {
  const match = source.match(/module\\.exports\\s*=\\s*\\{([\\s\\S]*?)\\n\\};/);
  if (!match) return null;
  const block = match[1];
  const hasName = /^\\s*name\\s*(?::|,|$)/m.test(block);
  const hasDeclaration = /^\\s*declaration\\s*(?::|,|$)/m.test(block);
  const hasExecute = /^\\s*execute\\s*(?::|,|$)/m.test(block);
  if (!hasName || !hasDeclaration || !hasExecute) return null;

  const explicit = block.match(/^\\s*name\\s*:\\s*["']([a-zA-Z0-9_-]+)["']/m);
  if (explicit) return explicit[1];

  const shorthand = /^\\s*name\\s*,?\\s*$/m.test(block);
  if (!shorthand) return null;
  const declared = source.match(/^\\s*const\\s+name\\s*=\\s*["']([a-zA-Z0-9_-]+)["']\\s*;/m);
  return declared ? declared[1] : null;
}

const indexSource = fs.readFileSync(registryPath, 'utf8');
assert.match(indexSource, /readdirSync\\(__dirname\\)/, 'runtime registry must enumerate tools directory');
assert.match(indexSource, /file !== ["']index\\.js["']/, 'runtime registry must exclude itself');
assert.match(indexSource, /tool\\.name && tool\\.declaration && tool\\.execute/, 'runtime registration contract changed; review this test');

const active = [];
const unclassified = [];
for (const file of fs.readdirSync(toolsDir).filter(name => name.endsWith('.js') && name !== 'index.js').sort()) {
  const source = fs.readFileSync(path.join(toolsDir, file), 'utf8');
  const name = extractExportObject(source, file);
  if (name) active.push({ file, name });
  else {
    const exportsObject = source.match(/module\\.exports\\s*=\\s*\\{([\\s\\S]*?)\\n\\};/);
    if (exportsObject && /name|declaration|execute/.test(exportsObject[1])) {
      unclassified.push(file);
    }
  }
}

assert.deepEqual(unclassified, [], 'tool-like exports need manual classification');
const names = active.map(item => item.name);
assert.equal(new Set(names).size, names.length, 'duplicate runtime tool names');
assert.ok(active.length > 0, 'no active tools discovered');

const engine = fs.readFileSync(enginePath, 'utf8');
const policyMatch = engine.match(/const TOOL_POLICIES\\s*=\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\}\\);/);
assert.ok(policyMatch, 'TOOL_POLICIES object not found');
const policies = [...policyMatch[1].matchAll(/^\\s{2}([a-z0-9_]+):\\s*\\{/gm)].map(match => match[1]);
assert.equal(new Set(policies).size, policies.length, 'duplicate policy keys');

const activeSet = new Set(names);
const policySet = new Set(policies);
const missingPolicy = names.filter(name => !policySet.has(name)).sort();
const policyOnly = policies.filter(name => !activeSet.has(name)).sort();

// Retained as a dormant fail-closed policy entry; there is no memory-backup
// tool module in this branch. If a module is added, it must inherit this policy.
const reviewedPolicyOnly = ['memory_backup'];
const unexpectedPolicyOnly = policyOnly.filter(name => !reviewedPolicyOnly.includes(name));

assert.deepEqual(missingPolicy, [], 'active runtime tools without explicit safety policy');
assert.deepEqual(policyOnly, reviewedPolicyOnly, 'policy-only keys changed; review before updating allowlist');

console.log('MIRA_HFM_TOOL_REGISTRY_POLICY_PARITY=PASS');
console.log('MIRA_HFM_ACTIVE_TOOL_COUNT=' + active.length);
console.log('MIRA_HFM_MISSING_POLICY_COUNT=0');
console.log('MIRA_HFM_POLICY_ONLY_ALLOWLIST=' + reviewedPolicyOnly.join(','));
console.log('MIRA_HFM_UNEXPECTED_POLICY_ONLY_COUNT=' + unexpectedPolicyOnly.length);
console.log('MIRA_HFM_TOOL_REGISTRY_POLICY_TESTS_FAILED=0');
