'use strict';
const crypto = require('node:crypto');
const { aggregate } = require('./gate-status-policy');

const BLOCKED = new Set([
  '.git', 'node_modules', 'backups', 'reports', 'tmp',
  'secrets', 'credentials'
]);

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) return false;
  if (parts.some(p => BLOCKED.has(p.toLowerCase()))) return false;
  if (parts.some(p => /^\.env/i.test(p))) return false;
  if (parts.some(p => /secret|credential|private.key/i.test(p))) return false;
  if (/\.(pem|key|p12|pfx)$/i.test(value)) return false;
  return true;
}

function createRepairPlan(finding) {
  if (!finding || typeof finding !== 'object') throw new TypeError('finding required');
  if (!safeRelativePath(finding.file)) throw new Error('unsafe finding file path');
  const tests = finding.testPaths === undefined ? [] : finding.testPaths;
  if (!Array.isArray(tests) || !tests.every(safeRelativePath)) {
    throw new Error('unsafe test path');
  }
  if (finding.proposedChange !== undefined &&
      typeof finding.proposedChange !== 'string') {
    throw new TypeError('proposedChange must be a string');
  }
  const proposedChange = finding.proposedChange || '';
  const proposedChangeHash = crypto.createHash('sha256')
    .update(proposedChange, 'utf8').digest('hex');
  const evidence = {
    findingId: String(finding.id || 'unassigned'),
    file: finding.file,
    title: String(finding.title || 'Unspecified finding'),
    testPaths: [...tests].sort(),
    proposedChangeHash
  };
  const planId = crypto.createHash('sha256')
    .update(JSON.stringify(evidence)).digest('hex');
  return Object.freeze({
    planId, evidence, status: 'PROPOSAL_ONLY', mode: 'PREVIEW_ONLY',
    approvalRequired: true,
    allowedActions: ['inspect', 'prepare_patch', 'run_tests', 'report'],
    blockedActions: ['apply_patch', 'commit', 'deploy', 'network',
      'credential_access', 'financial_action', 'irreversible_action'],
    mayApply: false
  });
}

function verifyApproval(plan, approval) {
  const valid = !!plan && !!approval &&
    approval.planId === plan.planId &&
    approval.approved === true &&
    approval.policySource === 'system_policy' &&
    typeof approval.approvalId === 'string' &&
    approval.approvalId.trim().length > 0;
  return {
    status: valid ? 'APPROVAL_VERIFIED' : 'APPROVAL_REJECTED',
    mayApply: false
  };
}

function evaluateGates(gates, mandatory) {
  return aggregate(gates, mandatory);
}

module.exports = { safeRelativePath, createRepairPlan, verifyApproval, evaluateGates };
