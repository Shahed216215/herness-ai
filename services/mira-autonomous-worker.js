"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require("../mira-storage");
const { listTasks, updateTaskStatus } = require("../task-store");
const { executeWork } = require("./mira-work-execution-engine");
const {
  getGovernanceSnapshot,
  reserveResearchBudget
} = require("./mira-research-governance");

let running = false;
let timer = null;
// In-process round-robin state; resets safely on worker restart.
let lastProcessedType = null;

const MAX_TASKS_PER_TICK = 1;
const MAX_RESEARCH_REQUESTS_PER_UTC_DAY = 3;

function getCalculatorExpression(task) {
  if (!task || typeof task !== "object") return null;

  for (const value of [task.title, task.description]) {
    if (typeof value !== "string") continue;

    const match = value.trim().match(
      /^calculate\s+([0-9+\-*/().%\s]+)$/i
    );

    if (match && match[1].trim()) return match[1].trim();
  }

  return null;
}

function appendResult(record) {
  const outputFile = process.env.MIRA_WORKER_RESULTS_FILE ||
    storagePath("data/autonomous-worker-results.jsonl");

  fs.mkdirSync(path.dirname(outputFile), {
    recursive: true,
    mode: 0o700
  });

  fs.appendFileSync(
    outputFile,
    JSON.stringify({
      recordedAt: new Date().toISOString(),
      ...record,
      status: record.success ? "completed" : "waiting"
    }) + "\n",
    { encoding: "utf8", mode: 0o600 }
  );
}

/*
 * Conservative first pilot:
 * - only new, low-risk research tasks;
 * - no arbitrary commands or user-supplied output paths;
 * - reject topics that appear to request consequential actions,
 *   credential handling, exploitation, or self-modification.
 * Risk labels alone are not treated as authorization.
 */
