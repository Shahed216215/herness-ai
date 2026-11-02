'use strict';

const {
  COMMITMENT_TYPES,
  APPROVAL_STATUSES,
  DECISIONS
} = require('../scope-commitment-schema');

const PATTERNS = Object.freeze({
  [COMMITMENT_TYPES.CONTRACT_ACCEPTANCE]: [
    /\baccept\b.*\bcontract\b/i,
    /\bapprove\b.*\bcontract\b/i,
    /\bsign\b.*\bcontract\b/i,
    /\bconfirm\b.*\bcontract\b/i,
    /\bagree\b.*\bcontract\b/i
  ],

  [COMMITMENT_TYPES.PRICE_COMMITMENT]: [
    /\bquote\b.*\bprice\b/i,
    /\bcommit\b.*\bprice\b/i,
    /\bpromise\b.*\bprice\b/i,
    /\bconfirm\b.*\bprice\b/i,
    /\bapprove\b.*\bprice\b/i,
    /\baccept\b.*\bprice\b/i,
    /\bagree\b.*\bprice\b/i,
    /\bfor\s+\$?\d+/i,
    /\bcharge\b.*\$\d+/i,
    /\bdo\s+it\s+for\b.*\$\d+/i,
    /\bclient\b.*\bwill\s+pay\b/i
  ],

  [COMMITMENT_TYPES.LEGAL_COMMITMENT]: [
    /\blegal\b.*\bcommit/i,
    /\baccept\b.*\blegal\b/i,
    /\bagree\b.*\blegal\b/i,
    /\baccept\b.*\bterms\b/i,
    /\blegally\b.*\bagree/i,
    /\bwaive\b.*\bright/i
  ],

  [COMMITMENT_TYPES.IRREVERSIBLE_CLIENT_ACTION]: [
    /\bdelete\b.*\bclient\b/i,
    /\bpermanently\b.*\bdelete\b/i,
    /\bcancel\b.*\baccount\b/i,
    /\bclose\b.*\baccount\b/i,
    /\bremove\b.*\bpermanently\b/i,
    /\bsend\b.*\bfinal\b.*\bwithout\b.*\bapproval/i
  ]
});

function normalizeRequest(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function detectCommitments(request) {
  const text = normalizeRequest(request);
  const detected = [];

  if (!text) {
    return [COMMITMENT_TYPES.NONE];
  }

  for (const [type, patterns] of Object.entries(PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(text))) {
      detected.push(type);
    }
  }

  if (detected.length === 0) {
    detected.push(COMMITMENT_TYPES.NONE);
  }

  return detected;
}

function evaluateCommitmentBoundary(request) {
  const commitmentTypes = detectCommitments(request);

  const protectedCommitments = commitmentTypes.filter(
    (type) => type !== COMMITMENT_TYPES.NONE
  );

  if (protectedCommitments.length > 0) {
    return {
      request: normalizeRequest(request),
      commitmentTypes,
      approvalRequired: true,
      approvalStatus: APPROVAL_STATUSES.REQUIRED,
      decision: DECISIONS.REQUIRE_APPROVAL,
      reasons: [
        'Client request contains a protected commitment',
        'Human approval is required before commitment'
      ]
    };
  }

  return {
    request: normalizeRequest(request),
    commitmentTypes: [COMMITMENT_TYPES.NONE],
    approvalRequired: false,
    approvalStatus: APPROVAL_STATUSES.NOT_REQUIRED,
    decision: DECISIONS.CONTINUE,
    reasons: [
      'No protected commitment detected'
    ]
  };
}

module.exports = Object.freeze({
  PATTERNS,
  normalizeRequest,
  detectCommitments,
  evaluateCommitmentBoundary
});
