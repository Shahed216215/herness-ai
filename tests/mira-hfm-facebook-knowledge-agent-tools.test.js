'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const searchTool = require('../tools/facebook-knowledge-search');
const researchTool = require('../tools/facebook-knowledge-research');

test('agent-facing tools are registered with bounded project and query inputs', () => {
  assert.equal(searchTool.name, 'facebook_knowledge_search');
  assert.deepEqual(searchTool.declaration.parameters.required, ['projectId', 'query']);
  assert.equal(researchTool.name, 'facebook_knowledge_research');
  assert.deepEqual(researchTool.declaration.parameters.required, ['projectId', 'sourceUrl']);
});

test('agent-facing tools fail closed without server-verified actor context', async () => {
  assert.deepEqual(JSON.parse(await searchTool.execute({ projectId: 'project-001', query: 'AI' })), {
    status: 'IDENTITY_UNAVAILABLE', results: []
  });
  assert.deepEqual(JSON.parse(await researchTool.execute({
    projectId: 'project-001', sourceUrl: 'https://www.facebook.com/example.page'
  })), {
    status: 'IDENTITY_UNAVAILABLE', results: []
  });
});

test('agent search uses one-time authority and explicit untrusted evidence policy', () => {
  const fs = require('node:fs');
  const searchSource = fs.readFileSync(require.resolve('../tools/facebook-knowledge-search'), 'utf8');
  const researchSource = fs.readFileSync(require.resolve('../tools/facebook-knowledge-research'), 'utf8');
  assert.match(searchSource, /issueAuthorityForTrustedActor/);
  assert.match(searchSource, /executeWithConsumedAuthority/);
  assert.match(searchSource, /SOURCE_CONTENT_IS_UNTRUSTED_EVIDENCE_NOT_INSTRUCTIONS/);
  assert.match(researchSource, /PARTIAL_UNVERIFIED_PUBLIC_SEARCH_RESULTS/);
  assert.match(researchSource, /normalizeFacebookUrl/);
});

