'use strict';

const FORMAT_POLICY = Object.freeze({
  CSV: {
    extension: '.csv',
    mediaType: 'text/csv',
    binary: false,
    minimumBytes: 1
  },

  XLSX: {
    extension: '.xlsx',
    mediaType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    binary: true,
    minimumBytes: 100
  },

  DOCX: {
    extension: '.docx',
    mediaType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    binary: true,
    minimumBytes: 100
  },

  PDF: {
    extension: '.pdf',
    mediaType: 'application/pdf',
    binary: true,
    minimumBytes: 20
  },

  CODE_PACKAGE: {
    extension: '.zip',
    mediaType: 'application/zip',
    binary: true,
    minimumBytes: 100
  },

  RESEARCH_REPORT: {
    extension: '.pdf',
    mediaType: 'application/pdf',
    binary: true,
    minimumBytes: 20
  },

  UI: {
    extension: '.html',
    mediaType: 'text/html',
    binary: false,
    minimumBytes: 20
  }
});

function getFormatPolicy(format) {
  const policy = FORMAT_POLICY[format];

  if (!policy) {
    throw new Error(`UNSUPPORTED_FORMAT:${format}`);
  }

  return policy;
}

function validateRequiredFormat(format) {
  return Boolean(getFormatPolicy(format));
}

function detectSignature(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return 'UNKNOWN';
  }

  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 20));

  if (text.startsWith('%PDF-')) {
    return 'PDF';
  }

  if (
    buffer.length >= 2 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  ) {
    return 'ZIP_CONTAINER';
  }

  if (text.includes('<!doctype html') || text.includes('<html')) {
    return 'HTML';
  }

  if (
    text.includes(',') &&
    (text.includes('\n') || text.includes('\r'))
  ) {
    return 'CSV_LIKE';
  }

  return 'TEXT_OR_BINARY';
}

function verifyFormatSignature(format, buffer) {
  const signature = detectSignature(buffer);

  if (format === 'PDF' || format === 'RESEARCH_REPORT') {
    return signature === 'PDF';
  }

  if (
    format === 'XLSX' ||
    format === 'DOCX' ||
    format === 'CODE_PACKAGE'
  ) {
    return signature === 'ZIP_CONTAINER';
  }

  if (format === 'UI') {
    return signature === 'HTML';
  }

  if (format === 'CSV') {
    return signature === 'CSV_LIKE' ||
      signature === 'TEXT_OR_BINARY';
  }

  return false;
}

module.exports = {
  FORMAT_POLICY,
  getFormatPolicy,
  validateRequiredFormat,
  detectSignature,
  verifyFormatSignature
};
