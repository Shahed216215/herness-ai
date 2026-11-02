"use strict";

const {
  spawnSync
} = require("child_process");

const path = require("path");

const PROJECT_ROOT =
  path.resolve(__dirname, "..");

const ALLOWED_TESTS = Object.freeze([
  {
    name: "capacity-register",
    command: process.execPath,
    args: [
      path.join(
        "tests",
        "capacity-register-test.js"
      )
    ]
  }
]);

function runAllowedTest(name) {
  const test =
    ALLOWED_TESTS.find(
      item => item.name === name
    );

  if (!test) {
    return {
      ok: false,
      status: "test_not_allowed",
      test: name
    };
  }

  const result =
    spawnSync(
      test.command,
      test.args,
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true
      }
    );

  if (result.error) {
    return {
      ok: false,
      status: "test_execution_error",
      test: name,
      message: result.error.message
    };
  }

  return {
    ok: result.status === 0,
    status:
      result.status === 0
        ? "test_passed"
        : "test_failed",
    test: name,
    exitCode: result.status,
    stdout: String(
      result.stdout || ""
    ).slice(0, 4000),
    stderr: String(
      result.stderr || ""
    ).slice(0, 4000)
  };
}

const requested =
  process.argv[2] ||
  "capacity-register";

const result =
  runAllowedTest(requested);

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);

if (!result.ok) {
  process.exitCode = 1;
}
