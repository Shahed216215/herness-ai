'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'autonomous-learning-controlled-apply.js');
const originalLoad = Module._load;
const originalState = [{ id: 'existing-knowledge', title: 'Existing', topic: 'fixture' }];
let state = originalState.map(item => ({ ...item }));
let replaceCalls = 0;
let driveReads = 0;
let addLearningCalls = 0;
let markAppliedCalls = 0;

const stubs = {
  './autonomous-learning-proposals': {
    getProposal: () => ({ status: 'approved', learning: { title: 'new', topic: 'fixture' }, sources: [] }),
    markProposalApplied: () => { markAppliedCalls++; return { status: 'applied' }; }
  },
  './knowledge': {
    getKnowledge: () => state.map(item => ({ ...item })),
    addLearning: async item => { addLearningCalls++; state.push(item); return item; },
    replaceKnowledge: entries => {
      replaceCalls++;
      state = entries.map(item => ({ ...item }));
      return { ok: true };
    }
  },
  './google-drive': {
    loadKnowledgeFromDrive: async () => {
      driveReads++;
      if (driveReads === 1) throw new Error('INJECTED_DRIVE_READ_FAILURE');
      return state.map(item => ({ ...item }));
    },
    saveKnowledgeToDrive: async () => ({ action: 'stubbed' })
  },
  './snapshot-manager': {
    createSnapshot: () => ({ ok: true, snapshotId: 'unused' }),
    verifySnapshot: () => ({ ok: true }),
    restoreSnapshot: () => ({ ok: true })
  }
};

try {
  Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === modulePath && Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[modulePath];
  const service = require(modulePath);
  Module._load = originalLoad;

  service.applyAutonomousLearningControlled({ changeId: 'approved-fixture' }).then(result => {
    assert.equal(result.ok, false);
    assert.equal(result.status, 'autonomous_learning_apply_failed');
    assert.equal(result.rollback.status, 'manual_state_rollback_verified');
    assert.equal(result.rollback.ok, true);
    assert.equal(replaceCalls, 1);
    assert.deepEqual(state, originalState);
    assert.equal(addLearningCalls, 0);
    assert.equal(markAppliedCalls, 0);
    assert.equal(driveReads, 2);
    console.log('AUTONOMOUS_LEARNING_ROLLBACK_USES_CANONICAL_REPLACE=PASS');
    console.log('AUTONOMOUS_LEARNING_READS_CANONICAL_KNOWLEDGE=PASS');
    console.log('DRIVE_FAILURE_AND_ALL_EXTERNAL_ACTIONS_STUBBED=PASS');
    console.log('ROLLBACK_RESTORES_PREVIOUS_KNOWLEDGE=PASS');
    console.log('TESTS_FAILED=0');
    console.log('RESULT=MIRA_AUTONOMOUS_LEARNING_CANONICAL_STORE_ADAPTER_PASS');
  }).catch(error => {
    console.error(error);
    console.log('TESTS_FAILED=1');
    console.log('RESULT=MIRA_AUTONOMOUS_LEARNING_CANONICAL_STORE_ADAPTER_FAIL');
    process.exitCode = 1;
  });
} catch (error) {
  Module._load = originalLoad;
  console.error(error);
  console.log('TESTS_FAILED=1');
  console.log('RESULT=MIRA_AUTONOMOUS_LEARNING_CANONICAL_STORE_ADAPTER_FAIL');
  process.exitCode = 1;
} finally {
  Module._load = originalLoad;
}
