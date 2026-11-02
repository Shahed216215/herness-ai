'use strict';

const assert = require('assert');

const {
  buildQueuePlanningIntegration
} = require('../services/mira-queue-planning-integration');

const {
  buildProjectQueuePlanningIntegration,
  buildAllProjectQueuePlanningIntegrations
} = require(
  '../services/mira-project-queue-planning-integration-service'
);

const {
  listProjects
} = require('../project-store');

function run() {
  const now =
    new Date('2026-10-08T12:00:00Z');

  const projects = listProjects();
  const baselineProjectCount = projects.length;

  assert.strictEqual(
    projects.length,
    baselineProjectCount
  );

  const globalResult =
    buildQueuePlanningIntegration({ now });

  assert.strictEqual(
    globalResult.ok,
    true
  );

  assert.strictEqual(
    globalResult.projectCount,
    baselineProjectCount
  );

  const baselineQueue =
    buildQueuePlanningIntegration({ now });

  assert.strictEqual(
    globalResult.projectsWithItems,
    baselineQueue.projectsWithItems
  );

  assert.strictEqual(
    globalResult.taskCount,
    baselineQueue.taskCount
  );

  assert.strictEqual(
    globalResult.queue.length,
    baselineQueue.queue.length
  );

  assert.strictEqual(
    globalResult.consistency.status,
    'consistent'
  );

  assert.strictEqual(
    globalResult.executionAllowed,
    false
  );

  assert.strictEqual(
    globalResult.planningOnly,
    true
  );

  assert.strictEqual(
    globalResult.externalActionPerformed,
    false
  );

  assert.strictEqual(
    globalResult.paymentAllowed,
    false
  );

  assert.strictEqual(
    globalResult.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    globalResult.contractSigningAllowed,
    false
  );

  const positions =
    globalResult.queue.map(
      item => item.globalQueuePosition
    );

  assert.deepStrictEqual(
    positions,
    Array.from(
      { length: baselineQueue.queue.length },
      (_, index) => index + 1
    )
  );

  const taskIds =
    globalResult.queue.map(
      item => item.taskId
    );

  assert.strictEqual(
    new Set(taskIds).size,
    baselineQueue.queue.length
  );

  const blockedIndexes =
    globalResult.queue
      .map(item => item.dependencyBlocked)
      .reduce(
        (acc, blocked, index) => {
          if (blocked) acc.push(index);
          return acc;
        },
        []
      );

  if (blockedIndexes.length > 0) {
    const firstBlocked =
      blockedIndexes[0];

    for (
      let index = firstBlocked;
      index < globalResult.queue.length;
      index += 1
    ) {
      assert.strictEqual(
        globalResult.queue[index]
          .dependencyBlocked,
        true
      );
    }
  }

  const projectWithItems =
    projects.find(project => {
      const scoped =
        buildProjectQueuePlanningIntegration({
          projectId: project.projectId,
          now
        });

      return scoped.ok === true &&
        Array.isArray(scoped.queue) &&
        scoped.queue.length > 0;
    });

  assert.ok(
    projectWithItems,
    'EXPECTED_AT_LEAST_ONE_PROJECT_WITH_QUEUE_ITEMS'
  );

  const scoped =
    buildProjectQueuePlanningIntegration({
      projectId: projectWithItems.projectId,
      now
    });

  assert.strictEqual(
    scoped.ok,
    true
  );

  assert.strictEqual(
    scoped.projectId,
    projectWithItems.projectId
  );

  assert.strictEqual(
    scoped.projectCount,
    1
  );

  assert.strictEqual(
    scoped.executionAllowed,
    false
  );

  assert.strictEqual(
    scoped.planningOnly,
    true
  );

  assert.strictEqual(
    scoped.externalActionPerformed,
    false
  );

  assert.strictEqual(
    scoped.paymentAllowed,
    false
  );

  assert.strictEqual(
    scoped.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    scoped.contractSigningAllowed,
    false
  );

  const missing =
    buildProjectQueuePlanningIntegration({
      projectId: 'stage9311-nonexistent-project',
      now
    });

  assert.strictEqual(
    missing.ok,
    false
  );

  assert.strictEqual(
    missing.status,
    'not_found'
  );

  const all =
    buildAllProjectQueuePlanningIntegrations({
      now
    });

  assert.strictEqual(
    all.ok,
    true
  );

  assert.strictEqual(
    all.projectCount,
    baselineProjectCount
  );

  assert.strictEqual(
    all.results.length,
    baselineProjectCount
  );

  assert.strictEqual(
    all.executionAllowed,
    false
  );

  assert.strictEqual(
    all.planningOnly,
    true
  );

  console.log(
    'PROJECTS_CHECKED:',
    projects.length
  );

  console.log(
    'GLOBAL_QUEUE_ITEMS_CHECKED:',
    globalResult.queue.length
  );

  console.log(
    'PROJECT_SCOPED_TEST: PASS'
  );

  console.log(
    'ALL_PROJECT_INTEGRATION_TEST: PASS'
  );

  console.log(
    'STAGE9311_QUEUE_PLANNING_INTEGRATION_E2E_TEST: PASS'
  );
}

run();
