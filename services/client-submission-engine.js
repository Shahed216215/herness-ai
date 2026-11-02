'use strict';

const fs = require('fs');
const crypto = require('crypto');

const deliverableStore =
  require('../deliverable-store');

const manifest =
  require('./deliverable-package-manifest');

const submissionStore =
  require('../submission-store');

const STATES = Object.freeze([
  'PREPARED',
  'SUBMITTED',
  'REJECTED',
  'FAILED'
]);

function clean(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function requireString(value, field) {
  const result = clean(value);

  if (!result) {
    throw new Error(`${field}_REQUIRED`);
  }

  return result;
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function stableHash(input) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(input)
    )
    .digest('hex');
}

function getMetadataValue(delivery, key) {
  if (
    delivery &&
    delivery.metadata &&
    typeof delivery.metadata === 'object'
  ) {
    return clean(
      delivery.metadata[key]
    );
  }

  return '';
}

function resolveTaskId(delivery) {
  return (
    getMetadataValue(delivery, 'taskId') ||
    getMetadataValue(delivery, 'taskID') ||
    clean(delivery.taskId) ||
    clean(delivery.workId)
  );
}

function resolveClientId(delivery) {
  return (
    getMetadataValue(delivery, 'clientId') ||
    getMetadataValue(delivery, 'clientID') ||
    clean(delivery.clientId)
  );
}

function validateInput(input) {
  if (
    !input ||
    typeof input !== 'object'
  ) {
    throw new Error(
      'SUBMISSION_REQUEST_REQUIRED'
    );
  }

  requireString(
    input.deliverableId,
    'DELIVERABLE_ID'
  );

  requireString(
    input.clientId,
    'CLIENT_ID'
  );

  requireString(
    input.taskId,
    'TASK_ID'
  );

  if (
    input.idempotencyKey !== undefined
  ) {
    requireString(
      input.idempotencyKey,
      'IDEMPOTENCY_KEY'
    );
  }

  return true;
}

function getVerifiedDeliverable(
  deliverableId
) {
  const delivery =
    deliverableStore.get(
      deliverableId
    );

  if (!delivery) {
    throw new Error(
      'DELIVERABLE_NOT_FOUND'
    );
  }

  if (
    delivery.status !==
    'QA_PASSED'
  ) {
    throw new Error(
      'SUBMISSION_REQUIRES_VERIFIED_DELIVERABLE'
    );
  }

  if (
    !delivery.verification ||
    delivery.verification.passed !== true
  ) {
    throw new Error(
      'DELIVERABLE_VERIFICATION_REQUIRED'
    );
  }

  if (
    !delivery.packagePath
  ) {
    throw new Error(
      'SUBMISSION_PACKAGE_PATH_REQUIRED'
    );
  }

  if (
    !fs.existsSync(
      delivery.packagePath
    )
  ) {
    throw new Error(
      'SUBMISSION_PACKAGE_FILE_NOT_FOUND'
    );
  }

  return delivery;
}

function validateClientTaskMatch(
  delivery,
  clientId,
  taskId
) {
  const expectedClient =
    resolveClientId(delivery);

  const expectedTask =
    resolveTaskId(delivery);

  /*
   * Client/task identity must be explicitly
   * available on the deliverable for strict
   * submission matching.
   */
  if (!expectedClient) {
    throw new Error(
      'DELIVERABLE_CLIENT_ID_MISSING'
    );
  }

  if (!expectedTask) {
    throw new Error(
      'DELIVERABLE_TASK_ID_MISSING'
    );
  }

  if (
    expectedClient !== clientId
  ) {
    throw new Error(
      'CLIENT_TASK_MISMATCH'
    );
  }

  if (
    expectedTask !== taskId
  ) {
    throw new Error(
      'CLIENT_TASK_MISMATCH'
    );
  }

  return true;
}

