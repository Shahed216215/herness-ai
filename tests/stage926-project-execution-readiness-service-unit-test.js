"use strict";

const assert = require("assert");
const fs = require("fs");

const {
  createProject
} = require("../project-schema");

const {
  createStoredProject
} = require("../project-store");

const {
  createTask
} = require("../task-schema");

const {
  createStoredTask,
  getTaskSummary
} = require("../task-store");

const {
  createProjectSchedule
} = require("../project-schedule-schema");

const {
  createStoredProjectSchedule,
  getSchedule
} = require("../project-schedule-store");

const {
  createPlan
} = require("../task-plan-schema");

const {
  evaluateProjectExecutionReadiness
} = require("../services/mira-project-execution-readiness-service");

const {
  createProjectSchedulePlan
} = require("../services/mira-project-schedule-planning-service");

const {
  createProjectFromAcceptedWork
} = require("../services/mira-project-creation-service");

const {
  createWorkAcceptance
} = require("../work-acceptance-schema");

const {
  createStoredWorkAcceptance
} = require("../work-acceptance-store");

const {
  getProject
} = require("../project-store");

const {
  listSchedules
} = require("../project-schedule-store");

const {
  listTasks
} = require("../task-store");

const TASK_FILE =
  require("../task-store").TASK_FILE;

const PROJECT_FILE =
  require("../project-store").PROJECT_FILE;

const SCHEDULE_FILE =
  require("../project-schedule-store").SCHEDULE_FILE;

function snapshotFile(file) {
  return fs.readFileSync(file, "utf8");
}

function assertSafety(value, label) {
  assert.strictEqual(
    value.executionAllowed,
    false,
    `${label}: executionAllowed must remain false`
  );

  assert.strictEqual(
    value.planningOnly,
    true,
    `${label}: planningOnly must remain true`
  );

  assert.strictEqual(
    value.externalActionPerformed,
    false,
    `${label}: externalActionPerformed must remain false`
  );

  assert.strictEqual(
    value.paymentAllowed,
    false,
    `${label}: paymentAllowed must remain false`
  );

  assert.strictEqual(
    value.paymentTransferAuthorized,
    false,
    `${label}: paymentTransferAuthorized must remain false`
  );

  assert.strictEqual(
    value.contractSigningAllowed,
    false,
    `${label}: contractSigningAllowed must remain false`
  );
}

function createAcceptedWorkFixture() {
  const acceptance = createWorkAcceptance({
    acceptanceId: `wa-stage926-${Date.now()}`,
    opportunityId: "opp-stage926",
    qualificationId: "qual-stage926",
    proposalId: "prop-stage926",
    clientResponseId: "response-stage926",
    status: "accepted",
    acceptanceDecision: {
      decision: "accept",
      reason: "Stage 9.2.6 readiness test"
    },
    workScope: {
      scopeId: "scope-stage926",
      summary: "Stage 9.2.6 readiness test scope",
      deliverables: [
        "Readiness test deliverable"
      ],
      exclusions: [
        "External execution"
      ],
      createdAt: new Date().toISOString()
    }
  });

  return createStoredWorkAcceptance(
    acceptance
  );
}

function createPlanningProjectFixture() {
  const acceptance =
    createAcceptedWorkFixture();

  return createProjectFromAcceptedWork({
    acceptanceId:
      acceptance.acceptanceId,
    projectId:
      `project-stage926-${Date.now()}`
  });
}

function createTaskFixture(projectId, index) {
  const task = createTask({
    id:
      `stage926-task-${Date.now()}-${index}`,
    projectId,
    title:
      `Stage 9.2.6 Task ${index}`,
    description:
      `Readiness test task ${index}`,
    priority: "normal"
  });

  return createStoredTask(task);
}

function createPlanFixture(task) {
  const subtask = {
    id: `subtask-${task.id}-1`,
    title: `Prepare ${task.id}`,
    description: "Preparation step",
    status: "pending",
    dependencies: []
  };

  const plan = createPlan({
    id: `plan-${task.id}`,
    taskId: task.id,
    goal: `Complete readiness test task ${task.id}.`,
    requirements: [
      `Complete the requested work for ${task.id}.`
    ],
    status: "validated",
    feasibility: "feasible",
    subtasks: [
      {
        ...subtask,
        objective:
          `Prepare the required result for ${task.id}.`,
        inputs: [],
        outputs: [
          `Prepared result for ${task.id}`
        ],
        verification: [
          `Verify the prepared result for ${task.id}.`
        ],
        order: 1
      }
    ],
    executionPlan: [
      {
        subtaskId:
          subtask.id,
        action:
          `Prepare the required result for ${task.id}.`,
        expectedOutput:
          `Prepared result for ${task.id}`
      }
    ],
    verificationPlan: [
      {
        checkId: `check-${task.id}`,
        target: task.id,
        method:
          `Verify the result for ${task.id}.`,
        expected:
          `The result for ${task.id} satisfies the task goal.`,
        required: true
      }
    ],
    deliverable: {
      type: "task_result",
      description:
        `Deliverable for ${task.id}.`,
      outputs: [
        `Prepared result for ${task.id}`
      ],
      acceptanceCriteria: [
        "All stated requirements are addressed.",
        "The result matches the task goal.",
        "Required verification checks pass."
      ]
    },
    executionAllowed: false,
    planningOnly: true
  });

  return plan;
}

