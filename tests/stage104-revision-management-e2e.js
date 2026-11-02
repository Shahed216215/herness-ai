'use strict';

const assert = require('assert');
const fs = require('fs');

const builder =
  require('../services/deliverable-builder');

const deliverableStore =
  require('../deliverable-store');

const revisionStore =
  require('../revision-store');

const revision =
  require('../services/revision-management-engine');

const id =
  `stage104-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

const workId =
  `stage104-work-${Date.now()}`;

function cleanup() {
  try {
    const data =
      deliverableStore.loadStore();

    data.deliveries =
      data.deliveries.filter(
        item => item.id !== id
      );

    deliverableStore.saveStore(data);
  } catch (_) {}

  try {
    const data =
      revisionStore.loadStore();

    data.revisions =
      data.revisions.filter(
        item => item.deliverableId !== id
      );

    revisionStore.saveStore(data);
  } catch (_) {}

  try {
    const dir =
      `deliveries/${workId}`;

    if (fs.existsSync(dir)) {
      fs.rmSync(dir, {
        recursive: true,
        force: true
      });
    }
  } catch (_) {}
}

try {
  cleanup();

  builder.register({
    id,
    workId,
    title: 'Stage 10.4 Revision',
    requiredFormat: 'PDF',
    metadata: {
      clientId: 'client-stage104',
      taskId: 'task-stage104',
      requirements: [
        'original requirement'
      ]
    }
  });

  builder.build(id);
  builder.verify(id);
  builder.markPendingSubmission(id);
  builder.markSubmitted(id);

  const captured =
    revision.captureFeedback({
      deliverableId: id,
      clientId: 'client-stage104',
      taskId: 'task-stage104',
      feedback:
        'Client requested an additional security section.',
      newRequirements: [
        'original requirement',
        'security section',
        'final delivery'
      ]
    });

  assert.strictEqual(
    captured.duplicate,
    false
  );

  const revisionId =
    captured.revision.id;

  assert.strictEqual(
    captured.revision.status,
    'FEEDBACK_CAPTURED'
  );

  assert.deepStrictEqual(
    captured.revision.requirementDelta.added,
    [
      'security section',
      'final delivery'
    ]
  );

  const duplicateFeedback =
    revision.captureFeedback({
      deliverableId: id,
      clientId: 'client-stage104',
      taskId: 'task-stage104',
      feedback:
        'Client requested an additional security section.',
      newRequirements: [
        'original requirement',
        'security section',
        'final delivery'
      ]
    });

  assert.strictEqual(
    duplicateFeedback.duplicate,
    true
  );

  const plan =
    revision.createRevisionPlan(
      revisionId
    );

  assert.strictEqual(
    plan.status,
    'PLAN_CREATED'
  );

  assert(
    plan.plan.steps.some(
      step =>
        step.id === 'UPDATE_REQUIREMENTS'
    )
  );

  const executed =
    revision.executeRevision(
      revisionId
    );

  assert.strictEqual(
    executed.status,
    'QA_PASSED'
  );

  assert.strictEqual(
    executed.qa.finalVerification.passed,
    true
  );

  assert.strictEqual(
    executed.qa.requirementMatch.passed,
    true
  );

  assert.strictEqual(
    executed.qa.quality.passed,
    true
  );

  assert.strictEqual(
    executed.qa.security.passed,
    true
  );

  assert(
    executed.execution.packagePath
  );

  const finalDeliverable =
    deliverableStore.get(id);

  assert.deepStrictEqual(
    finalDeliverable.metadata.requirements,
    [
      'original requirement',
      'security section',
      'final delivery'
    ]
  );

  const artifact =
    fs.readFileSync(
      finalDeliverable.packagePath,
      'utf8'
    );

  assert(
    artifact.includes('security section')
  );

  assert(
    artifact.includes('final delivery')
  );

  const submitted =
    revision.resubmitRevision(
      revisionId,
      {
        adapter: () => ({
          accepted: true
        })
      }
    );

  assert.strictEqual(
    submitted.status,
    'RESUBMITTED'
  );

  const afterSubmit =
    revisionStore.get(
      revisionId
    );

  assert.strictEqual(
    afterSubmit.status,
    'RESUBMITTED'
  );

  assert.throws(
    () =>
      revision.resubmitRevision(
        revisionId
      ),
    /RESUBMISSION_REQUIRES_QA_PASSED/
  );

  console.log(
    'STAGE10_4_REVISION_MANAGEMENT_E2E: PASS'
  );
  console.log(
    'FEEDBACK_CAPTURE: PASS'
  );
  console.log(
    'REQUIREMENT_DELTA: PASS'
  );
  console.log(
    'DUPLICATE_FEEDBACK_PROTECTION: PASS'
  );
  console.log(
    'REVISION_PLAN: PASS'
  );
  console.log(
    'CONTROLLED_REBUILD: PASS'
  );
  console.log(
    'REQUIREMENTS_IN_ARTIFACT: PASS'
  );
  console.log(
    'STAGE10_2_FINAL_QA: PASS'
  );
  console.log(
    'QA_GATED_RESUBMISSION: PASS'
  );
  console.log(
    'STAGE10_3_CONTROLLED_SUBMISSION: PASS'
  );
  console.log(
    'POST_SUBMISSION_RESUBMIT_BLOCK: PASS'
  );
} finally {
  cleanup();
}
