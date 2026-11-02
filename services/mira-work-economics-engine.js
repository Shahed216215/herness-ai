"use strict";

/**
 * Mira Work Economics Engine
 * Stage 12.3
 *
 * PURPOSE
 * -------
 * Read-only, data-driven analysis of completed/recorded work.
 *
 * It answers:
 *   - Which work types consume the most recorded time?
 *   - Which skills appear most often?
 *   - Where is rework most common?
 *   - Which recorded tools have the highest cost?
 *   - What outcomes are associated with each work type?
 *
 * SAFETY
 * ------
 * This module performs analysis only.
 * It does NOT:
 *   - transfer money
 *   - spend money
 *   - purchase tools
 *   - change prices
 *   - make investment decisions
 *   - commit to clients
 *   - modify earnings or cost ledgers
 *
 * Missing measurements remain missing. No estimated duration/cost is
 * invented merely to make an analysis look complete.
 */

const VERSION = "12.3.0";

const OUTCOME_STATUSES = new Set([
  "completed",
  "success",
  "succeeded",
  "accepted",
  "qa_passed",
  "failed",
  "failure",
  "rejected",
  "cancelled",
  "blocked",
  "in_progress",
  "new"
]);

const NUMBER_KEYS = Object.freeze([
  "durationMinutes",
  "duration",
  "timeMinutes",
  "minutes",
  "elapsedMinutes",
  "executionMinutes",
  "workDurationMinutes",
  "totalDurationMinutes"
]);

const SKILL_KEYS = Object.freeze([
  "requiredSkills",
  "skills",
  "usedSkills",
  "capabilities"
]);

const TOOL_KEYS = Object.freeze([
  "tool",
  "toolName",
  "toolId",
  "tools",
  "usedTools",
  "toolCalls"
]);

const WORK_TYPE_KEYS = Object.freeze([
  "workType",
  "taskType",
  "type",
  "category"
]);

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap(item => {
        if (typeof item === "string") return [item];
        if (item && typeof item === "object") {
          return [
            item.name,
            item.id,
            item.skill,
            item.skillId,
            item.tool,
            item.toolName,
            item.toolId
          ];
        }
        return [];
      })
      .map(cleanString)
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n|]/)
      .map(cleanString)
      .filter(Boolean);
  }

  return [];
}

function firstNumber(objects, keys) {
  for (const object of objects) {
    if (!object || typeof object !== "object") continue;

    for (const key of keys) {
      const value = finiteNumber(object[key]);
      if (value !== null && value >= 0) return value;
    }
  }

  return null;
}

function firstList(objects, keys) {
  const result = [];

  for (const object of objects) {
    if (!object || typeof object !== "object") continue;

    for (const key of keys) {
      result.push(...normalizeList(object[key]));
    }
  }

  return [...new Set(result)];
}

function firstString(objects, keys) {
  for (const object of objects) {
    if (!object || typeof object !== "object") continue;

    for (const key of keys) {
      const value = cleanString(object[key]);
      if (value) return value;
    }
  }

  return "";
}

function percentile(sorted, p) {
  if (!sorted.length) return null;

  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower];

  return (
    sorted[lower] +
    (sorted[upper] - sorted[lower]) * (index - lower)
  );
}

function durationStats(values) {
  const valid = values
    .map(finiteNumber)
    .filter(value => value !== null && value >= 0)
    .sort((a, b) => a - b);

  if (!valid.length) {
    return {
      measuredCount: 0,
      totalMinutes: null,
      averageMinutes: null,
      medianMinutes: null,
      p90Minutes: null
    };
  }

  const total = valid.reduce((sum, value) => sum + value, 0);

  return {
    measuredCount: valid.length,
    totalMinutes: total,
    averageMinutes: total / valid.length,
    medianMinutes: percentile(valid, 0.5),
    p90Minutes: percentile(valid, 0.9)
  };
}

