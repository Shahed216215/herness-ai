'use strict';

const FORMATS = Object.freeze([
  'XLSX',
  'CSV',
  'DOCX',
  'PDF',
  'CODE_PACKAGE',
  'RESEARCH_REPORT',
  'UI'
]);

const STATUSES = Object.freeze([
  'READY',
  'QA_PASSED',
  'PENDING_SUBMISSION',
  'SUBMITTED',
  'ACCEPTED',
  'REVISION_REQUESTED'
]);

const BUILD_STATUSES = Object.freeze([
  'NOT_BUILT',
  'BUILT',
  'FAILED'
]);

function assertString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field}_REQUIRED`);
  }
}

function validateDeliverable(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('DELIVERABLE_OBJECT_REQUIRED');
  }

  assertString(input.id, 'ID');
  assertString(input.workId, 'WORK_ID');
  assertString(input.title, 'TITLE');
  assertString(input.requiredFormat, 'REQUIRED_FORMAT');

  if (!FORMATS.includes(input.requiredFormat)) {
    throw new Error('UNSUPPORTED_FORMAT');
  }

  if (input.status && !STATUSES.includes(input.status)) {
    throw new Error('INVALID_STATUS');
  }

  if (input.buildStatus && !BUILD_STATUSES.includes(input.buildStatus)) {
    throw new Error('INVALID_BUILD_STATUS');
  }

  return true;
}

function createDeliverable(input) {
  validateDeliverable(input);

  const now = new Date().toISOString();

  return {
    id: input.id,
    workId: input.workId,
    title: input.title,
    requiredFormat: input.requiredFormat,
    status: 'READY',
    buildStatus: 'NOT_BUILT',
    packagePath: null,
    verification: {
      passed: false,
      checkedAt: null,
      checks: []
    },
    metadata: input.metadata || {},
    history: [
      {
        status: 'READY',
        at: now
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

module.exports = {
  FORMATS,
  STATUSES,
  BUILD_STATUSES,
  validateDeliverable,
  createDeliverable
};
