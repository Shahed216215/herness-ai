"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MAX_SOURCE_BYTES = 1024 * 1024;

const TARGETS = [
  "server.js",
  "tools/index.js",
  "services/tool-runner.js",
  "services/mira-work-execution-engine.js",
  "services/mira-verification-engine.js",
  "services/mira-change-validation.js",
  "tests/run-tests.js",
  "services/engineering/bug-hunter-orchestrator.js",
  "services/engineering/bug-hunter-repair-engine.js",
  "services/engineering/gate-status-policy.js"
];

function readProjectSource(relativePath) {
  const absolute = path.resolve(ROOT, relativePath);
  const rel = path.relative(ROOT, absolute);

  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, status: "UNSAFE_PATH" };
  }

  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) {
      return { ok: false, status: "NOT_A_FILE" };
    }
    if (stat.size > MAX_SOURCE_BYTES) {
      return { ok: false, status: "SOURCE_TOO_LARGE" };
    }
    return {
      ok: true,
      source: fs.readFileSync(absolute, "utf8")
    };
  } catch {
    return { ok: false, status: "MISSING_OR_UNREADABLE" };
  }
}

function extractToolName(source) {
  const exported = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
  if (!exported) return null;

  const explicit = exported[1].match(
    /^\s*name\s*:\s*["']([a-zA-Z0-9_-]+)["']\s*,?\s*$/m
  );
  if (explicit) return explicit[1];

  const shorthand = exported[1].match(/^\s*name\s*,?\s*$/m);
  if (!shorthand) return null;

  const declared = source.match(
    /^\s*const\s+name\s*=\s*["']([a-zA-Z0-9_-]+)["']\s*;/m
  );
  return declared ? declared[1] : null;
}

function audit() {
  const findings = [];
  const checks = [];
  const sources = {};

  for (const file of TARGETS) {
    const result = readProjectSource(file);
    checks.push({
      check: "source:" + file,
      status: result.ok ? "PASS" : result.status
    });
    if (result.ok) sources[file] = result.source;
    else findings.push({
      type: "SOURCE_UNAVAILABLE",
      file,
      status: result.status
    });
  }

  const server = sources["server.js"] || "";
  const engine = sources["services/mira-work-execution-engine.js"] || "";
  const runner = sources["services/tool-runner.js"] || "";
  const registry = sources["tools/index.js"] || "";

  const links = [
    {
      name: "agent_to_work_engine",
      ok: /executeWork\s*\(/.test(server) &&
          /functionCalls|toolArguments/.test(server)
    },
    {
      name: "work_engine_to_tool_runner",
      ok: /runTool\s*\(/.test(engine)
    },
    {
      name: "tool_runner_to_registry",
      ok: /executeTool\s*\(/.test(runner)
    },
    {
      name: "registry_exports_executor",
      ok: /function\s+executeTool\s*\(/.test(registry) &&
          /module\.exports/.test(registry)
    }
  ];

  for (const link of links) {
    checks.push({
      check: link.name,
      status: link.ok ? "PASS" : "CONNECTION_NOT_FOUND"
    });
    if (!link.ok) findings.push({
      type: "CONNECTION_NOT_FOUND",
      connection: link.name
    });
  }

  const policyBlock = engine.match(
    /const TOOL_POLICIES\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/
  );
  const policyNames = new Set(
    policyBlock
      ? [...policyBlock[1].matchAll(/^\s*([a-zA-Z_][\w]*):\s*\{/gm)]
          .map(match => match[1])
      : []
  );

  const toolFiles = fs.readdirSync(path.join(ROOT, "tools"))
    .filter(file => file.endsWith(".js") && file !== "index.js")
    .sort();

  const discoveredTools = [];
  const unrecognizedToolFiles = [];

  for (const file of toolFiles) {
    const relativePath = "tools/" + file;
    const result = readProjectSource(relativePath);
    if (!result.ok) {
      unrecognizedToolFiles.push({ file, status: result.status });
      continue;
    }
    const name = extractToolName(result.source);
    if (name) discoveredTools.push({ name, file });
    else unrecognizedToolFiles.push({
      file,
      status: "TOOL_NAME_NOT_RECOGNIZED"
    });
  }

  const registeredNames = new Set(discoveredTools.map(tool => tool.name));
  const missingPolicies = discoveredTools
    .filter(tool => !policyNames.has(tool.name))
    .map(tool => tool.name);
  const policiesWithoutTool = [...policyNames]
    .filter(name => !registeredNames.has(name));

  checks.push({
    check: "tool_policy_coverage",
    status: missingPolicies.length || policiesWithoutTool.length
      ? "ISSUES_FOUND"
      : "PASS",
    toolFilesFound: toolFiles.length,
    toolNamesRecognized: discoveredTools.length,
    policiesFound: policyNames.size,
    toolsMissingPolicy: missingPolicies,
    policiesWithoutTool
  });

  if (missingPolicies.length) findings.push({
    type: "TOOL_MISSING_POLICY",
    tools: missingPolicies
  });
  if (policiesWithoutTool.length) findings.push({
    type: "POLICY_WITHOUT_TOOL",
    tools: policiesWithoutTool
  });
  if (unrecognizedToolFiles.length) findings.push({
    type: "TOOL_SOURCE_UNRECOGNIZED",
    files: unrecognizedToolFiles
  });

  const testRunner = sources["tests/run-tests.js"] || "";
  const testRunnerCheck =
    /ALLOWED_TESTS/.test(testRunner) &&
    /spawnSync/.test(testRunner) &&
    /runAllowedTest/.test(testRunner);

  checks.push({
    check: "allowlisted_local_test_runner",
    status: testRunnerCheck ? "PASS" : "NOT_FOUND"
  });
  if (!testRunnerCheck) findings.push({
    type: "TEST_RUNNER_NOT_CONFIRMED"
  });

  const orchestrator =
    sources["services/engineering/bug-hunter-orchestrator.js"] || "";
  const repair =
    sources["services/engineering/bug-hunter-repair-engine.js"] || "";
  const gate =
    sources["services/engineering/gate-status-policy.js"] || "";

  const repairGateClosed =
    /mayApply:\s*false/.test(orchestrator) &&
    /stageRepair[\s\S]{0,500}throw new Error/.test(repair) &&
    /mayApply:\s*false/.test(gate);

  checks.push({
    check: "repair_approval_boundary",
    status: repairGateClosed ? "PASS" : "REVIEW_REQUIRED",
    meaning: repairGateClosed
      ? "Repair staging appears intentionally blocked by current approval policy."
      : "Approval boundary could not be confirmed by this source scan."
  });

  return {
    tool: "project_connection_audit",
    version: 1,
    status: findings.length ? "ISSUES_FOUND" : "PASS",
    checks,
    findings,
    scope: {
      projectRoot: ROOT,
      sourceFilesAllowlisted: TARGETS.length,
      testExecutionPerformed: false,
      networkRequests: 0,
      liveApiRequests: 0,
      filesModified: false,
      secretsRead: false
    },
    limitations: [
      "Static source inspection does not prove runtime behavior.",
      "A passing connection check means matching source patterns were found, not that every path executes successfully.",
      "This version does not run tests, change files, access secret values, call external services, or deploy."
    ]
  };
}

module.exports = {
  name: "project_connection_audit",
  declaration: {
    name: "project_connection_audit",
    description:
      "Read-only static audit of Mira project wiring, tool policy coverage, local test-runner presence, and repair approval boundaries. Never modifies files or performs network requests.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  execute: async () => JSON.stringify(audit(), null, 2)
};
