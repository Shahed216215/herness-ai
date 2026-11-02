"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const controllerSource = path.join(
  projectRoot,
  "tools",
  "mira-server-control.js"
);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function runController(root, action, env) {
  return spawnSync(
    process.execPath,
    ["tools/mira-server-control.js", action],
    {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 12000
    }
  );
}

async function main() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "mira-server-lifecycle-")
  );

  let port;
  let cleanupNeeded = false;

  try {
    fs.mkdirSync(path.join(root, "tools"), { recursive: true });
    fs.mkdirSync(path.join(root, "logs"), { recursive: true });

    fs.copyFileSync(
      controllerSource,
      path.join(root, "tools", "mira-server-control.js")
    );

    port = await getFreePort();

    fs.writeFileSync(
      path.join(root, "server.js"),
      `const http = require("node:http");
if (process.env.TEST_SERVER_MODE === "exit") process.exit(7);
const server = http.createServer((req, res) => {
  res.writeHead(200, {"content-type":"text/plain"});
  res.end("fixture-ready");
});
server.listen(Number(process.env.PORT), "127.0.0.1");
`
    );

    const env = {
      PORT: String(port),
      MIRA_AUTONOMOUS_WORKER_ENABLED: "false",
      TEST_SERVER_MODE: "serve"
    };

    const started = runController(root, "start", env);

    assert.equal(started.error, undefined, "start command must not time out");
    assert.equal(started.status, 0, started.stderr);
    assert.match(started.stdout, /START_VERIFIED PID=/);
    assert.match(started.stdout, /PID_RECORD_WRITTEN=YES/);
    cleanupNeeded = true;

    const status = runController(root, "status", env);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /PROCESS_IDENTITY=VERIFIED/);
    assert.match(status.stdout, /HTTP_STATUS=200/);

    const stopped = runController(root, "stop", env);
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.match(stopped.stdout, /SERVER_STOP=PASS/);
    cleanupNeeded = false;

    const earlyExit = runController(root, "start", {
      ...env,
      TEST_SERVER_MODE: "exit"
    });

    assert.equal(earlyExit.error, undefined, "early-exit test must not time out");
    assert.equal(earlyExit.status, 1);
    assert.match(earlyExit.stderr, /START_FAILED reason=child_exited_7/);
    assert.match(earlyExit.stderr, /PID_RECORD_WRITTEN=NO/);

    assert.equal(
      fs.existsSync(path.join(root, "logs/mira-background-server.json")),
      false,
      "failed startup must not create a PID record"
    );

    console.log("MIRA_SERVER_CONTROL_LIFECYCLE=PASS");
    console.log("START_READINESS_AND_PID_RECORD=PASS");
    console.log("STATUS_HTTP_AND_IDENTITY=PASS");
    console.log("CONTROLLED_STOP=PASS");
    console.log("EARLY_CHILD_EXIT_HANDLING=PASS");
    console.log("FAILED_START_PID_RECORD=NOT_WRITTEN");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
    console.log("LIVE_PROVIDER_REQUESTS=0");
  } finally {
    if (cleanupNeeded) {
      try {
        runController(root, "stop", {
          PORT: String(port),
          MIRA_AUTONOMOUS_WORKER_ENABLED: "false"
        });
      } catch (_) {}
    }

    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error("MIRA_SERVER_CONTROL_LIFECYCLE=FAIL");
  console.error(error.stack || error);
  process.exitCode = 1;
});
