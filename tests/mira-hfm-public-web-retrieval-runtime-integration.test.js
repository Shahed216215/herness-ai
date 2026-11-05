'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTool } = require('../tools/mira-hfm-public-web-retrieval');
const { getToolPolicy, checkToolSafety } = require('../services/mira-tool-execution-policy');

(async () => {
  const name = 'mira_hfm_public_web_retrieval';
  const pageId = '118056109579206';
  const memoryId = 'memory-alpha-001';
  const projectId = 'project-mira-v02';
  const archiveCalls = [];

  const registryPath = path.join(__dirname, '..', 'tools', 'index.js');
  const registrySource = fs.readFileSync(registryPath, 'utf8');
  assert.match(registrySource, /readdirSync\(__dirname\)/,
    'runtime registry must auto-discover tool modules');
  assert.match(registrySource, /tool\.name && tool\.declaration && tool\.execute/,
    'Phase 6 tool must satisfy the runtime registration contract');

  const tool = createTool({
    searchWeb: async () => [{
      title: 'Mira ' + pageId + ' ' + memoryId + ' ' + projectId,
      url: 'https://www.facebook.com/' + pageId + '/posts/555001',
      snippet: 'Public indexed evidence for ' + memoryId + ' and ' + projectId
    }],
    archiveEvidence: async input => {
      archiveCalls.push(input);
      return {
        status: 'ARCHIVE_WRITE_VERIFIED',
        storedCount: input.evidence.length,
        duplicateCount: 0,
        canonicalMemoryWrite: false
      };
    }
  });

  assert.equal(tool.name, name);
  assert.equal(tool.declaration.name, name);
  const policy = getToolPolicy(name);
  assert.equal(policy.operation, 'read');
  assert.equal(policy.autonomous, true);
  assert.equal(checkToolSafety(name, {}).passed, true);

  const result = JSON.parse(await tool.execute({
    pageId, memoryId, projectId, importResults: true, maxResults: 1
  }));
  assert.equal(result.status, 'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED');
  assert.equal(result.evidence.length, 1);
  assert.equal(result.archive.status, 'ARCHIVE_WRITE_VERIFIED');
  assert.equal(result.limits.canonicalMemoryWrite, false);
  assert.equal(result.limits.trustPromotion, false);
  assert.equal(archiveCalls.length, 1);
  assert.equal(archiveCalls[0].evidence[0].sourceUrl, result.evidence[0].sourceUrl);

  const serverPath = path.join(__dirname, '..', 'server.js');
  const server = fs.readFileSync(serverPath, 'utf8');
  assert.match(server, /await\s+generate\(\s*cleanCommand\s*,\s*declarations\s*,\s*messages\s*\)/,
    'server generation cycle must expose registered tool declarations to the model');
  assert.match(server, /const functionCalls\s*=\s*Array\.isArray\(\s*response\.functionCalls\s*\)/,
    'server must process model function calls');
  assert.match(server, /for\s*\(\s*const functionCall of\s*functionCalls\s*\)/,
    'server must dispatch returned function calls');
  assert.match(server, /await executeWork\([\s\S]{0,500}?toolCalls:\s*\[/,
    'server function-call dispatch must pass through the governed work execution engine');

  console.log('HFM_PHASE6_RUNTIME_TOOL_AUTO_DISCOVERY_CONTRACT=PASS');
  console.log('HFM_PHASE6_MODEL_DECLARATION_EXPOSURE=PASS');
  console.log('HFM_PHASE6_TOOL_POLICY_READ_ONLY=PASS');
  console.log('HFM_PHASE6_INJECTED_PROVIDER_ARCHIVE_E2E=PASS');
  console.log('HFM_PHASE6_SERVER_GENERATION_CYCLE_STATIC_CONTRACT=PASS');
  console.log('LIVE_FACEBOOK_REQUESTS=0');
  console.log('CANONICAL_MEMORY_WRITES=0');
  console.log('TESTS_FAILED=0');
})().catch(error => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
