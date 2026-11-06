"use strict";

const assert = require("node:assert/strict");
const { SupabaseRestSessionStore } = require("../services/mira-supabase-session-store");

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function call(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

async function main() {
  const rows = new Map();
  const requests = [];
  const requestImpl = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    const method = options.method;
    requests.push({ url, options });

    if (method === "POST") {
      const record = options.data;
      rows.set(record.sid, record);
      return { status: 201, data: {} };
    }

    if (method === "GET") {
      const sid = url.searchParams.get("sid").slice(3);
      const record = rows.get(sid);
      return { status: 200, data: record ? [record] : [] };
    }

    if (method === "PATCH") {
      const sid = url.searchParams.get("sid").slice(3);
      const record = rows.get(sid);
      if (record) Object.assign(record, options.data);
      return { status: 204, data: {} };
    }

    if (method === "DELETE") {
      const sidFilter = url.searchParams.get("sid");
      if (sidFilter) rows.delete(sidFilter.slice(3));
      else {
        const expiryFilter = url.searchParams.get("expire");
        if (expiryFilter) {
          const cutoff = new Date(expiryFilter.slice(3)).getTime();
          for (const [sid, record] of rows) {
            if (new Date(record.expire).getTime() < cutoff) rows.delete(sid);
          }
        }
      }
      return { status: 204, data: {} };
    }

    return { status: 405, data: {} };
  };

  const store = new SupabaseRestSessionStore({
    supabaseUrl: "https://unit-test.supabase.co",
    serviceRoleKey: "test-only-service-role-key",
    requestImpl
  });

  assert.equal(await store.verifyConnectivity(), true);
  assert.equal(rows.size, 0, "startup verification must clean up its probe row");

  const sessionData = {
    cookie: { maxAge: 60 * 60 * 1000 },
    authenticated: true,
    role: "admin"
  };

  rows.set("sid-expired-prune", {
    sid: "sid-expired-prune",
    sess: sessionData,
    expire: new Date(Date.now() - 1000).toISOString()
  });

  await call(store, "set", "sid-live", sessionData);
  assert.equal(rows.has("sid-live"), true, "set must persist the session");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rows.has("sid-expired-prune"), false,
    "session writes must trigger best-effort expired-row cleanup");

  const restored = await call(store, "get", "sid-live");
  assert.deepEqual(restored, sessionData, "get must restore persisted session");

  await Promise.all([
    call(store, "set", "sid-concurrent-a", sessionData),
    call(store, "set", "sid-concurrent-b", sessionData)
  ]);
  assert.deepEqual(await call(store, "get", "sid-concurrent-a"), sessionData);
  assert.deepEqual(await call(store, "get", "sid-concurrent-b"), sessionData);
  await call(store, "destroy", "sid-concurrent-a");
  assert.equal(rows.has("sid-concurrent-a"), false,
    "destroying one concurrent session must remove only that session");
  assert.deepEqual(await call(store, "get", "sid-concurrent-b"), sessionData,
    "destroying one concurrent session must preserve the other session");
  await call(store, "destroy", "sid-concurrent-b");

  await call(store, "touch", "sid-live", {
    ...sessionData,
    cookie: { maxAge: 2 * 60 * 60 * 1000 }
  });
  assert.equal(
    new Date(rows.get("sid-live").expire).getTime() > Date.now() + 60 * 60 * 1000,
    true,
    "touch must extend expiry"
  );

  rows.set("sid-expired", {
    sid: "sid-expired",
    sess: sessionData,
    expire: new Date(Date.now() - 1000).toISOString()
  });
  assert.equal(await call(store, "get", "sid-expired"), null);
  assert.equal(rows.has("sid-expired"), false, "expired sessions must be deleted");

  await call(store, "destroy", "sid-live");
  assert.equal(rows.has("sid-live"), false, "destroy must delete the session");

  assert.equal(
    requests.every(item =>
      item.options.headers.apikey === "test-only-service-role-key" &&
      item.options.headers.Authorization === "Bearer test-only-service-role-key"
    ),
    true,
    "all requests must use service-role authentication"
  );

  const failingStore = new SupabaseRestSessionStore({
    supabaseUrl: "https://unit-test.supabase.co",
    serviceRoleKey: "test-only-service-role-key",
    requestImpl: async () => ({ status: 503, data: {} })
  });

  await assert.rejects(
    call(failingStore, "get", "sid-down"),
    /HTTP 503/,
    "database/API failures must reach the session middleware"
  );
  await assert.rejects(
    call(failingStore, "set", "sid-write-down", sessionData),
    /HTTP 503/,
    "database/API write failures must fail session persistence"
  );
  await assert.rejects(
    call(failingStore, "touch", "sid-touch-down", sessionData),
    /HTTP 503/,
    "database/API touch failures must reach the session middleware"
  );

  assert.throws(
    () => new SupabaseRestSessionStore({
      supabaseUrl: "https://unit-test.supabase.co",
      serviceRoleKey: "",
      requestImpl
    }),
    /SUPABASE_SERVICE_ROLE_KEY/
  );

  console.log("MIRA_SUPABASE_SESSION_STORE_TEST=PASS");
}

main().catch(error => {
  console.error("MIRA_SUPABASE_SESSION_STORE_TEST=FAIL", error.message);
  process.exitCode = 1;
});
