'use strict';

const crypto = require('crypto');

const {
  recordAudit
} = require('../audit-log');

function normalizeId(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function sanitizeString(value, maxLength = 160) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeCommitments(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => sanitizeString(item, 80))
        .filter(Boolean)
    )
  ];
}

function createAuditResourceId(requestId, suffix) {
  const safeRequestId =
    normalizeId(requestId) ||
    'unknown-request';

  const digest =
    crypto
      .createHash('sha256')
      .update(
        `${safeRequestId}:${suffix}`
      )
      .digest('hex')
      .slice(0, 16);

  return `scope-commitment-${suffix}-${digest}`;
}

function recordScopeCommitmentAudit(input = {}) {
  const requestId =
    normalizeId(input.requestId);

  const decision =
    sanitizeString(input.decision, 80);

  const scopeType =
    sanitizeString(input.scopeType, 80);

  const approvalStatus =
    sanitizeString(input.approvalStatus, 80);

  const commitments =
    normalizeCommitments(
      input.commitmentTypes
    );

  const details = {
    requestId,
    scopeType,
    scopeChanged:
      input.scopeChanged === true,
    commitmentTypes:
      commitments,
    approvalRequired:
      input.approvalRequired === true,
    approvalStatus,
    approvalGranted:
      input.approvalGranted === true,
    approvalValidation:
      input.approvalValidation === true,
    provenanceValidation:
      input.provenanceValidation === true,
    authorityValidation:
      input.authorityValidation === true,
    replayValidation:
      input.replayValidation === true,
    failSafe:
      input.failSafe === true,
    reviewRequired:
      input.reviewRequired === true,
    allowed:
      input.allowed === true,
    blocked:
      input.blocked === true,
    decision
  };

  recordAudit({
    actorRole:
      sanitizeString(
        input.actorRole || 'mira',
        40
      ),
    action:
      'SCOPE_COMMITMENT_DECISION',
    resource:
      'scope_commitment',
    resourceId:
      createAuditResourceId(
        requestId,
        'decision'
      ),
    status:
      input.blocked === true
        ? 'blocked'
        : 'success',
    details
  });

  return Object.freeze({
    recorded: true,
    action:
      'SCOPE_COMMITMENT_DECISION',
    resource:
      'scope_commitment',
    resourceId:
      createAuditResourceId(
        requestId,
        'decision'
      )
  });
}

module.exports = Object.freeze({
  normalizeId,
  sanitizeString,
  normalizeCommitments,
  createAuditResourceId,
  recordScopeCommitmentAudit
});
