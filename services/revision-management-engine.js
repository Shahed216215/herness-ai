'use strict';

const crypto = require('crypto');

const deliverableStore =
  require('../deliverable-store');

const revisionStore =
  require('../revision-store');

const deliverableRevision =
  require('./deliverable-revision-service');

const deliverableBuilder =
  require('./deliverable-builder');

const finalDeliveryQA =
  require('./final-delivery-qa');

const submissionEngine =
  require('./client-submission-engine');

function clean(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function requireString(value, code) {
  const result = clean(value);

  if (!result) {
    throw new Error(code);
  }

  return result;
}

function asList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => clean(String(item)))
    .filter(Boolean);
}

function unique(list) {
  return [...new Set(list)];
}

function stableHash(value) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        value,
        Object.keys(value || {}).sort()
      )
    )
    .digest('hex');
}

function normalizeRequirements(value) {
  return unique(
    asList(value)
      .map(item => item.toLowerCase())
  );
}

function computeRequirementDelta(
  oldRequirements,
  newRequirements
) {
  const oldList =
    normalizeRequirements(
      oldRequirements
    );

  const newList =
    normalizeRequirements(
      newRequirements
    );

  return {
    added:
      newList.filter(
        item => !oldList.includes(item)
      ),

    removed:
      oldList.filter(
        item => !newList.includes(item)
      ),

    unchanged:
      newList.filter(
        item => oldList.includes(item)
      ),

    changed:
      stableHash(oldList) !==
      stableHash(newList),

    oldRequirements: oldList,
    newRequirements: newList
  };
}

function getCurrentRequirements(
  deliverable
) {
  return normalizeRequirements(
    deliverable &&
    deliverable.metadata &&
    deliverable.metadata.requirements
  );
}

function validateFeedback(input) {
  if (!input || typeof input !== 'object') {
    throw new Error(
      'REVISION_REQUEST_REQUIRED'
    );
  }

  requireString(
    input.deliverableId,
    'DELIVERABLE_ID'
  );

  requireString(
    input.feedback,
    'CLIENT_FEEDBACK'
  );

  if (
    input.newRequirements !== undefined &&
    !Array.isArray(input.newRequirements)
  ) {
    throw new Error(
      'NEW_REQUIREMENTS_MUST_BE_ARRAY'
    );
  }

  return true;
}

function captureFeedback(input) {
  validateFeedback(input);

  const deliverable =
    deliverableStore.get(
      input.deliverableId
    );

  if (!deliverable) {
    throw new Error(
      'DELIVERABLE_NOT_FOUND'
    );
  }

  if (
    ![
      'SUBMITTED',
      'ACCEPTED',
      'REVISION_REQUESTED'
    ].includes(
      deliverable.status
    )
  ) {
    throw new Error(
      `REVISION_NOT_ALLOWED_FROM:${deliverable.status}`
    );
  }

  const oldRequirements =
    getCurrentRequirements(
      deliverable
    );

  const newRequirements =
    input.newRequirements === undefined
      ? oldRequirements
      : normalizeRequirements(
          input.newRequirements
        );

  const delta =
    computeRequirementDelta(
      oldRequirements,
      newRequirements
    );

  const now =
    new Date().toISOString();

  const feedbackHash =
    stableHash({
      deliverableId:
        deliverable.id,
      feedback:
        clean(input.feedback),
      newRequirements
    });

  const idempotencyKey =
    clean(input.idempotencyKey) ||
    `revision-${deliverable.id}-${feedbackHash}`;

  const existing =
    revisionStore.getByIdempotencyKey(
      idempotencyKey
    );

  if (existing) {
    return {
      duplicate: true,
      revision: existing
    };
  }

  const revision = {
    id:
      `revision-${crypto.randomUUID()}`,

    schema:
      'mira-deliverable-revision-v1',

    status:
      'FEEDBACK_CAPTURED',

    deliverableId:
      deliverable.id,

    workId:
      deliverable.workId,

    clientId:
      clean(input.clientId) ||
      clean(
        deliverable.metadata &&
        deliverable.metadata.clientId
      ),

    taskId:
      clean(input.taskId) ||
      clean(
        deliverable.metadata &&
        deliverable.metadata.taskId
      ),

    idempotencyKey,

    feedback:
      clean(input.feedback),

    feedbackHash,

    requirementDelta:
      delta,

    plan:
      null,

    execution:
      null,

    qa:
      null,

    submission:
      null,

    failure:
      null,

    history: [
      {
        status:
          'FEEDBACK_CAPTURED',
        event:
          'CLIENT_FEEDBACK_CAPTURED',
        at: now
      }
    ],

    createdAt: now,
    updatedAt: now
  };

  if (
    deliverable.status !==
    'REVISION_REQUESTED'
  ) {
    try {
      deliverableRevision.requestRevision(
        deliverable.id,
        input.feedback
      );
    } catch (error) {
      throw new Error(
        `REVISION_REQUEST_FAILED:${error.message}`
      );
    }
  }

  revisionStore.create(
    revision
  );

  return {
    duplicate: false,
    revision
  };
}

