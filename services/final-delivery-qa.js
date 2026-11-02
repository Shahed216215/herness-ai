'use strict';

const crypto = require('crypto');
const fs = require('fs');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .trim();
}

function fileIntegrity(filePath, expectedSha256) {
  const result = {
    passed: false,
    filePath: filePath || null,
    exists: false,
    size: 0,
    sha256: null,
    expectedSha256: expectedSha256 || null
  };

  if (!filePath || !fs.existsSync(filePath)) {
    return result;
  }

  const stat = fs.statSync(filePath);

  if (!stat.isFile()) {
    return result;
  }

  result.exists = true;
  result.size = stat.size;
  result.sha256 = sha256File(filePath);

  result.passed =
    !expectedSha256 ||
    result.sha256 === expectedSha256;

  return result;
}

function requirementMatch(deliverable, requirements = []) {
  const metadataRequirements =
    deliverable &&
    deliverable.metadata &&
    Array.isArray(deliverable.metadata.requirements)
      ? deliverable.metadata.requirements
      : [];

  const text = normalizeText([
    deliverable && deliverable.title,
    deliverable && deliverable.name,
    deliverable && deliverable.description,
    deliverable && deliverable.content,
    deliverable && deliverable.summary,
    ...metadataRequirements
  ].join('\n')).toLowerCase();

  const checks = requirements.map(requirement => {
    const needle = normalizeText(requirement).toLowerCase();

    return {
      requirement,
      passed: Boolean(needle && text.includes(needle))
    };
  });

  return {
    passed: checks.every(check => check.passed),
    checks
  };
}

function qualityCheck(deliverable) {
  const problems = [];

  if (!deliverable) {
    problems.push('DELIVERABLE_MISSING');
  } else {
    const content = normalizeText(deliverable.content);

    if (!content) {
      problems.push('CONTENT_EMPTY');
    }

    if (
      deliverable.status &&
      ![
        'draft',
        'ready',
        'approved',
        'final',
        'completed',
        'qa_passed'
      ].includes(String(deliverable.status).toLowerCase())
    ) {
      problems.push('INVALID_DELIVERABLE_STATUS');
    }
  }

  return {
    passed: problems.length === 0,
    problems
  };
}

function securityCheck(deliverable) {
  const serialized = JSON.stringify(deliverable || {});
  const problems = [];

  const patterns = [
    /\.\.\//,
    /\.\.\\/,
    /\b(?:rm|rmdir|del|format)\s+-rf\b/i,
    /\beval\s*\(/i,
    /\bchild_process\b/i,
    /\bexec\s*\(/i,
    /\bspawn\s*\(/i
  ];

  for (const pattern of patterns) {
    if (pattern.test(serialized)) {
      problems.push(`DANGEROUS_PATTERN:${pattern}`);
    }
  }

  return {
    passed: problems.length === 0,
    problems
  };
}

function finalVerification(result) {
  const sections = [
    result.fileIntegrity,
    result.requirementMatch,
    result.quality,
    result.security
  ];

  return {
    passed:
      sections.length > 0 &&
      sections.every(
        section => section && section.passed === true
      ),
    timestamp: new Date().toISOString()
  };
}

function runQA(options = {}) {
  const deliverable = options.deliverable || null;

  const result = {
    version: '10.2',
    stage: 'FINAL_DELIVERY_QA',
    deliverableId:
      deliverable && deliverable.id
        ? deliverable.id
        : null,

    fileIntegrity: fileIntegrity(
      options.filePath,
      options.expectedSha256
    ),

    requirementMatch: requirementMatch(
      deliverable,
      options.requirements || []
    ),

    quality: qualityCheck(deliverable),

    security: securityCheck(deliverable)
  };

  result.finalVerification =
    finalVerification(result);

  return result;
}

module.exports = {
  sha256File,
  fileIntegrity,
  requirementMatch,
  qualityCheck,
  securityCheck,
  finalVerification,
  runQA
};
