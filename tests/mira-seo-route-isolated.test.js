"use strict";

const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const rejectUnsupportedUploads = require("../services/security/reject-unsupported-uploads");
const registerMiraSeoRoutes = require("../routes/mira-seo");

const SEO_PATH = "/api/admin/mira-seo/audit";
const app = express();
const outcomes = [];

function check(name, condition, detail = "") {
  outcomes.push({ name, pass: Boolean(condition) });
  console.log((condition ? "PASS " : "FAIL ") + name +
    (detail ? " :: " + detail : ""));
}

app.use(rejectUnsupportedUploads);

// Mirrors server.js: only the SEO route bypasses the global 50KB parser.
app.use(express.json({
  limit: "50kb",
  type: req => !(req.method === "POST" && req.path === SEO_PATH)
}));
app.use(rejectUnsupportedUploads);

// Authentication is deliberately before the route-local 2MB parser.
function requireAdminPermission(permission) {
  return (req, res, next) => {
    if (req.headers["x-test-admin"] !== "yes") {
      return res.status(403).json({ success: false, error: "Admin access required." });
    }
    req.testPermission = permission;
    next();
  };
}

registerMiraSeoRoutes(
  app,
  requireAdminPermission,
  { SYSTEM_ADMIN: "SYSTEM_ADMIN" }
);

// A non-SEO endpoint remains subject to the global 50KB parser.
app.post("/probe", (req, res) => res.json({ success: true }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({ success: false, error: "Request body is too large." });
  }
  if (err instanceof SyntaxError && err.status === 400) {
    return res.status(400).json({ success: false, error: "Malformed JSON." });
  }
  return res.status(500).json({ success: false, error: "Unexpected test server error." });
});

function send(port, path, body, options = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const headers = {
      "content-type": options.type || "application/json",
      "content-length": data.length,
      connection: "close"
    };
    if (options.admin) headers["x-test-admin"] = "yes";

    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path,
      headers,
      timeout: 5000
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
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
    console.log("GLOBAL_JSON_LIMIT=50kb");
    console.log("SEO_JSON_LIMIT=2mb");

    let r = await send(port, SEO_PATH, JSON.stringify({ keywords: ["mira seo"] }), { admin: true });
    check("normal SEO JSON accepted", r.status === 200, "HTTP " + r.status);

    r = await send(port, SEO_PATH, JSON.stringify({ html: "<html><title>" + "A".repeat(80 * 1024) + "</title></html>" }), { admin: true });
    check("SEO payload larger than 50KB accepted", r.status === 200, "HTTP " + r.status);

    r = await send(port, "/probe", JSON.stringify({ data: "X".repeat(80 * 1024) }));
    check("non-SEO endpoint retains 50KB limit", r.status === 413, "HTTP " + r.status);

    r = await send(port, SEO_PATH, JSON.stringify({ html: "small" }));
    check("SEO route requires admin authentication", r.status === 403, "HTTP " + r.status);

    r = await send(port, SEO_PATH, JSON.stringify({ fileData: "payload" }), { admin: true });
    check("JSON attachment payload rejected", r.status === 415, "HTTP " + r.status);

    r = await send(port, SEO_PATH, "--boundary--\r\n", {
      admin: true,
      type: "multipart/form-data; boundary=boundary"
    });
    check("multipart upload rejected", r.status === 415, "HTTP " + r.status);

    r = await send(port, SEO_PATH, '{"broken":', { admin: true });
    check("malformed SEO JSON returns 400", r.status === 400, "HTTP " + r.status);

    r = await send(port, SEO_PATH, JSON.stringify({ html: "X".repeat(2 * 1024 * 1024 + 100) }), { admin: true });
    check("SEO payload above 2MB rejected", r.status === 413, "HTTP " + r.status);

    console.log("ASSERTIONS_TOTAL=" + outcomes.length);
    console.log("ASSERTIONS_FAILED=" + outcomes.filter(x => !x.pass).length);
    console.log("SEO_ROUTE_ISOLATED_TEST_STATUS=" +
      (outcomes.every(x => x.pass) ? "PASS" : "FAIL"));
    console.log("NETWORK_REQUESTS=0");
    console.log("BIND_SCOPE=LOOPBACK_ONLY");

    if (outcomes.some(x => !x.pass)) process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error("HTTP_TEST_FATAL=" + (error.stack || error.message));
  process.exitCode = 2;
});