function buildSubmissionPackage(
  delivery,
  clientId,
  taskId
) {
  const currentManifest =
    manifest.writeManifest(
      delivery
    );

  if (
    !manifest.verifyManifest(
      delivery,
      currentManifest
    )
  ) {
    throw new Error(
      'PACKAGE_MANIFEST_VERIFICATION_FAILED'
    );
  }

  const packageHash =
    sha256File(
      delivery.packagePath
    );

  return {
    schema:
      'mira-client-submission-package-v1',

    deliverableId:
      delivery.id,

    workId:
      delivery.workId,

    clientId,

    taskId,

    title:
      delivery.title,

    requiredFormat:
      delivery.requiredFormat,

    packagePath:
      delivery.packagePath,

    packageHash,

    packageSize:
      currentManifest.file.size,

    manifest:
      currentManifest
  };
}

function fingerprintPackage(
  packageRecord
) {
  return stableHash({
    schema:
      packageRecord.schema,

    clientId:
      packageRecord.clientId,

    taskId:
      packageRecord.taskId,

    deliverableId:
      packageRecord.deliverableId,

    packageHash:
      packageRecord.packageHash,

    requiredFormat:
      packageRecord.requiredFormat
  });
}

function createAudit(
  submission,
  event,
  extra = {}
) {
  const record = {
    event,
    submissionId:
      submission.id,
    clientId:
      submission.clientId,
    taskId:
      submission.taskId,
    deliverableId:
      submission.deliverableId,
    status:
      submission.status,
    at:
      new Date().toISOString(),
    ...extra
  };

  return record;
}

function controlledSubmitAdapter(
  packageRecord,
  submission
) {
  /*
   * Stage 10.3 deliberately uses a controlled
   * local adapter. No uncontrolled external
   * client/network send occurs here.
   *
   * An approved external adapter can be injected
   * through submit(..., { adapter }).
   */
  return {
    accepted: true,
    channel: 'CONTROLLED_LOCAL_ADAPTER',
    externalSend: false,
    reference:
      `local-${submission.id}`,
    packageHash:
      packageRecord.packageHash
  };
}

function prepareSubmission(input) {
  validateInput(input);

  const clientId =
    requireString(
      input.clientId,
      'CLIENT_ID'
    );

  const taskId =
    requireString(
      input.taskId,
      'TASK_ID'
    );

  const deliverable =
    getVerifiedDeliverable(
      input.deliverableId
    );

  validateClientTaskMatch(
    deliverable,
    clientId,
    taskId
  );

  const packageRecord =
    buildSubmissionPackage(
      deliverable,
      clientId,
      taskId
    );

  const fingerprint =
    fingerprintPackage(
      packageRecord
    );

  const idempotencyKey =
    clean(input.idempotencyKey) ||
    fingerprint;

  const existingByKey =
    submissionStore
      .getByIdempotencyKey(
        idempotencyKey
      );

  if (existingByKey) {
    return {
      duplicate: true,
      existing: existingByKey,
      receipt:
        existingByKey.receipt ||
        null
    };
  }

  const existingByFingerprint =
    submissionStore
      .getBySubmissionFingerprint(
        fingerprint
      );

  if (existingByFingerprint) {
    return {
      duplicate: true,
      existing:
        existingByFingerprint,
      receipt:
        existingByFingerprint.receipt ||
        null
    };
  }

  const now =
    new Date().toISOString();

  const id =
    `submission-${crypto.randomUUID()}`;

  const submission = {
    id,

    schema:
      'mira-client-submission-v1',

    status:
      'PREPARED',

    clientId,

    taskId,

    deliverableId:
      deliverable.id,

    workId:
      deliverable.workId,

    idempotencyKey,

    fingerprint,

    package: packageRecord,

    receipt: null,

    failure: null,

    history: [
      {
        status:
          'PREPARED',
        event:
          'SUBMISSION_PREPARED',
        at: now
      }
    ],

    audit: [
      createAudit(
        {
          id,
          clientId,
          taskId,
          deliverableId:
            deliverable.id,
          status:
            'PREPARED'
        },
        'SUBMISSION_PREPARED'
      )
    ],

    createdAt: now,
    updatedAt: now
  };

  submissionStore.create(
    submission
  );

  return {
    duplicate: false,
    submission,
    package: packageRecord
  };
}

