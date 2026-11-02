"use strict";

const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const guard = require("../services/security/reject-unsupported-uploads");

const app = express();
const outcomes = [];

function check(name, condition, detail = "") {
  outcomes.push({name, pass: Boolean(condition)});
  console.log((condition ? "PASS " : "FAIL ") + name +
    (detail ? " :: " + detail : ""));
}

app.use(guard);
app.use(express.json({limit: "50kb"}));
app.use(guard);

app.post("/probe", (req, res) => {
  res.status(200).json({ok: true, body: req.body ?? null});
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({error: "request body too large"});
  }
  if (err instanceof SyntaxError && err.status === 400) {
    return res.status(400).json({error: "malformed JSON"});
  }
  return res.status(500).json({error: "request processing failed"});
});

function send(port, type, body, path = "/probe") {
  return new Promise((resolve, reject) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path,
      headers: {
        "content-type": type,
        "content-length": data.length,
        "connection": "close"
      },
      timeout: 4000
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end(data);
  });
}

(async () => {
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const port = server.address().port;
    console.log("BIND=127.0.0.1");
    console.log("PORT=" + port);
    console.log("JSON_LIMIT=50kb");

    let r = await send(port, "application/json",
      JSON.stringify({message: "normal text"}));
    check("normal JSON accepted", r.status === 200, "HTTP " + r.status);

    r = await send(port, "application/json",
      JSON.stringify({nested: {fileData: "payload"}}));
    check("nested attachment payload rejected",
      r.status === 415, "HTTP " + r.status);

    r = await send(port, "application/json",
      JSON.stringify({image: "data:image/png;base64,AAAA"}));
    check("base64 data URI rejected",
      r.status === 415, "HTTP " + r.status);

    r = await send(port, "multipart/form-data; boundary=stage19",
      "--stage19--\r\n");
    check("multipart rejected", r.status === 415, "HTTP " + r.status);

    r = await send(port, "application/json", '{"broken":');
    check("malformed JSON receives 400",
      r.status === 400, "HTTP " + r.status);

    r = await send(port, "application/json",
      JSON.stringify({data: "X".repeat(80 * 1024)}));
    check("oversized JSON receives 413",
      r.status === 413, "HTTP " + r.status);

    r = await send(port, "text/plain", "plain body");
    check("text/plain policy recorded",
      [200, 400, 413, 415].includes(r.status),
      "HTTP " + r.status + " (review route requirements before changing policy)");

    r = await send(port, "application/octet-stream",
      Buffer.from([0, 1, 2, 3, 255]));
    check("octet-stream policy recorded",
      [200, 400, 413, 415].includes(r.status),
      "HTTP " + r.status + " (review route requirements before changing policy)");

    console.log("ASSERTIONS_TOTAL=" + outcomes.length);
    console.log("ASSERTIONS_FAILED=" +
      outcomes.filter(x => !x.pass).length);
    console.log("POLICY_OBSERVATIONS=2");

    if (outcomes.some(x => !x.pass)) process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => {
  console.error("HTTP_TEST_FATAL=" + (err.stack || err.message));
  process.exitCode = 2;
});
