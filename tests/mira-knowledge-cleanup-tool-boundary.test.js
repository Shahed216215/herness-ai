'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const knowledgePath = require.resolve('../knowledge');
const drivePath = require.resolve('../google-drive');
const toolPath = require.resolve('../tools/knowledge-cleanup');
const previousKnowledge = require.cache[knowledgePath];
const previousDrive = require.cache[drivePath];
const previousTool = require.cache[toolPath];

let records = [];
let replaceCalls = 0;
let driveCalls = 0;
let driveMode = 'success';
const knowledgeStub = new Module(knowledgePath);
knowledgeStub.filename = knowledgePath;
knowledgeStub.loaded = true;
knowledgeStub.exports = {
  getKnowledge: () => records,
  replaceKnowledge: value => { replaceCalls++; records = value; return value; }
};
const driveStub = new Module(drivePath);
driveStub.filename = drivePath;
driveStub.loaded = true;
driveStub.exports = {
  saveKnowledgeToDrive: async value => {
    driveCalls++;
    if (driveMode === 'throw') throw new Error('INJECTED_PROVIDER_FAILURE');
    if (driveMode === 'false') return { success: false, action: 'provider_rejected' };
    return { success: true, action: 'stubbed', count: value.length };
  }
};
require.cache[knowledgePath] = knowledgeStub;
require.cache[drivePath] = driveStub;
delete require.cache[toolPath];

(async () => {
  try {
    const tool = require('../tools/knowledge-cleanup');
    const a = { id: 'kb-a', title: 'Same', url: 'https://example.test', content: 'same', source: 'manual' };
    const b = { id: 'kb-b', title: 'Same', url: 'https://example.test', content: 'same', source: 'manual' };
    records = [a, b];
    let result = JSON.parse(await tool.execute({ action: 'remove' }));
    assert.equal(result.removed, 0);
    assert.equal(records.length, 2);
    assert.equal(replaceCalls, 0);
    assert.equal(driveCalls, 0);
    console.log('CLEANUP_PRESERVES_DISTINCT_IDS=PASS');

    records = [a, JSON.parse(JSON.stringify(a)), b];
    result = JSON.parse(await tool.execute({ action: 'remove' }));
    assert.equal(result.removed, 1);
    assert.equal(records.length, 2);
    assert.deepEqual(records.map(x => x.id), ['kb-a', 'kb-b']);
    assert.equal(replaceCalls, 1);
    assert.equal(driveCalls, 1);
    console.log('CLEANUP_REMOVES_ONLY_IDENTICAL_COPY=PASS');

    records = [a, { ...a, source: 'web' }];
    result = JSON.parse(await tool.execute({ action: 'inspect' }));
    assert.equal(result.duplicateGroups, 0);
    assert.equal(result.dataModified, false);
    assert.equal(replaceCalls, 1);
    console.log('CLEANUP_INSPECT_IS_READ_ONLY=PASS');

    driveMode = 'false';
    records = [a, JSON.parse(JSON.stringify(a))];
    result = JSON.parse(await tool.execute({ action: 'remove' }));
    assert.equal(result.success, true);
    assert.equal(result.localCommit, true);
    assert.equal(result.driveSync, false);
    assert.equal(result.driveStatus, 'FAILED_OR_UNCONFIRMED');
    assert.equal(records.length, 1);
    assert.match(result.message, /synchronization was not confirmed/i);
    console.log('CLEANUP_REPORTS_PROVIDER_REJECTION_WITH_LOCAL_COMMIT=PASS');

    driveMode = 'throw';
    records = [b, JSON.parse(JSON.stringify(b))];
    result = JSON.parse(await tool.execute({ action: 'remove' }));
    assert.equal(result.success, true);
    assert.equal(result.localCommit, true);
    assert.equal(result.driveSync, false);
    assert.equal(result.driveStatus, 'FAILED_OR_UNCONFIRMED');
    assert.equal(result.driveError, 'INJECTED_PROVIDER_FAILURE');
    assert.equal(records.length, 1);
    console.log('CLEANUP_REPORTS_PROVIDER_EXCEPTION_WITH_LOCAL_COMMIT=PASS');

    console.log('TESTS_FAILED=0');
    console.log('RESULT=MIRA_KNOWLEDGE_CLEANUP_TOOL_BOUNDARY_ISOLATED_PASS');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (previousKnowledge) require.cache[knowledgePath] = previousKnowledge;
    else delete require.cache[knowledgePath];
    if (previousDrive) require.cache[drivePath] = previousDrive;
    else delete require.cache[drivePath];
    if (previousTool) require.cache[toolPath] = previousTool;
    else delete require.cache[toolPath];
  }
})();
