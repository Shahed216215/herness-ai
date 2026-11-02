'use strict';

const { buildRealFormat, verifyRealFormat } = require('./deliverable-real-format-builder');

const fs = require('fs');
const path = require('path');
const storagePath = require('../mira-storage');
const crypto = require('crypto');

const schema = require('../deliverable-schema');
const store = require('../deliverable-store');

const DELIVERY_ROOT = storagePath('deliveries');

function safeName(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'deliverable';
}

function ensureSafeDeliveryDirectory(workId) {
  if (fs.existsSync(DELIVERY_ROOT) &&
      fs.lstatSync(DELIVERY_ROOT).isSymbolicLink()) {
    throw new Error('DELIVERY_ROOT_SYMLINK_BLOCKED');
  }

  fs.mkdirSync(DELIVERY_ROOT, { recursive: true });
  const rootReal = fs.realpathSync(DELIVERY_ROOT);
  const dir = path.join(DELIVERY_ROOT, safeName(workId));

  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error('DELIVERY_WORK_DIRECTORY_SYMLINK_BLOCKED');
  }

  fs.mkdirSync(dir, { recursive: true });
  const dirReal = fs.realpathSync(dir);
  if (!dirReal.startsWith(rootReal + path.sep)) {
    throw new Error('DELIVERY_DIRECTORY_ESCAPE_BLOCKED');
  }
  return dir;
}

function assertSafeArtifactPath(filePath, requireExists = true) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('PACKAGE_PATH_REQUIRED');
  }
  if (!fs.existsSync(DELIVERY_ROOT) ||
      fs.lstatSync(DELIVERY_ROOT).isSymbolicLink()) {
    throw new Error('DELIVERY_ROOT_INVALID');
  }

  const rootReal = fs.realpathSync(DELIVERY_ROOT);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(DELIVERY_ROOT) + path.sep)) {
    throw new Error('PACKAGE_PATH_OUTSIDE_DELIVERY_ROOT');
  }

  const parent = path.dirname(resolved);
  const parentReal = fs.realpathSync(parent);
  if (!parentReal.startsWith(rootReal + path.sep)) {
    throw new Error('PACKAGE_PARENT_ESCAPE_BLOCKED');
  }

  if (!fs.existsSync(resolved)) {
    if (requireExists) throw new Error('PACKAGE_FILE_NOT_FOUND');
    return resolved;
  }

  if (fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error('PACKAGE_SYMLINK_BLOCKED');
  }
  const fileReal = fs.realpathSync(resolved);
  if (!fileReal.startsWith(rootReal + path.sep)) {
    throw new Error('PACKAGE_PATH_ESCAPE_BLOCKED');
  }
  if (!fs.statSync(fileReal).isFile()) {
    throw new Error('PACKAGE_NOT_REGULAR_FILE');
  }
  return resolved;
}

function extension(format) {
  return {
    XLSX: '.xlsx',
    CSV: '.csv',
    DOCX: '.docx',
    PDF: '.pdf',
    CODE_PACKAGE: '.zip',
    RESEARCH_REPORT: '.pdf',
    UI: '.html'
  }[format];
}

