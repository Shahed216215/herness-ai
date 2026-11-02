'use strict';

const builder =
  require('./deliverable-builder');

const bridge =
  require('./completed-work-deliverable-bridge');

const manifest =
  require('./deliverable-package-manifest');

function prepareFromCompletedWork(work) {
  return bridge.createFromCompletedWork(work);
}

function buildAndVerify(id) {
  const built = builder.build(id);

  const verified = builder.verify(id);

  if (
    verified.status !== 'QA_PASSED' ||
    !verified.verification ||
    !verified.verification.passed
  ) {
    throw new Error('DELIVERABLE_QA_FAILED');
  }

  const manifestRecord =
    manifest.writeManifest(verified);

  return {
    deliverable: verified,
    manifest: manifestRecord
  };
}

function prepareSubmission(id) {
  const item = builder.get(id);

  if (!item) {
    throw new Error('DELIVERABLE_NOT_FOUND');
  }

  if (item.status !== 'QA_PASSED') {
    throw new Error('SUBMISSION_REQUIRES_QA_PASSED');
  }

  const currentManifest =
    manifest.writeManifest(item);

  if (
    !manifest.verifyManifest(
      item,
      currentManifest
    )
  ) {
    throw new Error('PACKAGE_MANIFEST_VERIFICATION_FAILED');
  }

  const pending =
    builder.markPendingSubmission(id);

  return {
    deliverable: pending,
    manifest: currentManifest
  };
}

function submit(id) {
  const item = builder.get(id);

  if (!item) {
    throw new Error('DELIVERABLE_NOT_FOUND');
  }

  if (item.status !== 'PENDING_SUBMISSION') {
    throw new Error(
      'SUBMISSION_REQUIRES_PENDING_SUBMISSION'
    );
  }

  return builder.markSubmitted(id);
}

function accept(id) {
  return builder.markAccepted(id);
}

function requestRevision(id) {
  return builder.markRevisionRequested(id);
}

module.exports = {
  prepareFromCompletedWork,
  buildAndVerify,
  prepareSubmission,
  submit,
  accept,
  requestRevision
};
