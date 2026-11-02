'use strict';

const crypto = require('crypto');

const builder =
  require('./deliverable-builder');

const schema =
  require('../deliverable-schema');

function normalizeFormat(value) {
  if (!value) return null;

  const normalized =
    String(value)
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

  const aliases = {
    XLS: 'XLSX',
    EXCEL: 'XLSX',
    SPREADSHEET: 'XLSX',
    CSV: 'CSV',
    WORD: 'DOCX',
    DOC: 'DOCX',
    DOCUMENT: 'DOCX',
    PDF: 'PDF',
    ZIP: 'CODE_PACKAGE',
    CODE: 'CODE_PACKAGE',
    CODEBASE: 'CODE_PACKAGE',
    REPORT: 'RESEARCH_REPORT',
    RESEARCH: 'RESEARCH_REPORT',
    HTML: 'UI',
    WEB: 'UI',
    UI: 'UI'
  };

  return aliases[normalized] || normalized;
}

function chooseFormat(work) {
  const candidates = [
    work.requiredFormat,
    work.deliverableFormat,
    work.outputFormat,
    work.format
  ];

  for (const candidate of candidates) {
    const normalized = normalizeFormat(candidate);

    if (normalized && schema.FORMATS.includes(normalized)) {
      return normalized;
    }
  }

  return null;
}

function getTitle(work) {
  return (
    work.deliverableTitle ||
    work.title ||
    work.name ||
    `Deliverable for ${work.id || 'completed-work'}`
  );
}

function getWorkId(work) {
  if (!work || !work.id) {
    throw new Error('COMPLETED_WORK_ID_REQUIRED');
  }

  return String(work.id);
}

function buildId(work) {
  const seed = [
    getWorkId(work),
    chooseFormat(work) || 'UNSPECIFIED',
    getTitle(work)
  ].join('|');

  return `delivery-${crypto
    .createHash('sha256')
    .update(seed)
    .digest('hex')
    .slice(0, 24)}`;
}

function createFromCompletedWork(work) {
  if (!work || typeof work !== 'object') {
    throw new Error('COMPLETED_WORK_REQUIRED');
  }

  const format = chooseFormat(work);

  if (!format) {
    throw new Error(
      'REQUIRED_DELIVERABLE_FORMAT_MISSING'
    );
  }

  const id = buildId(work);

  const existing = builder.get(id);

  if (existing) {
    return {
      created: false,
      duplicate: true,
      deliverable: existing
    };
  }

  const deliverable =
    builder.register({
      id,
      workId: getWorkId(work),
      title: getTitle(work),
      requiredFormat: format,
      metadata: {
        source: 'completed-work',
        completedWorkId: getWorkId(work),
        sourceStatus:
          work.status || work.state || 'COMPLETED'
      }
    });

  return {
    created: true,
    duplicate: false,
    deliverable
  };
}

module.exports = {
  normalizeFormat,
  chooseFormat,
  createFromCompletedWork
};