function buildContent(delivery) {
  const requirements =
    delivery &&
    delivery.metadata &&
    Array.isArray(delivery.metadata.requirements)
      ? delivery.metadata.requirements
          .map(item => String(item).trim())
          .filter(Boolean)
      : [];

  const feedback =
    delivery &&
    delivery.metadata &&
    delivery.metadata.revisionFeedback
      ? String(delivery.metadata.revisionFeedback)
      : '';

  const requirementText =
    requirements.length
      ? '\nREQUIREMENTS:\n' +
        requirements
          .map((item, index) => `${index + 1}. ${item}`)
          .join('\n') +
        '\n'
      : '';

  const revisionText =
    feedback
      ? `\nREVISION_FEEDBACK: ${feedback}\n`
      : '';

  const header = [
    'MIRA DELIVERABLE',
    `ID: ${delivery.id}`,
    `WORK: ${delivery.workId}`,
    `TITLE: ${delivery.title}`,
    `FORMAT: ${delivery.requiredFormat}`,
    `BUILT_AT: ${new Date().toISOString()}`,
    requirementText.trim(),
    revisionText.trim(),
    ''
  ]
    .filter(Boolean)
    .join('\n');

  switch (delivery.requiredFormat) {
    case 'CSV': {
      const rows = [
        'field,value',
        `id,${JSON.stringify(delivery.id)}`,
        `workId,${JSON.stringify(delivery.workId)}`,
        `title,${JSON.stringify(delivery.title)}`
      ];

      requirements.forEach((item, index) => {
        rows.push(
          `requirement_${index + 1},${JSON.stringify(item)}`
        );
      });

      if (feedback) {
        rows.push(
          `revisionFeedback,${JSON.stringify(feedback)}`
        );
      }

      return Buffer.from(rows.join('\n') + '\n');
    }

    case 'UI':
      return Buffer.from(
        '<!doctype html><html><head><meta charset="utf-8">' +
        `<title>${safeName(delivery.title)}</title></head><body>` +
        `<h1>${delivery.title}</h1>` +
        `<p>Deliverable ID: ${delivery.id}</p>` +
        `<p>Work ID: ${delivery.workId}</p>` +
        (
          requirements.length
            ? '<h2>Requirements</h2><ul>' +
              requirements
                .map(
                  item =>
                    `<li>${String(item)
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')}</li>`
                )
                .join('') +
              '</ul>'
            : ''
        ) +
        (
          feedback
            ? `<p>Revision feedback: ${feedback
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')}</p>`
            : ''
        ) +
        '</body></html>'
      );

    default:
      return Buffer.from(
        header +
        'Mira generated deliverable package.\n'
      );
  }
}
function register(input) {
  const delivery = schema.createDeliverable(input);
  return store.create(delivery);
}

function build(id) {
  const current = store.get(id);

  if (!current) {
    throw new Error('DELIVERABLE_NOT_FOUND');
  }

  if (current.status !== 'READY') {
    throw new Error('BUILD_REQUIRES_READY_STATUS');
  }

  const dir = ensureSafeDeliveryDirectory(current.workId);

  const filename =
    `${safeName(current.id)}-${safeName(current.title)}` +
    extension(current.requiredFormat);

  const target = path.join(dir, filename);
  assertSafeArtifactPath(target, false);
  const content = buildContent(current);

  // O_NOFOLLOW prevents a final-component symlink from being followed
  // on platforms that support it (including Android/Linux).
  const flags = fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(target, flags, 0o600);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }

  const digest = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');

  return store.update(id, next => {
    const now = new Date().toISOString();

    next.buildStatus = 'BUILT';
    next.packagePath = target;

    /*
     * Keep a QA-readable textual representation on the deliverable
     * record while the actual artifact remains at packagePath.
     * Binary formats must not be stored as raw Buffer data here.
     */
    const requirements =
      next.metadata &&
      Array.isArray(next.metadata.requirements)
        ? next.metadata.requirements
            .map(item => String(item).trim())
            .filter(Boolean)
        : [];

    const revisionFeedback =
      next.metadata &&
      next.metadata.revisionFeedback
        ? String(next.metadata.revisionFeedback).trim()
        : '';

    next.content = [
      `MIRA DELIVERABLE: ${next.title || next.id}`,
      `DELIVERABLE_ID: ${next.id}`,
      `WORK_ID: ${next.workId || ''}`,
      `FORMAT: ${next.requiredFormat || next.type || ''}`,
      requirements.length
        ? 'REQUIREMENTS:\n' +
          requirements
            .map((item, index) => `${index + 1}. ${item}`)
            .join('\n')
        : '',
      revisionFeedback
        ? `REVISION_FEEDBACK: ${revisionFeedback}`
        : '',
      'ARTIFACT_BUILT: true'
    ]
      .filter(Boolean)
      .join('\n');

    next.metadata.sha256 = digest;
    next.metadata.size = content.length;
    next.updatedAt = now;

    return next;
  });
}