function normalizeOutcome(item, learning) {
  const qa = item?.qa || learning?.qa || {};

  const status = cleanString(
    qa.status ||
    item?.outcomeStatus ||
    item?.resultStatus ||
    item?.status ||
    learning?.status
  ).toLowerCase();

  if (qa.success === true) return "success";
  if (qa.success === false) return "failure";

  if (OUTCOME_STATUSES.has(status)) return status;

  if (qa.finalAcceptance === true) return "accepted";

  return status || "unknown";
}

function normalizeRework(item, learning) {
  const qa = item?.qa || learning?.qa || {};

  if (
    qa.reworkRequired === true ||
    qa.rework === true ||
    item?.reworkRequired === true ||
    item?.rework === true
  ) {
    return true;
  }

  const revisions = [
    item?.revisionCount,
    item?.revisions,
    item?.reworkCount,
    learning?.revisionCount,
    learning?.reworkCount
  ];

  if (
    revisions.some(value => {
      const n = finiteNumber(value);
      return n !== null && n > 0;
    })
  ) {
    return true;
  }

  if (
    Array.isArray(qa.failedChecks) &&
    qa.failedChecks.length > 0
  ) {
    return qa.reworkRequired === true;
  }

  return false;
}

function normalizeRecord(item, learning) {
  const task =
    item?.task && typeof item.task === "object"
      ? item.task
      : {};

  const whatWasRequired =
    learning?.whatWasRequired &&
    typeof learning.whatWasRequired === "object"
      ? learning.whatWasRequired
      : {};

  /*
   * Skills are taken only from fields that explicitly represent
   * skills. We do not scan arbitrary objects because fields such
   * as names/ids/tool metadata can otherwise contaminate analytics.
   */
  const skillSources = [
    task.requiredSkills,
    item?.requiredSkills,
    whatWasRequired.requiredSkills,
    learning?.requiredSkills,
    item?.usedSkills,
    learning?.usedSkills
  ];

  const skills = [
    ...new Set(
      skillSources.flatMap(value =>
        normalizeList(value)
      )
    )
  ];

  /*
   * Tool references are similarly restricted to explicit tool
   * fields. Skill names must never become tool names.
   */
  const toolSources = [
    item?.tool,
    item?.toolName,
    item?.usedTools,
    item?.toolCalls,
    learning?.tool,
    learning?.toolName,
    learning?.usedTools,
    learning?.toolCalls,
    item?.execution?.tool,
    item?.execution?.toolName,
    item?.execution?.usedTools,
    item?.execution?.toolCalls,
    learning?.execution?.tool,
    learning?.execution?.toolName,
    learning?.execution?.usedTools,
    learning?.execution?.toolCalls
  ];

  const tools = [
    ...new Set(
      toolSources.flatMap(value =>
        normalizeList(value)
      )
    )
  ];

  const workType =
    firstString(
      [
        whatWasRequired,
        task,
        item,
        learning
      ],
      WORK_TYPE_KEYS
    ) || "unknown";

  const durationMinutes =
    firstNumber(
      [
        item?.execution,
        learning?.execution,
        item,
        learning
      ],
      NUMBER_KEYS
    );

  const outcome =
    normalizeOutcome(item, learning);

  const taskId =
    firstString(
      [item, learning, task],
      ["taskId"]
    );

  return {
    taskId,
    workType,
    skills,
    tools,
    durationMinutes,
    outcome,
    rework: normalizeRework(item, learning)
  };
}

function normalizeInputs(input = {}) {
  const tasks = Array.isArray(input.tasks)
    ? input.tasks
    : [];

  const learningRecords =
    Array.isArray(input.learningRecords)
      ? input.learningRecords
      : [];

  const workRecords =
    Array.isArray(input.workRecords)
      ? input.workRecords
      : [];

  const byTaskId = new Map();

  for (const task of tasks) {
    if (task && task.id) {
      byTaskId.set(task.id, task);
    }
  }

  const records = [];

  for (const item of workRecords) {
    const task =
      item?.taskId
        ? byTaskId.get(item.taskId)
        : undefined;

    records.push(
      normalizeRecord(
        {
          ...task,
          ...item,
          task
        },
        null
      )
    );
  }

  for (const learning of learningRecords) {
    const task =
      learning?.taskId
        ? byTaskId.get(learning.taskId)
        : undefined;

    records.push(
      normalizeRecord(
        {
          ...task,
          ...learning,
          task
        },
        learning
      )
    );
  }

  /*
   * If no work/learning record exists, tasks themselves are still
   * useful for skill/work-type inventory. They simply have no
   * fabricated duration/outcome.
   */
  if (!records.length) {
    for (const task of tasks) {
      records.push(normalizeRecord(task, null));
    }
  }

  return {
    tasks,
    learningRecords,
    workRecords,
    records
  };
}

