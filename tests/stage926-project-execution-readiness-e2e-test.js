"use strict";

const assert = require("assert");

const {
  createPlanningProjectFixture,
  createTaskFixture,
  createPlanFixture,
  createScheduleFixture
} = (() => {
  const createWorkAcceptance =
    require("../work-acceptance-schema").createWorkAcceptance;

  const createStoredWorkAcceptance =
    require("../work-acceptance-store").createStoredWorkAcceptance;

  const createProjectFromAcceptedWork =
    require("../services/mira-project-creation-service")
      .createProjectFromAcceptedWork;

  const createTask =
    require("../task-schema").createTask;

  const createStoredTask =
    require("../task-store").createStoredTask;

  const createPlan =
    require("../task-plan-schema").createPlan;

  const createProjectSchedule =
    require("../project-schedule-schema").createProjectSchedule;

  const createStoredProjectSchedule =
    require("../project-schedule-store")
      .createStoredProjectSchedule;

  function createPlanningProjectFixture() {
    const acceptance = createWorkAcceptance({
      acceptanceId: `wa-stage926-e2e-${Date.now()}`,
      opportunityId: "opp-stage926-e2e",
      qualificationId: "qual-stage926-e2e",
      proposalId: "prop-stage926-e2e",
      clientResponseId: "response-stage926-e2e",
      status: "accepted",
      acceptanceDecision: {
        decision: "accept",
        reason: "Stage 9.2.6 E2E"
      },
      workScope: {
        scopeId: "scope-stage926-e2e",
        summary: "Stage 9.2.6 E2E scope",
        deliverables: ["E2E deliverable"],
        exclusions: ["External execution"],
        createdAt: new Date().toISOString()
      }
    });

    const storedAcceptance =
      createStoredWorkAcceptance(acceptance);

    return createProjectFromAcceptedWork({
      acceptanceId: storedAcceptance.acceptanceId,
      projectId: `project-stage926-e2e-${Date.now()}`
    });
  }

  function createTaskFixture(projectId, index) {
    const task = createTask({
      id: `stage926-e2e-task-${Date.now()}-${index}`,
      projectId,
      title: `Stage 9.2.6 E2E Task ${index}`,
      description: "Readiness E2E task",
      priority: "normal"
    });

    return createStoredTask(task);
  }

  function createPlanFixture(task) {
    const subtaskId =
      `subtask-${task.id}-1`;

    return createPlan({
      id: `plan-${task.id}`,
      taskId: task.id,
      goal: `Complete ${task.id}`,
      requirements: [`Requirement for ${task.id}`],
      status: "validated",
      feasibility: "feasible",
      subtasks: [{
        id: subtaskId,
        title: `Prepare ${task.id}`,
        description: "Preparation",
        status: "pending",
        dependencies: [],
        objective: "Prepare result",
        inputs: [],
        outputs: ["Prepared result"],
        verification: ["Verify result"],
        order: 1
      }],
      executionPlan: [{
        subtaskId,
        action: "Prepare result",
        expectedOutput: "Prepared result"
      }],
      verificationPlan: [{
        subtaskId,
        verification: "Verify result"
      }],
      deliverable: {
        description: "E2E deliverable",
        outputs: ["Prepared result"],
        acceptanceCriteria: ["Result is valid"]
      },
      executionAllowed: false,
      planningOnly: true
    });
  }

  function createScheduleFixture(project, tasks, plans) {
    const schedule = createProjectSchedule({
      scheduleId: `schedule-stage926-e2e-${Date.now()}`,
      projectId: project.projectId,
      entries: tasks.map((task, index) => ({
        taskId: task.id,
        planId: plans[index].id,
        sequence: index + 1,
        dependencies: [],
        deadline: "",
        estimatedDuration: null,
        scheduledStart: "",
        scheduledEnd: "",
        status: "planned"
      })),
      status: "planned",
      executionAllowed: false,
      planningOnly: true,
      externalActionPerformed: false,
      paymentAllowed: false,
      paymentTransferAuthorized: false,
      contractSigningAllowed: false
    });

    return createStoredProjectSchedule(schedule);
  }

  return {
    createPlanningProjectFixture,
    createTaskFixture,
    createPlanFixture,
    createScheduleFixture
  };
})();

const {
  updateProject
} = require("../project-store");

const {
  evaluateProjectExecutionReadiness
} = require("../services/mira-project-execution-readiness-service");

function main() {
  console.log("\n=== STAGE 9.2.6 READINESS E2E TEST ===");

  const project =
    createPlanningProjectFixture();

  const taskResults = [
    createTaskFixture(project.projectId, 1),
    createTaskFixture(project.projectId, 2)
  ];

  const tasks =
    taskResults.map(result => result.task);

  const projectWithTasks =
    updateProject(
      project.projectId,
      {
        ...project,
        taskIds: tasks.map(task => task.id)
      }
    );

  const plans =
    tasks.map(createPlanFixture);

  const schedule =
    createScheduleFixture(
      projectWithTasks,
      tasks,
      plans
    );

  console.log("\n[1] PROJECT → TASKS");
  assert.deepStrictEqual(
    projectWithTasks.taskIds,
    tasks.map(task => task.id)
  );
  console.log("[PASS] project/task linkage");

  console.log("\n[2] TASKS → PLANS");
  assert.strictEqual(plans.length, tasks.length);
  plans.forEach((plan, index) => {
    assert.strictEqual(
      plan.taskId,
      tasks[index].id
    );
    assert.strictEqual(
      plan.feasibility,
      "feasible"
    );
  });
  console.log("[PASS] task/plan linkage");

  console.log("\n[3] SCHEDULE → PLANS");
  assert.strictEqual(
    schedule.entries.length,
    plans.length
  );
  schedule.entries.forEach((entry, index) => {
    assert.strictEqual(
      entry.taskId,
      tasks[index].id
    );
    assert.strictEqual(
      entry.planId,
      plans[index].id
    );
  });
  console.log("[PASS] schedule/plan linkage");

  console.log("\n[4] EXECUTION READINESS");
  const result =
    evaluateProjectExecutionReadiness({
      projectId: project.projectId,
      scheduleId: schedule.scheduleId,
      plans: plans.map(plan => ({
        taskId: plan.taskId,
        plan
      }))
    });

  assert.strictEqual(
    result.readiness.status,
    "ready"
  );

  assert.strictEqual(
    result.readiness.decision,
    "ready"
  );

  console.log("[PASS] readiness = READY");

  console.log("\n[5] EXECUTION SAFETY");
  assert.strictEqual(
    result.readiness.executionAllowed,
    false
  );
  assert.strictEqual(
    result.readiness.planningOnly,
    true
  );
  assert.strictEqual(
    result.project.status,
    "planning"
  );
  assert.strictEqual(
    result.schedule.status,
    "planned"
  );
  result.tasks.forEach(task => {
    assert.strictEqual(task.status, "new");
  });

  console.log(
    "[PASS] readiness does not execute work"
  );

  console.log("\n========================================");
  console.log(
    "STAGE926_PROJECT_EXECUTION_READINESS_E2E_TEST: PASS"
  );
  console.log("========================================");
}

main();