function verify(id) {
  const current = store.get(id);

  if (!current) {
    throw new Error('DELIVERABLE_NOT_FOUND');
  }

  if (current.buildStatus !== 'BUILT') {
    throw new Error('VERIFY_REQUIRES_BUILT_DELIVERABLE');
  }

  // Refuse to hash/read an artifact outside the managed delivery tree.
  assertSafeArtifactPath(current.packagePath);

  const checks = [];

  checks.push({
    name: 'FILE_EXISTS',
    passed: Boolean(
      current.packagePath &&
      fs.existsSync(current.packagePath)
    )
  });

  let actualHash = null;

  if (checks[0].passed) {
    actualHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(current.packagePath))
      .digest('hex');
  }

  checks.push({
    name: 'SHA256_INTEGRITY',
    passed: Boolean(
      actualHash &&
      actualHash === current.metadata.sha256
    )
  });

  checks.push({
    name: 'NON_EMPTY',
    passed: Boolean(
      current.packagePath &&
      fs.existsSync(current.packagePath) &&
      fs.statSync(current.packagePath).size > 0
    )
  });

  const passed = checks.every(x => x.passed);
  const now = new Date().toISOString();

  return store.update(id, next => {
    next.verification = {
      passed,
      checkedAt: now,
      checks
    };

    if (passed) {
      next.status = 'QA_PASSED';
      next.history.push({
        status: 'QA_PASSED',
        at: now
      });
    }

    next.updatedAt = now;
    return next;
  });
}

function markPendingSubmission(id) {
  return transition(id, 'PENDING_SUBMISSION');
}

function markSubmitted(id) {
  return transition(id, 'SUBMITTED');
}

function markAccepted(id) {
  return transition(id, 'ACCEPTED');
}

function markRevisionRequested(id) {
  return transition(id, 'REVISION_REQUESTED');
}

function transition(id, target) {
  const current = store.get(id);

  if (!current) {
    throw new Error('DELIVERABLE_NOT_FOUND');
  }

  const allowed = {
    QA_PASSED: ['PENDING_SUBMISSION'],
    PENDING_SUBMISSION: ['SUBMITTED'],
    SUBMITTED: ['ACCEPTED', 'REVISION_REQUESTED'],
    REVISION_REQUESTED: ['READY'],
    ACCEPTED: []
  };

  if (!(allowed[current.status] || []).includes(target)) {
    throw new Error(
      `INVALID_DELIVERY_TRANSITION:${current.status}->${target}`
    );
  }

  const now = new Date().toISOString();

  return store.update(id, next => {
    next.status = target;
    next.history.push({
      status: target,
      at: now
    });
    next.updatedAt = now;
    return next;
  });
}

function listByStatus(status) {
  if (!schema.STATUSES.includes(status)) {
    throw new Error('INVALID_STATUS');
  }

  return store
    .list()
    .filter(x => x.status === status);
}

module.exports = {
  register,
  build,
  verify,
  markPendingSubmission,
  markSubmitted,
  markAccepted,
  markRevisionRequested,
  listByStatus,
  get: store.get,
  list: store.list,
  history: store.history
};


async function buildRealDeliverableFormat(options) {
  const outputPath = await buildRealFormat(options);

  if (!verifyRealFormat(outputPath, options.format)) {
    throw new Error(
      `REAL_FORMAT_SIGNATURE_INVALID:${String(options.format).toUpperCase()}`
    );
  }

  return {
    outputPath,
    verified: true,
    format: String(options.format).toUpperCase()
  };
}

module.exports.buildRealDeliverableFormat = buildRealDeliverableFormat;