function createScheduleFixture(project, tasks, plans) {
  const entries = tasks.map(
    (task, index) => ({
      taskId: task.id,
      planId: plans[index].id,
      sequence: index + 1,
      dependencies: [],
      deadline: "",
      estimatedDuration: null,
      scheduledStart: "",
      scheduledEnd: "",
      status: "planned"
    })
  );

  const schedule =
    createProjectSchedule({
      scheduleId:
        `schedule-stage926-${Date.now()}`,
      projectId:
        project.projectId,
      entries,
      status: "planned",
      executionAllowed: false,
      planningOnly: true,
      externalActionPerformed: false,
      paymentAllowed: false,
      paymentTransferAuthorized: false,
      contractSigningAllowed: false
    });

  return createStoredProjectSchedule(
    schedule
  );
}

function setupReadyFixture() {
  const project =
    createPlanningProjectFixture();

  const taskResults = [
    createTaskFixture(project.projectId, 1),
    createTaskFixture(project.projectId, 2)
  ];

  const tasks =
    taskResults.map(
      result => result.task
    );

  const taskIds =
    tasks.map(
      task => task.id
    );

  const updatedProject =
    getProject(
      project.projectId
    );

  const projectWithTasks = {
    ...updatedProject,
    taskIds,
    deliverables:
      updatedProject.deliverables || []
  };

  const finalProject =
    require("../project-store")
      .updateProject(
        project.projectId,
        projectWithTasks
      );

  assert.strictEqual(
    finalProject.projectId,
    project.projectId
  );

  const plans =
    tasks.map(
      task =>
        createPlanFixture(task)
    );

  const schedule =
    createScheduleFixture(
      finalProject,
      tasks,
      plans
    );

  return {
    project:
      finalProject,
    tasks,
    plans,
    schedule
  };
}