function createBucket(key) {
  return {
    key,
    workCount: 0,
    measuredDurationCount: 0,
    totalMinutes: null,
    averageMinutes: null,
    medianMinutes: null,
    p90Minutes: null,
    reworkCount: 0,
    reworkRate: null,
    outcomes: {}
  };
}

function addOutcome(bucket, outcome) {
  const key = outcome || "unknown";
  bucket.outcomes[key] =
    (bucket.outcomes[key] || 0) + 1;
}

function finalizeBucket(bucket, durations) {
  const stats = durationStats(durations);

  bucket.measuredDurationCount =
    stats.measuredCount;

  bucket.totalMinutes =
    stats.totalMinutes;

  bucket.averageMinutes =
    stats.averageMinutes;

  bucket.medianMinutes =
    stats.medianMinutes;

  bucket.p90Minutes =
    stats.p90Minutes;

  bucket.reworkRate =
    bucket.workCount > 0
      ? bucket.reworkCount / bucket.workCount
      : null;

  return bucket;
}

function analyzeWorkTypes(records) {
  const map = new Map();
  const durations = new Map();

  for (const record of records) {
    const key = record.workType || "unknown";

    if (!map.has(key)) {
      map.set(key, createBucket(key));
      durations.set(key, []);
    }

    const bucket = map.get(key);

    bucket.workCount++;

    if (record.durationMinutes !== null) {
      durations.get(key).push(
        record.durationMinutes
      );
    }

    if (record.rework) {
      bucket.reworkCount++;
    }

    addOutcome(bucket, record.outcome);
  }

  return [...map.values()]
    .map(bucket =>
      finalizeBucket(
        bucket,
        durations.get(bucket.key) || []
      )
    )
    .sort((a, b) => {
      const aTime =
        a.totalMinutes === null
          ? -1
          : a.totalMinutes;
      const bTime =
        b.totalMinutes === null
          ? -1
          : b.totalMinutes;

      return bTime - aTime;
    });
}

function analyzeSkills(records) {
  const map = new Map();

  for (const record of records) {
    for (const skill of record.skills) {
      if (!map.has(skill)) {
        map.set(skill, {
          skill,
          usageCount: 0,
          workTypes: {},
          reworkCount: 0
        });
      }

      const bucket = map.get(skill);

      bucket.usageCount++;

      const type =
        record.workType || "unknown";

      bucket.workTypes[type] =
        (bucket.workTypes[type] || 0) + 1;

      if (record.rework) {
        bucket.reworkCount++;
      }
    }
  }

  return [...map.values()]
    .map(item => ({
      ...item,
      reworkRate:
        item.usageCount > 0
          ? item.reworkCount / item.usageCount
          : null
    }))
    .sort((a, b) =>
      b.usageCount - a.usageCount
    );
}

function analyzeRework(records) {
  const byType = new Map();

  for (const record of records) {
    const key = record.workType || "unknown";

    if (!byType.has(key)) {
      byType.set(key, {
        workType: key,
        workCount: 0,
        reworkCount: 0
      });
    }

    const bucket = byType.get(key);

    bucket.workCount++;

    if (record.rework) {
      bucket.reworkCount++;
    }
  }

  const workTypes = [...byType.values()]
    .map(item => ({
      ...item,
      reworkRate:
        item.workCount > 0
          ? item.reworkCount /
            item.workCount
          : null
    }))
    .sort((a, b) => {
      const ar = a.reworkRate ?? -1;
      const br = b.reworkRate ?? -1;
      return br - ar;
    });

  const totalWork = records.length;

  const totalRework = records.filter(
    record => record.rework
  ).length;

  return {
    totalWork,
    totalRework,
    reworkRate:
      totalWork > 0
        ? totalRework / totalWork
        : null,
    byWorkType: workTypes
  };
}