function getResearchQuery(task) {
  if (!task || typeof task !== "object") return null;
  if (!["research", "web_research"].includes(task.type)) return null;
  if (task.status !== "new" || task.risk !== "low") return null;

  const title = String(task.title || "").trim();
  const description = String(task.description || "").trim();
  if (!title || title.length > 240 || description.length > 2000) {
    return null;
  }

  const combined = `${title}\n${description}`;

  const blocked = /\b(teleport|delete|deploy|payment|purchase|credential|password|secret|token|bypass|exploit|malware|ransomware|weapon|bomb|self[- ]modify|modify\s+code|execute\s+code|shell\s+command|send\s+email|exfiltrat\w*|unauthori[sz]ed|break\s+into)\b/i;

  if (blocked.test(combined)) return null;

  const query = title
    .replace(/\s+/g, " ")
    .replace(/[<>`]/g, "")
    .trim()
    .slice(0, 240);

  if (query.length < 8) return null;
  return query;
}

function defaultBudgetFile(storagePathFn) {
  return storagePathFn("data/autonomous-research-budget.json");
}

function readBudget(file, day) {
  let raw;

  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { day, count: 0 };
    }
    throw new Error("Research budget unavailable; refusing search.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error("Research budget is invalid; refusing search.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.day !== "string" ||
    !Number.isInteger(parsed.count) ||
    parsed.count < 0
  ) {
    throw new Error("Research budget is invalid; refusing search.");
  }

  if (parsed.day !== day) return { day, count: 0 };
  return { day, count: parsed.count };
}

function writeBudget(file, budget) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(
    temp,
    JSON.stringify(budget, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 }
  );
  fs.renameSync(temp, file);
}

function consumeResearchBudget(file, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const budget = readBudget(file, day);

  if (budget.count >= MAX_RESEARCH_REQUESTS_PER_UTC_DAY) {
    return { allowed: false, day, count: budget.count };
  }

  budget.count += 1;
  writeBudget(file, budget);
  return { allowed: true, day, count: budget.count };
}

function collectStrings(value, output, depth = 0) {
  if (depth > 5 || value == null) return;

  if (typeof value === "string") {
    output.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return;
  }

  if (typeof value === "object") {
    for (const key of ["result", "output", "content", "data", "text"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        collectStrings(value[key], output, depth + 1);
      }
    }
  }
}

function extractSources(outcome) {
  const strings = [];
  collectStrings(outcome && outcome.results, strings);
  if (outcome && typeof outcome.result === "string") {
    strings.push(outcome.result);
  }

  const sources = [];
  const seen = new Set();

  for (const text of strings) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      continue;
    }

    if (!Array.isArray(parsed)) continue;

    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;

      const url = typeof item.link === "string"
        ? item.link
        : typeof item.url === "string" ? item.url : "";

      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (_) {
        continue;
      }

      if (!["http:", "https:"].includes(parsedUrl.protocol)) continue;
      if (seen.has(parsedUrl.href)) continue;
      seen.add(parsedUrl.href);

      sources.push({
        title: String(item.title || "Untitled source")
          .replace(/\s+/g, " ").slice(0, 300),
        url: parsedUrl.href.slice(0, 2000),
        snippet: String(item.snippet || item.content || "")
          .replace(/\s+/g, " ").slice(0, 1500)
      });

      if (sources.length >= 5) return sources;
    }
  }

  return sources;
}

function writeResearchReport(task, query, sources, storagePathFn) {
  const reportDir = storagePathFn("reports");
  fs.mkdirSync(reportDir, { recursive: true, mode: 0o700 });

  const safeId = String(task.id || "unknown")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 100);

  const filename = `mira-research-${safeId}.md`;
  const finalPath = path.join(reportDir, filename);

  // Keep the destination inside the fixed report directory.
  if (path.dirname(path.resolve(finalPath)) !== path.resolve(reportDir)) {
    throw new Error("Research report path validation failed");
  }

  const body = [
    `# Research report: ${String(task.title || safeId).slice(0, 240)}`,
    "",
    `- Task ID: ${safeId}`,
    `- Generated (UTC): ${new Date().toISOString()}`,
    `- Search query: ${query}`,
    `- Sources found: ${sources.length}`,
    "",
    "## Sources",
    "",
    ...sources.flatMap((source, index) => [
      `### ${index + 1}. ${source.title}`,
      "",
      `- URL: ${source.url}`,
      `- Snippet: ${source.snippet || "(No snippet returned)"}`,
      ""
    ]),
    "## Limitations",
    "",
    "This report records search-result metadata. Sources have not been independently verified, and snippets are not a substitute for reading the full pages.",
    ""
  ].join("\n");

  const tempPath = `${finalPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, body, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(tempPath, finalPath);

  return finalPath;
}

async function runOnce(overrides = {}) {
  if (running) {
    return { status: "already_running", processed: 0 };
  }

  running = true;

  const listTasksFn = overrides.listTasksFn || listTasks;
  const updateTaskStatusFn = overrides.updateTaskStatusFn || updateTaskStatus;
  const executeWorkFn = overrides.executeWorkFn || executeWork;
  const storagePathFn = overrides.storagePathFn || storagePath;
  const budgetFile = overrides.budgetFile || defaultBudgetFile(storagePathFn);

  try {
    // Preserve the existing calculator-only workflow.
    const tasks = listTasksFn({ status: "new", risk: "low" }) || [];
    const calculator = tasks
      .map(task => ({ task, expression: getCalculatorExpression(task) }))
      .filter(item => item.expression)
      .slice(0, MAX_TASKS_PER_TICK);

    // If calculator ran last time, yield this tick to eligible research.
    // Research opt-in and the existing governance/budget gates remain required.
    const yieldToResearch =
      process.env.MIRA_AUTONOMOUS_RESEARCH_ENABLED === "true" &&
      lastProcessedType === "calculator" &&
      tasks.some(task => getResearchQuery(task));

    if (calculator.length && !yieldToResearch) {
      let processed = 0;

      for (const item of calculator) {
        const { task, expression } = item;
        updateTaskStatusFn(task.id, "active");

        const outcome = await executeWorkFn(`Calculate ${expression}`, {
          persist: false,
          permissionGranted: true,
          toolCalls: [{
            name: "calculator",
            args: { expression }
          }]
        });

        appendResult({
          taskId: task.id,
          type: "calculator",
          success: Boolean(outcome && outcome.success),
          outcome,
          timestamp: new Date().toISOString()
        });

        updateTaskStatusFn(
          task.id,
          outcome && outcome.success ? "completed" : "waiting"
        );
        processed += 1;
      }

      if (processed > 0) lastProcessedType = "calculator";
      return { status: "tick_completed", processed };
    }

    // Research has its own independent opt-in. No opt-in means no search.
    if (process.env.MIRA_AUTONOMOUS_RESEARCH_ENABLED !== "true") {
      return { status: "research_opt_in_required", processed: 0 };
    }

    const governanceFile = overrides.governanceFile;
    const snapshot = getGovernanceSnapshot({
      file: governanceFile,
      now: overrides.now || new Date()
    });
    const approvedIds = new Set(
      snapshot.approvals
        .filter(item => item.status === "approved")
        .map(item => item.taskId)
    );

    const dateValue = value => {
      if (!value) return Number.POSITIVE_INFINITY;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };

    const eligible = tasks
      .map(task => ({
        task,
        query: getResearchQuery(task),
        urgent: approvedIds.has(task.id)
      }))
      .filter(item => item.query)
      .sort((a, b) => {
        if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
        const deadlineDiff =
          dateValue(a.task.deadline) - dateValue(b.task.deadline);
        if (deadlineDiff !== 0) return deadlineDiff;
        const createdDiff =
          dateValue(a.task.createdAt) - dateValue(b.task.createdAt);
        if (createdDiff !== 0) return createdDiff;
        return String(a.task.id).localeCompare(String(b.task.id));
      })
      .slice(0, MAX_TASKS_PER_TICK);

    if (!eligible.length) {
      return { status: "no_eligible_task", processed: 0 };
    }

    const { task, query, urgent } = eligible[0];
    // Record the turn even if budget blocks the search, so calculators
    // continue to get turns instead of either task type monopolizing ticks.
    lastProcessedType = "research";
    const quota = reserveResearchBudget(
      { taskId: task.id, urgent },
      {
        file: governanceFile,
        legacyBudgetFile: budgetFile,
        now: overrides.now || new Date()
      }
    );

    if (!quota.allowed) {
      return {
        status: quota.status === "normal_daily_limit_reached"
          ? "research_budget_exhausted"
          : quota.status,
        processed: 0,
        day: quota.day,
        normalCount: quota.normalCount,
        urgentCount: quota.urgentCount
      };
    }
    updateTaskStatusFn(task.id, "active");

    let outcome;
    try {
      // All tool execution still goes through executeWork and its
      // existing plan validation, authorization and seven safety checks.
      outcome = await executeWorkFn(`Research: ${query}`, {
        persist: false,
        permissionGranted: true,
        toolCalls: [{
          name: "web_search",
          args: { query }
        }]
      });
    } catch (error) {
      updateTaskStatusFn(task.id, "waiting");
      appendResult({
        taskId: task.id,
        type: "research",
        success: false,
        error: "Execution failed; details intentionally omitted.",
        timestamp: new Date().toISOString()
      });
      return { status: "research_execution_failed", processed: 1 };
    }

    const sources = outcome && outcome.success
      ? extractSources(outcome)
      : [];

    let reportPath = null;
    if (sources.length) {
      reportPath = writeResearchReport(
        task,
        query,
        sources,
        storagePathFn
      );
    }

    const completed = Boolean(outcome && outcome.success && sources.length);

    appendResult({
      taskId: task.id,
      type: "research",
      success: completed,
      sourceCount: sources.length,
      reportPath,
      budgetDay: quota.day,
      budgetCount: quota.normalCount,
      budgetKind: quota.kind,
      urgent: quota.kind === "urgent",
      urgentCount: quota.urgentCount,
      timestamp: new Date().toISOString()
    });

    updateTaskStatusFn(task.id, completed ? "completed" : "waiting");

    return {
      status: completed ? "research_completed" : "research_waiting",
      processed: 1,
      sourceCount: sources.length,
      reportPath,
      budgetDay: quota.day,
      budgetCount: quota.normalCount,
      budgetKind: quota.kind,
      urgent: quota.kind === "urgent",
      urgentCount: quota.urgentCount
    };
  } finally {
    running = false;
  }
}

function startAutonomousWorker() {
  if (process.env.MIRA_AUTONOMOUS_WORKER_ENABLED !== "true") {
    console.log("[MiraWorker] Disabled; explicit opt-in required.");
    return { started: false, reason: "opt_in_required" };
  }

  if (timer) return { started: true, reason: "already_started" };

  const configuredInterval = Number(
    process.env.MIRA_AUTONOMOUS_WORKER_INTERVAL_MS || 30000
  );
  const interval = Number.isFinite(configuredInterval)
    ? Math.max(10000, Math.min(300000, configuredInterval))
    : 30000;

  timer = setInterval(() => {
    runOnce().catch(() => {
      console.error("[MiraWorker] Tick failed; details omitted.");
    });
  }, interval);

  if (typeof timer.unref === "function") timer.unref();

  runOnce().catch(() => {
    console.error("[MiraWorker] Initial tick failed; details omitted.");
  });

  return { started: true, interval };
}

function stopAutonomousWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  return { stopped: true };
}

module.exports = {
  runOnce,
  startAutonomousWorker,
  stopAutonomousWorker,
  getCalculatorExpression,
  getResearchQuery,
  extractSources,
  consumeResearchBudget
};