function createRevisionPlan(
  revisionId
) {
  const revision =
    revisionStore.get(
      revisionId
    );

  if (!revision) {
    throw new Error(
      'REVISION_NOT_FOUND'
    );
  }

  if (
    revision.status !==
    'FEEDBACK_CAPTURED'
  ) {
    throw new Error(
      `REVISION_PLAN_NOT_ALLOWED_FROM:${revision.status}`
    );
  }

  const delta =
    revision.requirementDelta;

  const steps = [];

  if (delta.added.length) {
    steps.push({
      id: 'UPDATE_REQUIREMENTS',
      action:
        'Update deliverable requirements',
      items: delta.added
    });
  }

  if (delta.removed.length) {
    steps.push({
      id: 'REMOVE_OBSOLETE_REQUIREMENTS',
      action:
        'Remove obsolete requirements',
      items: delta.removed
    });
  }

  steps.push({
    id: 'REBUILD',
    action:
      'Rebuild deliverable'
  });

  steps.push({
    id: 'VERIFY',
    action:
      'Run deliverable verification'
  });

  steps.push({
    id: 'FINAL_QA',
    action:
      'Run Stage 10.2 final delivery QA'
  });

  steps.push({
    id: 'CONTROLLED_RESUBMIT',
    action:
      'Resubmit through Stage 10.3'
  });

  const now =
    new Date().toISOString();

  return revisionStore.update(
    revision.id,
    current => {
      current.plan = {
        schema:
          'mira-revision-plan-v1',
        steps,
        createdAt: now,
        requirementDelta:
          current.requirementDelta
      };

      current.status =
        'PLAN_CREATED';

      current.history.push({
        status:
          'PLAN_CREATED',
        event:
          'REVISION_PLAN_CREATED',
        at: now
      });

      current.updatedAt = now;

      return current;
    }
  );
}

function executeRevision(
  revisionId,
  options = {}
) {
  const revision =
    revisionStore.get(
      revisionId
    );

  if (!revision) {
    throw new Error(
      'REVISION_NOT_FOUND'
    );
  }

  if (
    revision.status !==
    'PLAN_CREATED'
  ) {
    throw new Error(
      `REVISION_EXECUTION_NOT_ALLOWED_FROM:${revision.status}`
    );
  }

  const deliverable =
    deliverableStore.get(
      revision.deliverableId
    );

  if (!deliverable) {
    throw new Error(
      'DELIVERABLE_NOT_FOUND'
    );
  }

  const now =
    new Date().toISOString();

  try {
    const newRequirements =
      revision.requirementDelta
        .newRequirements;

    const updated =
      deliverableStore.update(
        deliverable.id,
        current => {
          current.metadata =
            current.metadata &&
            typeof current.metadata === 'object'
              ? current.metadata
              : {};

          current.metadata.requirements =
            newRequirements;

          current.metadata.revisionFeedback =
            revision.feedback;

          current.metadata.revisionId =
            revision.id;

          current.status =
            'READY';

          current.buildStatus =
            'NOT_BUILT';

          current.packagePath =
            null;

          current.verification = {
            passed: false,
            checkedAt: null,
            checks: []
          };

          current.history =
            Array.isArray(
              current.history
            )
              ? current.history
              : [];

          current.history.push({
            status:
              'READY',
            event:
              'REVISION_EXECUTION_STARTED',
            revisionId:
              revision.id,
            at: now
          });

          current.updatedAt =
            now;

          return current;
        }
      );

    const built =
      deliverableBuilder.build(
        updated.id
      );

    const verified =
      deliverableBuilder.verify(
        built.id
      );

    if (
      verified.status !==
      'QA_PASSED'
    ) {
      throw new Error(
        'REVISION_DELIVERABLE_VERIFY_FAILED'
      );
    }

    const qa =
      finalDeliveryQA.runQA({
        deliverable: verified,
        filePath: verified.packagePath,
        expectedSha256:
          verified.metadata &&
          verified.metadata.sha256,
        requirements:
          revision.requirementDelta
            .newRequirements
      });

    if (
      !qa ||
      !qa.finalVerification ||
      qa.finalVerification.passed !== true
    ) {
      const failure =
        new Error(
          'REVISION_FINAL_QA_FAILED'
        );

      failure.qa =
        qa || null;

      throw failure;
    }

    const executionNow =
      new Date().toISOString();

    revisionStore.update(
      revision.id,
      current => {
        current.status =
          'QA_PASSED';

        current.execution = {
          completedAt:
            executionNow,
          deliverableStatus:
            verified.status,
          packagePath:
            verified.packagePath
        };

        current.qa =
          qa;

        current.history.push({
          status:
            'QA_PASSED',
          event:
            'REVISION_EXECUTION_QA_PASSED',
          at:
            executionNow
        });

        current.updatedAt =
          executionNow;

        return current;
      }
    );

    if (
      options.autoSubmit !== true
    ) {
      return revisionStore.get(
        revision.id
      );
    }

    return resubmitRevision(
      revision.id,
      options
    );
  } catch (error) {
    revisionStore.update(
      revision.id,
      current => {
        current.status =
          'FAILED';

        current.failure = {
          code:
            error.message,
          qa:
            error.qa || null,
          at:
            new Date().toISOString()
        };

        current.history.push({
          status:
            'FAILED',
          event:
            'REVISION_EXECUTION_FAILED',
          error:
            error.message,
          at:
            new Date().toISOString()
        });

        current.updatedAt =
          new Date().toISOString();

        return current;
      }
    );

    const failure =
      new Error(
        `REVISION_EXECUTION_FAILED:${error.message}`
      );

    failure.revision =
      revisionStore.get(
        revision.id
      );

    throw failure;
  }
}

