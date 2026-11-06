"use strict";

const assert = require("node:assert/strict");
const express = require("express");
const session = require("express-session");
const { SupabaseRestSessionStore } = require("../services/mira-supabase-session-store");

function createTransport(rows) {
  return async (rawUrl, options) => {
    const url = new URL(rawUrl);
    const method = options.method;

    if (method === "POST") {
      rows.set(options.data.sid, options.data);
      return { status: 201, data: {} };
    }

    if (method === "GET") {
      const sid = url.searchParams.get("sid").slice(3);
      const row = rows.get(sid);
      return { status: 200, data: row ? [row] : [] };
    }

    if (method === "PATCH") {
      const sid = url.searchParams.get("sid").slice(3);
      const row = rows.get(sid);
      if (row) Object.assign(row, options.data);
      return { status: 204, data: {} };
    }

    if (method === "DELETE") {
      const sid = url.searchParams.get("sid");
      if (sid) rows.delete(sid.slice(3));
      else {
        const filter = url.searchParams.get("expire");
        if (filter) {
          const cutoff = new Date(filter.slice(3)).getTime();
          for (const [key, row] of rows) {
            if (new Date(row.expire).getTime() < cutoff) rows.delete(key);
          }
        }
      }
      return { status: 204, data: {} };
    }

    return { status: 405, data: {} };
  };
}

function createApp(rows) {
  const app = express();
  const store = new SupabaseRestSessionStore({
    supabaseUrl: "https://integration-test.supabase.co",
    serviceRoleKey: "integration-test-only-key",
    requestImpl: createTransport(rows)
  });

  app.use(session({
    store,
    secret: "integration-test-session-secret-".repeat(3),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      maxAge: 60 * 60 * 1000
    }
  }));

  app.post("/login", (req, res) => {
    req.session.regenerate(error => {
      if (error) return res.status(500).json({ success: false });
      req.session.user = { id: "user-1", role: "admin" };
      return res.status(200).json({ success: true });
    });
  });

  app.get("/me", (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ authenticated: false });
    }
    return res.status(200).json({
      authenticated: true,
      user: req.session.user
    });
  });

  app.post("/logout", (req, res) => {
    req.session.destroy(error => {
      if (error) return res.status(500).json({ success: false });
      res.clearCookie("connect.sid", {
        httpOnly: true,
        sameSite: "strict"
      });
      return res.status(200).json({ success: true });
    });
  });

  return app;
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  return {
    server,
    baseUrl: "http://127.0.0.1:" + address.port
  };
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function main() {
  const rows = new Map();
  const first = await listen(createApp(rows));
  let cookie;

  try {
    const login = await fetch(first.baseUrl + "/login", { method: "POST" });
    assert.equal(login.status, 200, "login must create a session");
    const setCookie = login.headers.getSetCookie
      ? login.headers.getSetCookie()[0]
      : login.headers.get("set-cookie");
    assert.ok(setCookie, "login must return a session cookie");
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    cookie = setCookie.split(";")[0];

    const whoami = await fetch(first.baseUrl + "/me", {
      headers: { Cookie: cookie }
    });
    assert.equal(whoami.status, 200, "session must authenticate subsequent requests");
    assert.deepEqual(await whoami.json(), {
      authenticated: true,
      user: { id: "user-1", role: "admin" }
    });

    assert.equal(rows.size, 1, "session data must be persisted outside the app instance");
  } finally {
    await close(first.server);
  }

  // A new app/store instance sharing only the durable backing rows models a Render restart.
  const restarted = await listen(createApp(rows));
  try {
    const restored = await fetch(restarted.baseUrl + "/me", {
      headers: { Cookie: cookie }
    });
    assert.equal(restored.status, 200, "session must survive app/store recreation");
    assert.deepEqual((await restored.json()).user, {
      id: "user-1",
      role: "admin"
    });

    const logout = await fetch(restarted.baseUrl + "/logout", {
      method: "POST",
      headers: { Cookie: cookie }
    });
    assert.equal(logout.status, 200, "logout must destroy the stored session");

    const afterLogout = await fetch(restarted.baseUrl + "/me", {
      headers: { Cookie: cookie }
    });
    assert.equal(afterLogout.status, 401, "destroyed sessions must not authenticate");
    assert.equal(rows.size, 0, "logout must remove the persisted row");
  } finally {
    await close(restarted.server);
  }

  console.log("MIRA_SESSION_HTTP_INTEGRATION_TEST=PASS");
}

main().catch(error => {
  console.error("MIRA_SESSION_HTTP_INTEGRATION_TEST=FAIL", error.message);
  process.exitCode = 1;
});