function main() {
  console.log(
    "\n=== STAGE 9.2.6 READINESS SERVICE UNIT TEST ==="
  );

  const taskBaseline =
    snapshotFile(TASK_FILE);

  const projectBaseline =
    snapshotFile(PROJECT_FILE);

  const scheduleBaseline =
    snapshotFile(SCHEDULE_FILE);

  const baselineActiveTaskIds =
    new Set(
      listTasks()
        .filter(task => task.status === "active")
        .map(task => task.id)
    );

  const fixture =
    setupReadyFixture();

  const {
    project,
    tasks,
    plans,
    schedule
  } = fixture;

  console.log(
    "\n[1] READY HAPPY PATH"
  );

  const readyResult =
    evaluateProjectExecutionReadiness({
      projectId:
        project.projectId,
      scheduleId:
        schedule.scheduleId,
      plans:
        plans.map(plan => ({
          taskId:
            plan.taskId,
          plan
        }))
    });

  assert.strictEqual(
    readyResult.readiness.status,
    "ready"
  );

  assert.strictEqual(
    readyResult.readiness.decision,
    "ready"
  );

  assert.strictEqual(
    readyResult.readiness.blockingReasons.length,
    0
  );

  assert.strictEqual(
    readyResult.validation.valid,
    true
  );

  console.log(
    "[PASS] READY happy path"
  );

  console.log(
    "\n[2] READINESS SAFETY"
  );

  assertSafety(
    readyResult.readiness,
    "readiness"
  );

  assertSafety(
    readyResult.project,
    "project"
  );

  assertSafety(
    readyResult.schedule,
    "schedule"
  );

  for (const plan of readyResult.plans) {
    assert.strictEqual(
      plan.executionAllowed,
      false
    );

    assert.strictEqual(
      plan.planningOnly,
      true
    );
  }

  console.log(
    "[PASS] readiness/project/schedule/plans remain non-executable"
  );

  console.log(
    "\n[3] BLOCKED: MISSING PLAN"
  );

  const missingPlanResult =
    evaluateProjectExecutionReadiness({
      projectId:
        project.projectId,
      scheduleId:
        schedule.scheduleId,
      plans: [
        {
          taskId:
            tasks[0].id,
          plan:
            plans[0]
        }
      ]
    });

  assert.strictEqual(
    missingPlanResult.readiness.status,
    "blocked"
  );

  assert.strictEqual(
    missingPlanResult.readiness.decision,
    "blocked"
  );

  assert(
    missingPlanResult.readiness.blockingReasons.some(
      reason =>
        reason.includes(
          `Plan is missing for task ${tasks[1].id}`
        )
    )
  );

  console.log(
    "[PASS] missing plan blocked"
  );

  console.log(
    "\n[4] BLOCKED: PLAN/TASK MISMATCH"
  );

  const mismatchPlan =
    {
      ...plans[0],
      taskId:
        tasks[1].id,
      id:
        `plan-mismatch-${Date.now()}`
    };

  const mismatchResult =
    evaluateProjectExecutionReadiness({
      projectId:
        project.projectId,
      scheduleId:
        schedule.scheduleId,
      plans: [
        {
          taskId:
            tasks[0].id,
          plan:
            mismatchPlan
        },
        {
          taskId:
            tasks[1].id,
          plan:
            plans[1]
        }
      ]
    });

  assert.strictEqual(
    mismatchResult.readiness.status,
    "blocked"
  );

  assert(
    mismatchResult.readiness.blockingReasons.some(
      reason =>
        reason.includes(
          `Plan taskId does not match task ${tasks[0].id}`
        )
    )
  );

  console.log(
    "[PASS] plan/task mismatch blocked"
  );

  console.log(
    "\n[5] BLOCKED: INVALID PLAN"
  );

  const invalidPlan =
    {
      ...plans[0],
      subtasks: []
    };

  const invalidResult =
    evaluateProjectExecutionReadiness({
      projectId:
        project.projectId,
      scheduleId:
        schedule.scheduleId,
      plans: [
        {
          taskId:
            tasks[0].id,
          plan:
            invalidPlan
        },
        {
          taskId:
            tasks[1].id,
          plan:
            plans[1]
        }
      ]
    });

  assert.strictEqual(
    invalidResult.readiness.status,
    "blocked"
  );

  assert(
    invalidResult.readiness.blockingReasons.some(
      reason =>
        reason.includes(
          `Plan validation failed for ${tasks[0].id}`
        )
    )
  );

  console.log(
    "[PASS] invalid plan blocked"
  );

  console.log(
    "\n[6] BLOCKED: INFEASIBLE PLAN"
  );

  const infeasiblePlan =
    {
      ...plans[0],
      feasibility:
        "infeasible"
    };

  const infeasibleResult =
    evaluateProjectExecutionReadiness({
      projectId:
        project.projectId,
      scheduleId:
        schedule.scheduleId,
      plans: [
        {
          taskId:
            tasks[0].id,
          plan:
            infeasiblePlan
        },
        {
          taskId:
            tasks[1].id,
          plan:
            plans[1]
        }
      ]
    });

  assert.strictEqual(
    infeasibleResult.readiness.status,
    "blocked"
  );

  assert(
    infeasibleResult.readiness.blockingReasons.some(
      reason =>
        reason.includes(
          `Plan is not feasible for ${tasks[0].id}`
        )
    )
  );

  console.log(
    "[PASS] infeasible plan blocked"
  );

  console.log(
    "\n[7] BLOCKED: WRONG SCHEDULE DEPENDENCY"
  );

  const currentSchedule =
    getSchedule(
      schedule.scheduleId
    );

  const tamperedSchedule =
    {
      ...currentSchedule,
      entries:
        currentSchedule.entries.map(
          (entry, index) =>
            index === 0
              ? {
                  ...entry,
                  dependencies: [
                    "unknown-subtask-stage926"
                  ]
                }
              : entry
        )
    };

  const scheduleUpdateResult =
    require("../project-schedule-store")
      .updateProjectSchedule(
        schedule.scheduleId,
        tamperedSchedule
      );

  assert.ok(
    scheduleUpdateResult &&
    scheduleUpdateResult.scheduleId ===
      schedule.scheduleId
  );

  const dependencyResult =
    evaluateProjectExecutionReadiness({
      projectId:
        project.projectId,
      scheduleId:
        schedule.scheduleId,
      plans:
        plans.map(plan => ({
          taskId:
            plan.taskId,
          plan
        }))
    });

  assert.strictEqual(
    dependencyResult.readiness.status,
    "blocked"
  );

  assert(
    dependencyResult.readiness.blockingReasons.some(
      reason =>
        reason.includes(
          `Schedule contains unknown subtask dependency for ${tasks[0].id}`
        )
    )
  );

  console.log(
    "[PASS] wrong dependency blocked"
  );

  console.log(
    "\n[8] BLOCKED: TASK NOT NEW"
  );

  const restoredSchedule =
    createScheduleFixture(
      project,
      tasks,
      plans
    );

  const activeTask =
    require("../task-store")
      .updateTask(
        tasks[0].id,
        {
          ...tasks[0],
          status: "active"
        }
      );

  assert.strictEqual(
    activeTask.ok,
    true
  );

  const taskStatusResult =
    evaluateProjectExecutionReadiness({
      projectId:
        project.projectId,
      scheduleId:
        restoredSchedule.scheduleId,
      plans:
        plans.map(plan => ({
          taskId:
            plan.taskId,
          plan
        }))
    });

  assert.strictEqual(
    taskStatusResult.readiness.status,
    "blocked"
  );

  assert(
    taskStatusResult.readiness.blockingReasons.some(
      reason =>
        reason ===
        "Every linked task must remain new before execution readiness."
    )
  );

  console.log(
    "[PASS] non-new task blocked"
  );

  console.log(
    "\n[9] BLOCKED: SCHEDULE STATE"
  );

  const plannedSchedule =
    getSchedule(
      restoredSchedule.scheduleId
    );

  const blockedSchedule =
    {
      ...plannedSchedule,
      status: "blocked"
    };

  const blockedScheduleUpdate =
    require("../project-schedule-store")
      .updateProjectSchedule(
        restoredSchedule.scheduleId,
        blockedSchedule
      );

  assert.ok(
    blockedScheduleUpdate &&
    blockedScheduleUpdate.scheduleId ===
      restoredSchedule.scheduleId
  );

  const scheduleStateResult =
    evaluateProjectExecutionReadiness({
      projectId:
        project.projectId,
      scheduleId:
        restoredSchedule.scheduleId,
      plans:
        plans.map(plan => ({
          taskId:
            plan.taskId,
          plan
        }))
    });

  assert.strictEqual(
    scheduleStateResult.readiness.status,
    "blocked"
  );

  assert(
    scheduleStateResult.readiness.blockingReasons.some(
      reason =>
        reason ===
        "Schedule status is blocked."
    )
  );

  console.log(
    "[PASS] blocked schedule state detected"
  );

  console.log(
    "\n[10] EXACT TASK/PLAN LINKAGE"
  );

  const duplicatePlanInput =
    [
      {
        taskId:
          tasks[0].id,
        plan:
          plans[0]
      },
      {
        taskId:
          tasks[0].id,
        plan:
          plans[1]
      }
    ];

  assert.throws(
    () =>
      evaluateProjectExecutionReadiness({
        projectId:
          project.projectId,
        scheduleId:
          schedule.scheduleId,
        plans:
          duplicatePlanInput
      }),
    /Duplicate plan for task/
  );

  console.log(
    "[PASS] duplicate plan rejected"
  );

  console.log(
    "\n[11] NON-INTERFERENCE SNAPSHOT"
  );

  const safeSchedule =
    createScheduleFixture(
      project,
      tasks,
      plans
    );

  const taskFileBefore =
    snapshotFile(TASK_FILE);

  const projectFileBefore =
    snapshotFile(PROJECT_FILE);

  const scheduleFileBefore =
    snapshotFile(SCHEDULE_FILE);

  evaluateProjectExecutionReadiness({
    projectId:
      project.projectId,
    scheduleId:
      safeSchedule.scheduleId,
    plans:
      plans.map(plan => ({
        taskId:
          plan.taskId,
        plan
      }))
  });

  assert.strictEqual(
    snapshotFile(TASK_FILE),
    taskFileBefore
  );

  assert.strictEqual(
    snapshotFile(PROJECT_FILE),
    projectFileBefore
  );

  assert.strictEqual(
    snapshotFile(SCHEDULE_FILE),
    scheduleFileBefore
  );

  console.log(
    "[PASS] readiness evaluation does not mutate task/project/schedule stores"
  );

  console.log(
    "\n[12] BASELINE SAFETY CHECK"
  );

  const finalTaskSummary =
    getTaskSummary();

  const finalActiveTaskIds =
    new Set(
      listTasks()
        .filter(task => task.status === "active")
        .map(task => task.id)
    );

  const expectedActiveTaskIds =
    new Set(baselineActiveTaskIds);

  expectedActiveTaskIds.add(tasks[0].id);

  assert.strictEqual(
    finalTaskSummary.active,
    expectedActiveTaskIds.size,
    "Unexpected number of active tasks after readiness evaluation"
  );

  assert.deepStrictEqual(
    [...finalActiveTaskIds].sort(),
    [...expectedActiveTaskIds].sort(),
    "Readiness evaluation changed the active-task set unexpectedly"
  );

  console.log(
    "[PASS] task system remained structurally intact"
  );

  console.log(
    "\n========================================"
  );

  console.log(
    "STAGE926_PROJECT_EXECUTION_READINESS_SERVICE_UNIT_TEST: PASS"
  );

  console.log(
    "========================================"
  );
}

main();