function normalizeCosts(costs) {
  if (!Array.isArray(costs)) return [];

  return costs
    .filter(
      cost =>
        cost &&
        typeof cost === "object"
    )
    .map(cost => ({
      id: cleanString(cost.id),
      type: cleanString(cost.type) || "unknown",
      tool:
        firstString(
          [cost],
          [
            "tool",
            "toolName",
            "toolId"
          ]
        ) || "unknown",
      amount: finiteNumber(
        cost.amount ??
        cost.cost ??
        cost.value
      ),
      currency:
        cleanString(cost.currency)
          .toUpperCase() || "UNKNOWN",
      projectId:
        cleanString(cost.projectId),
      earningId:
        cleanString(cost.earningId)
    }))
    .filter(cost =>
      cost.amount !== null &&
      cost.amount >= 0
    );
}

function analyzeTools(costs) {
  const normalized = normalizeCosts(costs);

  const byTool = new Map();

  for (const cost of normalized) {
    const key = cost.tool;

    if (!byTool.has(key)) {
      byTool.set(key, {
        tool: key,
        costCount: 0,
        totalCost: 0,
        currencies: {},
        costTypes: {}
      });
    }

    const bucket = byTool.get(key);

    bucket.costCount++;
    bucket.totalCost += cost.amount;

    bucket.currencies[cost.currency] =
      (bucket.currencies[cost.currency] || 0) +
      cost.amount;

    bucket.costTypes[cost.type] =
      (bucket.costTypes[cost.type] || 0) + 1;
  }

  return [...byTool.values()]
    .sort((a, b) =>
      b.totalCost - a.totalCost
    );
}

function analyzeOutcomes(records) {
  const byType = new Map();

  for (const record of records) {
    const key = record.workType || "unknown";

    if (!byType.has(key)) {
      byType.set(key, {
        workType: key,
        workCount: 0,
        outcomes: {},
        successCount: 0,
        failureCount: 0,
        completionRate: null
      });
    }

    const bucket = byType.get(key);

    bucket.workCount++;
    addOutcome(bucket, record.outcome);

    if (
      [
        "completed",
        "success",
        "succeeded",
        "accepted",
        "qa_passed"
      ].includes(record.outcome)
    ) {
      bucket.successCount++;
    }

    if (
      [
        "failed",
        "failure",
        "rejected"
      ].includes(record.outcome)
    ) {
      bucket.failureCount++;
    }
  }

  return [...byType.values()]
    .map(bucket => ({
      ...bucket,
      completionRate:
        bucket.workCount > 0
          ? bucket.successCount /
            bucket.workCount
          : null
    }))
    .sort((a, b) =>
      b.successCount - a.successCount
    );
}

