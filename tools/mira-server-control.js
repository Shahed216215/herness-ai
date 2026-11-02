const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

const ROOT = process.cwd();
const PID_FILE = path.join(ROOT, "logs/mira-background-server.json");
const LOG_FILE = path.join(ROOT, "logs/mira-background-server.log");
const PORT = Number(process.env.PORT) || 3000;

function readRecord() {
  try { return JSON.parse(fs.readFileSync(PID_FILE, "utf8")); }
  catch { return null; }
}

function processIdentity(record) {
  if (!record || !Number.isInteger(record.pid)) return false;

  try {
    process.kill(record.pid, 0);
    const env = fs.readFileSync(`/proc/${record.pid}/environ`, "utf8");
    const cwd = fs.readlinkSync(`/proc/${record.pid}/cwd`);
    const cmd = fs.readFileSync(`/proc/${record.pid}/cmdline`, "utf8");

    return env.includes("MIRA_MH_SERVER_INSTANCE=" + record.token) &&
      cwd === ROOT && cmd.includes("server.js");
  } catch {
    return false;
  }
}

function checkHttp() {
  return new Promise(resolve => {
    const req = http.get({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/",
      timeout: 2500
    }, res => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("timeout", () => { req.destroy(); resolve(0); });
    req.on("error", () => resolve(0));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForReadiness(child, record, timeoutMs = 20000) {
  let exitInfo = null;
  let spawnError = null;

  const onExit = (code, signal) => {
    exitInfo = { code, signal };
  };
  const onError = error => {
    spawnError = error;
  };

  child.on("exit", onExit);
  child.on("error", onError);

  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        return { ready: false, reason: "spawn_error_" + (spawnError.code || "unknown") };
      }

      if (exitInfo) {
        return {
          ready: false,
          reason: "child_exited_" + (exitInfo.code === null ? exitInfo.signal : exitInfo.code)
        };
      }

      const httpStatus = await checkHttp();

      if (spawnError) {
        return { ready: false, reason: "spawn_error_" + (spawnError.code || "unknown") };
      }

      if (exitInfo) {
        return {
          ready: false,
          reason: "child_exited_" + (exitInfo.code === null ? exitInfo.signal : exitInfo.code)
        };
      }

      if (httpStatus && processIdentity(record)) {
        return { ready: true, httpStatus };
      }

      await sleep(250);
    }

    return { ready: false, reason: "readiness_timeout" };
  } finally {
    child.removeListener("exit", onExit);
    child.removeListener("error", onError);
  }
}

async function start() {
  const current = readRecord();

  if (current && processIdentity(current)) {
    const httpStatus = await checkHttp();
    console.log("SERVER_PROCESS_ALREADY_RUNNING PID=" + current.pid);
    console.log("HTTP_STATUS=" + httpStatus);
    return;
  }

  const existingHttp = await checkHttp();
  if (existingHttp) {
    console.log("PORT_ALREADY_RESPONDING HTTP=" + existingHttp);
    console.log("No second server started.");
    return;
  }

  const token = crypto.randomBytes(24).toString("hex");
  const logFd = fs.openSync(LOG_FILE, "a");

  let child;
  try {
    child = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, MIRA_MH_SERVER_INSTANCE: token },
      detached: true,
      stdio: ["ignore", logFd, logFd]
    });
  } catch (error) {
    fs.closeSync(logFd);
    console.error("START_FAILED spawn_error_" + (error.code || "unknown"));
    process.exitCode = 1;
    return;
  }

  fs.closeSync(logFd);

  const spawned = await new Promise(resolve => {
    child.once("spawn", () => resolve({ ok: true }));
    child.once("error", error => resolve({ ok: false, error }));
  });

  if (!spawned.ok || !Number.isInteger(child.pid)) {
    console.error(
      "START_FAILED spawn_error_" +
      ((spawned.error && spawned.error.code) || "unknown")
    );
    process.exitCode = 1;
    return;
  }

  child.unref();

  const record = {
    pid: child.pid,
    token,
    startedAt: new Date().toISOString()
  };

  console.log("START_SPAWNED PID=" + child.pid);

  const readiness = await waitForReadiness(child, record);

  if (!readiness.ready) {
    try {
      process.kill(child.pid, "SIGTERM");
      await sleep(500);
    } catch (_) {}

    console.error("START_FAILED reason=" + readiness.reason);
    console.error("PID_RECORD_WRITTEN=NO");
    process.exitCode = 1;
    return;
  }

  const tempFile = PID_FILE + "." + process.pid + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(record, null, 2) + "\n", {
    mode: 0o600
  });
  fs.renameSync(tempFile, PID_FILE);

  console.log("START_VERIFIED PID=" + child.pid);
  console.log("HTTP_STATUS=" + readiness.httpStatus);
  console.log("PID_RECORD_WRITTEN=YES");
}
async function status() {
  const record = readRecord();
  console.log("PID_RECORD=" + (record ? record.pid : "NOT_FOUND"));
  console.log("PROCESS_IDENTITY=" +
    (processIdentity(record) ? "VERIFIED" : "NOT_VERIFIED"));
  console.log("HTTP_STATUS=" + await checkHttp());
}

async function stop() {
  const record = readRecord();

  if (!record || !processIdentity(record)) {
    console.log("STOP_REFUSED: No verified owned server process.");
    return;
  }

  process.kill(record.pid, "SIGTERM");

  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (!processIdentity(record)) {
      fs.unlinkSync(PID_FILE);
      console.log("SERVER_STOP=PASS");
      return;
    }
  }

  console.log("SERVER_STOP=INCONCLUSIVE: Process still exists.");
}

if (require.main === module) {
(async () => {
  const action = process.argv[2];

  if (action === "start") await start();
  else if (action === "status") await status();
  else if (action === "stop") await stop();
  else {
    console.log("Usage: node tools/mira-server-control.js start|status|stop");
    process.exitCode = 2;
  }
})().catch(error => {
  console.error("CONTROLLER_ERROR:", error.message);
  process.exitCode = 1;
});
}
