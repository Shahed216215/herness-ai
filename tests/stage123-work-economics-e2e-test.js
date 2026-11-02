"use strict";

const assert = require("assert");

const {
  analyzeWorkEconomics
} = require(
  "../services/mira-work-economics-engine"
);

function run() {
  console.log(
    "\n=== STAGE 12.3 WORK ECONOMICS E2E ==="
  );

  const tasks = [
    {
      id: "task-research-1",
      type: "research",
      requiredSkills: [
        "research",
        "analysis"
      ]
    },
    {
      id: "task-writing-1",
      type: "writing",
      requiredSkills: [
        "writing",
        "quality-validation"
      ]
    },
    {
      id: "task-writing-2",
      type: "writing",
      requiredSkills: [
        "writing",
        "quality-validation"
      ]
    }
  ];

  const learningRecords = [
    {
      learningId: "learning-1",
      taskId: "task-research-1",
      task: {
        type: "research",
        requiredSkills: [
          "research",
          "analysis"
        ]
      },
      execution: {
        durationMinutes: 90
      },
      qa: {
        status: "qa_passed",
        success: true,
        reworkRequired: false,
        finalAcceptance: true
      },
      status: "proposal_created"
    },
    {
      learningId: "learning-2",
      taskId: "task-writing-1",
      task: {
        type: "writing",
        requiredSkills: [
          "writing",
          "quality-validation"
        ]
      },
      execution: {
        durationMinutes: 120
      },
      qa: {
        status: "qa_failed",
        success: false,
        reworkRequired: true,
        finalAcceptance: false,
        failedChecks: [
          "requirements",
          "quality"
        ]
      },
      revisionCount: 2,
      status: "proposal_created"
    },
    {
      learningId: "learning-3",
      taskId: "task-writing-2",
      task: {
        type: "writing",
        requiredSkills: [
          "writing",
          "quality-validation"
        ]
      },
      execution: {
        durationMinutes: 60
      },
      qa: {
        status: "qa_passed",
        success: true,
        reworkRequired: false,
        finalAcceptance: true
      },
      status: "proposal_created"
    }
  ];

  const costs = [
    {
      id: "cost-api-1",
      type: "tool_api",
      toolName: "research-api",
      amount: 12,
      currency: "USD"
    },
    {
      id: "cost-api-2",
      type: "tool_api",
      toolName: "research-api",
      amount: 8,
      currency: "USD"
    },
    {
      id: "cost-api-3",
      type: "tool_api",
      toolName: "writer-api",
      amount: 5,
      currency: "USD"
    }
  ];

  const result =
    analyzeWorkEconomics({
      tasks,
      learningRecords,
      costs
    });

  assert.strictEqual(result.ok, true);

  assert.strictEqual(
    result.accountingOnly,
    true
  );

  assert.strictEqual(
    result.moneyTransferEnabled,
    false
  );

  assert.strictEqual(
    result.financialCommitmentEnabled,
    false
  );

  assert.strictEqual(
    result.recordCount,
    3
  );

  const writing =
    result.workTypes.find(
      item => item.key === "writing"
    );

  const research =
    result.workTypes.find(
      item => item.key === "research"
    );

  assert.ok(writing);
  assert.ok(research);

  assert.strictEqual(
    writing.totalMinutes,
    180
  );

  assert.strictEqual(
    writing.medianMinutes,
    90
  );

  assert.strictEqual(
    research.totalMinutes,
    90
  );

  assert.strictEqual(
    writing.reworkCount,
    1
  );

  assert.strictEqual(
    writing.reworkRate,
    0.5
  );

  const writingOutcome =
    result.outcomes.find(
      item => item.workType === "writing"
    );

  assert.ok(writingOutcome);

  assert.strictEqual(
    writingOutcome.workCount,
    2
  );

  assert.strictEqual(
    writingOutcome.successCount,
    1
  );

  assert.strictEqual(
    writingOutcome.failureCount,
    1
  );

  assert.strictEqual(
    writingOutcome.completionRate,
    0.5
  );

  const researchSkill =
    result.skills.find(
      item => item.skill === "research"
    );

  const writingSkill =
    result.skills.find(
      item => item.skill === "writing"
    );

  assert.ok(researchSkill);
  assert.ok(writingSkill);

  assert.strictEqual(
    researchSkill.usageCount,
    1
  );

  assert.strictEqual(
    writingSkill.usageCount,
    2
  );

  const researchApi =
    result.tools.find(
      item => item.tool === "research-api"
    );

  assert.ok(researchApi);

  assert.strictEqual(
    researchApi.totalCost,
    20
  );

  const topTime =
    result.insights.find(
      item =>
        item.signal ===
        "highest_total_recorded_time"
    );

  assert.ok(topTime);
  assert.strictEqual(
    topTime.workType,
    "writing"
  );

  const topSkill =
    result.insights.find(
      item =>
        item.signal ===
        "most_used_skill"
    );

  assert.ok(topSkill);
  assert.strictEqual(
    topSkill.value,
    2
  );
  assert.ok(
    [
      "writing",
      "quality-validation"
    ].includes(topSkill.skill)
  );

  const topRework =
    result.insights.find(
      item =>
        item.signal ===
        "highest_rework_rate"
    );

  assert.ok(topRework);
  assert.strictEqual(
    topRework.workType,
    "writing"
  );

  const topTool =
    result.insights.find(
      item =>
        item.signal ===
        "highest_recorded_tool_cost"
    );

  assert.ok(topTool);
  assert.strictEqual(
    topTool.tool,
    "research-api"
  );

  console.log(
    "TIME_BY_WORK_TYPE: PASS"
  );

  console.log(
    "SKILL_USAGE: PASS"
  );

  console.log(
    "REWORK_ANALYSIS: PASS"
  );

  console.log(
    "TOOL_COST_ANALYSIS: PASS"
  );

  console.log(
    "WORK_OUTCOMES: PASS"
  );

  console.log(
    "DATA_DRIVEN_INSIGHTS: PASS"
  );

  /*
   * Empty-data safety.
   */
  const empty =
    analyzeWorkEconomics({
      tasks: [],
      learningRecords: [],
      costs: []
    });

  assert.strictEqual(
    empty.recordCount,
    0
  );

  assert.strictEqual(
    empty.workTypes.length,
    0
  );

  assert.ok(
    empty.insights.some(
      item =>
        item.signal ===
        "no_work_records"
    )
  );

  console.log(
    "EMPTY_DATA_SAFETY: PASS"
  );

  /*
   * Missing duration must remain missing.
   */
  const noDuration =
    analyzeWorkEconomics({
      workRecords: [
        {
          id: "no-duration",
          type: "research",
          requiredSkills: [
            "research"
          ],
          status: "completed"
        }
      ],
      costs: []
    });

  assert.strictEqual(
    noDuration.workTypes[0]
      .totalMinutes,
    null
  );

  assert.ok(
    noDuration.insights.some(
      item =>
        item.signal ===
        "duration_not_measured"
    )
  );

  console.log(
    "NO_DURATION_FABRICATION: PASS"
  );

  /*
   * Currency safety: USD + EUR must not be
   * added together.
   */
  const multiCurrency =
    analyzeWorkEconomics({
      workRecords: [],
      costs: [
        {
          id: "usd",
          type: "tool_api",
          toolName: "api-usd",
          amount: 10,
          currency: "USD"
        },
        {
          id: "eur",
          type: "tool_api",
          toolName: "api-eur",
          amount: 100,
          currency: "EUR"
        }
      ]
    });

  assert.ok(
    multiCurrency.insights.some(
      item =>
        item.signal ===
        "currency_grouping_required"
    )
  );

  console.log(
    "CURRENCY_SAFETY: PASS"
  );

  console.log(
    "STAGE12_3_WORK_ECONOMICS_E2E: PASS"
  );

  console.log(
    "=== STAGE 12.3 COMPLETE ===\n"
  );
}

try {
  run();
} catch (error) {
  console.error(
    "STAGE12_3_WORK_ECONOMICS_E2E: FAIL"
  );
  console.error(
    error && error.stack
      ? error.stack
      : error
  );
  process.exitCode = 1;
}
