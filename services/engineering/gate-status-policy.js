'use strict';

const VALID = new Set([
  'PASS', 'FAIL', 'INCONCLUSIVE', 'REVIEW_REQUIRED'
]);

function classify(result = {}) {
  if (result.assertionFailed === true ||
      result.securityViolation === true) {
    return 'FAIL';
  }

  if (result.timedOut === true ||
      result.skipped === true ||
      result.executionError === true ||
      result.dependencyMissing === true ||
      result.coverageComplete !== true ||
      result.executed !== true ||
      result.evidenceVerified !== true ||
      !Number.isInteger(result.exitCode)) {
    return 'INCONCLUSIVE';
  }

  if (result.exitCode !== 0) return 'FAIL';

  if (result.assertionsPassed !== true) return 'INCONCLUSIVE';

  return 'PASS';
}

function aggregate(gates = [], mandatory = []) {
  // TRUSTED_GATE_REGISTRY_REQUIRED
  // Caller-supplied status fields are not authenticated execution evidence.
  // This deliberately fails closed until a project-owned verifier is wired.
  const list = Array.isArray(gates) ? gates : [];
  const required = Array.isArray(mandatory) ? mandatory : [];
  return Object.freeze({
    status: 'REVIEW_REQUIRED',
    approved: false,
    mayApply: false,
    reason: 'trusted gate registry and evidence verifier are not configured',
    total: list.length,
    mandatory: required.length
  });
}
module.exports = { classify, aggregate };