function submit(
  input,
  options = {}
) {
  const prepared =
    prepareSubmission(
      input
    );

  if (prepared.duplicate) {
    return {
      duplicate: true,
      status:
        'ALREADY_SUBMITTED',
      submission:
        prepared.existing,
      receipt:
        prepared.receipt
    };
  }

  const submission =
    prepared.submission;

  const adapter =
    typeof options.adapter === 'function'
      ? options.adapter
      : controlledSubmitAdapter;

  try {
    const result =
      adapter(
        prepared.package,
        submission
      );

    if (
      !result ||
      result.accepted !== true
    ) {
      throw new Error(
        'SUBMISSION_ADAPTER_REJECTED'
      );
    }

    const now =
      new Date().toISOString();

    const receipt = {
      schema:
        'mira-submission-receipt-v1',

      receiptId:
        `receipt-${crypto.randomUUID()}`,

      submissionId:
        submission.id,

      clientId:
        submission.clientId,

      taskId:
        submission.taskId,

      deliverableId:
        submission.deliverableId,

      packageHash:
        prepared.package.packageHash,

      channel:
        result.channel ||
        'CONTROLLED_LOCAL_ADAPTER',

      externalReference:
        result.reference ||
        null,

      externalSend:
        result.externalSend === true,

      status:
        'SUBMITTED',

      submittedAt:
        now
    };

    const updated =
      submissionStore.update(
        submission.id,
        current => {
          current.status =
            'SUBMITTED';

          current.receipt =
            receipt;

          current.failure =
            null;

          current.history =
            Array.isArray(
              current.history
            )
              ? current.history
              : [];

          current.history.push({
            status:
              'SUBMITTED',
            event:
              'SUBMISSION_COMPLETED',
            at: now
          });

          current.audit =
            Array.isArray(
              current.audit
            )
              ? current.audit
              : [];

          current.audit.push(
            createAudit(
              current,
              'SUBMISSION_COMPLETED',
              {
                receiptId:
                  receipt.receiptId
              }
            )
          );

          current.updatedAt =
            now;

          return current;
        }
      );

    return {
      duplicate: false,
      status:
        'SUBMITTED',
      submission:
        updated,
      receipt
    };
  } catch (error) {
    const now =
      new Date().toISOString();

    const updated =
      submissionStore.update(
        submission.id,
        current => {
          current.status =
            'FAILED';

          current.failure = {
            code:
              error.message,
            at:
              now
          };

          current.history =
            Array.isArray(
              current.history
            )
              ? current.history
              : [];

          current.history.push({
            status:
              'FAILED',
            event:
              'SUBMISSION_FAILED',
            at:
              now
          });

          current.audit =
            Array.isArray(
              current.audit
            )
              ? current.audit
              : [];

          current.audit.push(
            createAudit(
              current,
              'SUBMISSION_FAILED',
              {
                error:
                  error.message
              }
            )
          );

          current.updatedAt =
            now;

          return current;
        }
      );

    const failure =
      new Error(
        `SUBMISSION_FAILED:${error.message}`
      );

    failure.submission =
      updated;

    throw failure;
  }
}

function getSubmission(id) {
  return submissionStore.get(id);
}

function getReceipt(id) {
  const item =
    submissionStore.get(id);

  if (!item) {
    throw new Error(
      'SUBMISSION_NOT_FOUND'
    );
  }

  return item.receipt || null;
}

function listSubmissions() {
  return submissionStore.list();
}

module.exports = {
  STATES,
  validateInput,
  getVerifiedDeliverable,
  validateClientTaskMatch,
  buildSubmissionPackage,
  fingerprintPackage,
  prepareSubmission,
  submit,
  getSubmission,
  getReceipt,
  listSubmissions,
  controlledSubmitAdapter
};