function buildInsights(
  records,
  workTypes,
  skills,
  rework,
  tools,
  outcomes
) {
  const insights = [];

  const timed = workTypes.filter(
    item =>
      item.measuredDurationCount > 0
  );

  if (timed.length) {
    const highestTotal = [...timed]
      .sort(
        (a, b) =>
          (b.totalMinutes ?? 0) -
          (a.totalMinutes ?? 0)
      )[0];

    const highestMedian = [...timed]
      .sort(
        (a, b) =>
          (b.medianMinutes ?? 0) -
          (a.medianMinutes ?? 0)
      )[0];

    insights.push({
      type: "time",
      signal: "highest_total_recorded_time",
      workType: highestTotal.key,
      value: highestTotal.totalMinutes,
      unit: "minutes",
      message:
        `${highestTotal.key} has the highest total recorded work time.`
    });

    insights.push({
      type: "time",
      signal: "highest_median_duration",
      workType: highestMedian.key,
      value: highestMedian.medianMinutes,
      unit: "minutes",
      message:
        `${highestMedian.key} has the highest median recorded duration.`
    });
  }

  if (skills.length) {
    const top = skills[0];

    insights.push({
      type: "skill",
      signal: "most_used_skill",
      skill: top.skill,
      value: top.usageCount,
      unit: "uses",
      message:
        `${top.skill} is the most frequently recorded skill.`
    });
  }

  if (
    rework.totalWork > 0 &&
    rework.totalRework > 0
  ) {
    const topRework =
      rework.byWorkType
        .filter(
          item => item.reworkCount > 0
        )
        .sort(
          (a, b) =>
            (b.reworkRate ?? 0) -
            (a.reworkRate ?? 0)
        )[0];

    insights.push({
      type: "rework",
      signal: "highest_rework_rate",
      workType:
        topRework?.workType || "unknown",
      value:
        topRework?.reworkRate ?? null,
      unit: "ratio",
      message:
        `${topRework?.workType || "unknown"} has the highest recorded rework rate.`
    });
  }

  if (tools.length) {
    const currencies =
      new Set(
        tools.flatMap(item =>
          Object.keys(item.currencies)
        )
      );

    /*
     * Cost totals are only safely comparable when all
     * recorded tool costs use one currency.
     */
    if (currencies.size === 1) {
      const top = tools[0];

      insights.push({
        type: "tool_cost",
        signal: "highest_recorded_tool_cost",
        tool: top.tool,
        value: top.totalCost,
        currency: [...currencies][0],
        message:
          `${top.tool} has the highest recorded tool cost in the available currency data.`
      });
    } else {
      insights.push({
        type: "tool_cost",
        signal: "currency_grouping_required",
        value: currencies.size,
        message:
          "Tool costs use multiple currencies, so cross-currency totals are not combined."
      });
    }
  }

  const successfulOutcomes =
    outcomes.filter(
      item => item.successCount > 0
    );

  if (successfulOutcomes.length) {
    const best = [...successfulOutcomes]
      .sort(
        (a, b) =>
          (b.completionRate ?? 0) -
          (a.completionRate ?? 0)
      )[0];

    insights.push({
      type: "outcome",
      signal: "highest_recorded_success_rate",
      workType: best.workType,
      value: best.completionRate,
      unit: "ratio",
      message:
        `${best.workType} has the highest recorded success/acceptance rate among measured outcomes.`
    });
  }

  if (!records.length) {
    insights.push({
      type: "data_quality",
      signal: "no_work_records",
      message:
        "No work records were available for economics analysis."
    });
  }

  if (
    records.length &&
    !records.some(
      record =>
        record.durationMinutes !== null
    )
  ) {
    insights.push({
      type: "data_quality",
      signal: "duration_not_measured",
      message:
        "No recorded duration was available; time metrics are not estimated."
    });
  }

  return insights;
}

function analyzeWorkEconomics(input = {}) {
  const normalized =
    normalizeInputs(input);

  const records =
    normalized.records;

  const workTypes =
    analyzeWorkTypes(records);

  const skills =
    analyzeSkills(records);

  const rework =
    analyzeRework(records);

  const tools =
    analyzeTools(input.costs);

  const outcomes =
    analyzeOutcomes(records);

  const insights =
    buildInsights(
      records,
      workTypes,
      skills,
      rework,
      tools,
      outcomes
    );

  return {
    ok: true,
    engine: "mira-work-economics",
    version: VERSION,
    accountingOnly: true,
    moneyTransferEnabled: false,
    financialCommitmentEnabled: false,
    recordCount: records.length,
    dataCoverage: {
      durationMeasured:
        records.filter(
          item =>
            item.durationMinutes !== null
        ).length,
      skillsRecorded:
        records.filter(
          item => item.skills.length > 0
        ).length,
      toolsReferenced:
        records.filter(
          item => item.tools.length > 0
        ).length,
      outcomeRecorded:
        records.filter(
          item => item.outcome !== "unknown"
        ).length,
      reworkRecorded:
        records.filter(
          item => item.rework
        ).length
    },
    workTypes,
    skills,
    rework,
    tools,
    outcomes,
    insights
  };
}

module.exports = {
  VERSION,
  normalizeRecord,
  analyzeWorkEconomics,
  analyzeWorkTypes,
  analyzeSkills,
  analyzeRework,
  analyzeTools,
  analyzeOutcomes
};