function resubmitRevision(
  revisionId,
  options = {}
) {
  const revision =
    revisionStore.get(
      revisionId
    );

  if (!revision) {
    throw new Error(
      'REVISION_NOT_FOUND'
    );
  }

  if (
    revision.status !==
    'QA_PASSED'
  ) {
    throw new Error(
      `RESUBMISSION_REQUIRES_QA_PASSED:${revision.status}`
    );
  }

  const deliverable =
    deliverableStore.get(
      revision.deliverableId
    );

  if (!deliverable) {
    throw new Error(
      'DELIVERABLE_NOT_FOUND'
    );
  }

  const clientId =
    clean(revision.clientId) ||
    clean(
      deliverable.metadata &&
      deliverable.metadata.clientId
    );

  const taskId =
    clean(revision.taskId) ||
    clean(
      deliverable.metadata &&
      deliverable.metadata.taskId
    ) ||
    clean(deliverable.workId);

  requireString(
    clientId,
    'CLIENT_ID'
  );

  requireString(
    taskId,
    'TASK_ID'
  );

  const submissionIdempotencyKey =
    `revision-submit-${revision.id}`;

  try {
    const result =
      submissionEngine.submit(
        {
          deliverableId:
            deliverable.id,
          clientId,
          taskId,
          idempotencyKey:
            submissionIdempotencyKey
        },
        {
          adapter:
            options.adapter
        }
      );

    const now =
      new Date().toISOString();

    const updated =
      revisionStore.update(
        revision.id,
        current => {
          current.status =
            result.status ===
            'SUBMITTED'
              ? 'RESUBMITTED'
              : 'RESUBMISSION_DUPLICATE';

          current.submission = {
            status:
              result.status,
            submissionId:
              result.submission &&
              result.submission.id ||
              null,
            receipt:
              result.receipt || null
          };

          current.history.push({
            status:
              current.status,
            event:
              'REVISION_RESUBMITTED',
            at:
              now
          });

          current.updatedAt =
            now;

          return current;
        }
      );

    return updated;
  } catch (error) {
    revisionStore.update(
      revision.id,
      current => {
        current.status =
          'SUBMISSION_FAILED';

        current.failure = {
          code:
            error.message,
          at:
            new Date().toISOString()
        };

        current.history.push({
          status:
            'SUBMISSION_FAILED',
          event:
            'REVISION_RESUBMISSION_FAILED',
          error:
            error.message,
          at:
            new Date().toISOString()
        });

        current.updatedAt =
          new Date().toISOString();

        return current;
      }
    );

    throw error;
  }
}

function getRevision(id) {
  return revisionStore.get(id);
}

function listRevisions() {
  return revisionStore.list();
}

module.exports = {
  computeRequirementDelta,
  validateFeedback,
  captureFeedback,
  createRevisionPlan,
  executeRevision,
  resubmitRevision,
  getRevision,
  listRevisions
};
