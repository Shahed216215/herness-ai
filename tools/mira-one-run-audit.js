"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");
const BATCH_AUDIT = "tools/mira-batch-audit-20261025T161408Z.sh";
const CONNECTION_AUDIT = "tools/project-connection-audit.js";
const PROVIDER_TEST = "tests/provider-evolution-provider-coverage-test.js";
const SELF_TEST = "tests/mira-one-run-audit.test.js";

const FINGERPRINT_FILES = [
  "tools/index.js",
  "tools/mira-batch-audit-20261025T161408Z.sh",
  "tools/project-connection-audit.js",
  "services/mira-work-execution-engine.js",
  "services/mira-provider-evolution.js",
  "tests/provider-evolution-provider-coverage-test.js",
  "tests/mira-one-run-audit.test.js"
];

function hashFiles() {
  const hashes = {};
  for (const relative of FINGERPRINT_FILES) {
    const full = path.resolve(ROOT, relative);
    if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full)) {
      hashes[relative] = "MISSING";
      continue;
    }
    const stat = fs.statSync(full);
    if (!stat.isFile()) {
      hashes[relative] = "NOT_A_FILE";
      continue;
    }
    hashes[relative] = crypto
      .createHash("sha256")
      .update(fs.readFileSync(full))
      .digest("hex");
  }
  return hashes;
}

function compareHashes(previous, current) {
  const changed = [];
  const unchanged = [];
  for (const file of Object.keys(current)) {
    if (previous && previous[file] === current[file]) unchanged.push(file);
    else changed.push(file);
  }
  return { changed, unchanged };
}

function safeTail(output, count = 12) {
  return String(output || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count)
    .map(line => line
      .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/ig, "$1=[REDACTED]")
      .slice(0, 500));
}

function runLocal(label, command, args, timeout = 900000) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      PAGER: "cat",
      GIT_PAGER: "cat",
      CI: "1"
    }
  });

  let status = "PASS";
  if (result.error && result.error.code === "ETIMEDOUT") {
    status = "INCONCLUSIVE";
  } else if (result.error || result.status !== 0) {
    status = "FAIL";
  }

  return {
    check: label,
    status,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    errorCode: result.error ? result.error.code || "SPAWN_ERROR" : null,
    evidenceTail: safeTail(
      `${result.stdout || ""}\n${result.stderr || ""}`
    )
  };
}

function previousReport() {
  if (!fs.existsSync(REPORT_DIR)) return null;
  const files = fs.readdirSync(REPORT_DIR)
    .filter(name => /^mira-one-run-audit-\d{8}T\d{6}Z\.json$/.test(name))
    .sort()
    .reverse();

  for (const file of files) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(REPORT_DIR, file), "utf8")
      );
      if (parsed && parsed.fingerprints) {
        return { file, report: parsed };
      }
    } catch (_) {
      // Ignore malformed historical reports; never overwrite them.
    }
  }
  return null;
}

async function execute() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const reportPath = path.join(REPORT_DIR, `mira-one-run-audit-${stamp}.json`);

  if (fs.existsSync(reportPath)) {
    return JSON.stringify({
      success: false,
      status: "REPORT_COLLISION",
      message: "Refusing to overwrite an existing audit report."
    });
  }

  const before = hashFiles();
  const previous = previousReport();
  const delta = compareHashes(previous && previous.report.fingerprints, before);

  const checks = [];
  const requiredFiles = [BATCH_AUDIT, CONNECTION_AUDIT, PROVIDER_TEST, SELF_TEST];
  for (const file of requiredFiles) {
    checks.push({
      check: `required_file:${file}`,
      status: fs.existsSync(path.join(ROOT, file)) ? "PASS" : "INCONCLUSIVE"
    });
  }

  if (checks.every(check => check.status === "PASS")) {
    // The batch script is local/offline by contract. It runs project tests.
    checks.push(runLocal(
      "existing_batch_audit",
      "bash",
      [BATCH_AUDIT]
    ));

    checks.push(runLocal(
      "project_connection_and_tool_policy_audit",
      process.execPath,
      [CONNECTION_AUDIT]
    ));

    checks.push(runLocal(
      "provider_module_coverage_no_live_request",
      process.execPath,
      [PROVIDER_TEST]
    ));

    checks.push(runLocal(
      "one_run_audit_unit_tests",
      process.execPath,
      ["--test", SELF_TEST]
    ));
  }

  const after = hashFiles();
  const hashDeltaDuringRun = compareHashes(before, after);
  const failCount = checks.filter(item => item.status === "FAIL").length;
  const inconclusiveCount = checks.filter(item => item.status === "INCONCLUSIVE").length;
  const overall = failCount ? "FAIL" :
    inconclusiveCount || hashDeltaDuringRun.changed.length ? "INCONCLUSIVE" : "PASS";

  const report = {
    schemaVersion: 1,
    audit: "mira_one_run_audit",
    startedAt,
    completedAt: new Date().toISOString(),
    projectHead: (() => {
      const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: ROOT, encoding: "utf8"
      });
      return result.status === 0 ? result.stdout.trim() : "UNKNOWN";
    })(),
    mode: "LOCAL_ONLY_NO_LIVE_PROVIDER_HEALTH_CHECK",
    networkRequestsRequested: false,
    deploymentAttempted: false,
    automaticRepairAttempted: false,
    previousReport: previous ? previous.file : null,
    fingerprintComparison: delta,
    fingerprintChangesDuringAudit: hashDeltaDuringRun,
    fingerprints: after,
    checks,
    counts: {
      pass: checks.filter(item => item.status === "PASS").length,
      fail: failCount,
      inconclusive: inconclusiveCount
    },
    overall,
    limitation: "PASS covers only the checks listed here; it does not certify production readiness or prove full execution resume/recovery."
  };

  // Exclusive creation prevents accidental overwrite.
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });

  return JSON.stringify({
    success: overall === "PASS",
    status: overall,
    report: path.relative(ROOT, reportPath),
    previousReport: report.previousReport,
    changedFingerprintFiles: delta.changed,
    checks: checks.map(({ check, status, exitCode }) => ({ check, status, exitCode })),
    counts: report.counts,
    networkRequestsRequested: false,
    deploymentAttempted: false,
    automaticRepairAttempted: false,
    limitation: report.limitation
  }, null, 2);
}

module.exports = {
  name: "mira_one_run_audit",
  declaration: {
    name: "mira_one_run_audit",
    description: "Run Mira's existing local batch, project-connection/tool-policy, and provider-coverage audits; compare source fingerprints with the prior report and save a unique timestamped evidence report. Never run live provider health checks, deployment, or automatic repair.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  execute,
  _internals: { compareHashes, safeTail }
};
