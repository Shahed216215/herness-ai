"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const adapter = require("../services/mira-hfm-postgres");

const validUrl = "postgresql://runtime:synthetic-secret@ep-test.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

test("database URL is absent by default and never falls back to DATABASE_URL", () => {
  const config = adapter.resolveDatabaseConfig({ DATABASE_URL: validUrl });
  assert.equal(config.configured, false);
  assert.equal(config.reason, "DATABASE_URL_NOT_CONFIGURED");
});

test("only Neon PostgreSQL URLs with required TLS are accepted", () => {
  assert.throws(
    () => adapter.resolveDatabaseConfig({ MIRA_HFM_DATABASE_URL: "postgres://u:p@db.example.com/app?sslmode=require" }),
    error => error.code === "DATABASE_HOST_NOT_ALLOWLISTED"
  );
  assert.throws(
    () => adapter.resolveDatabaseConfig({ MIRA_HFM_DATABASE_URL: "postgres://u:p@ep-test.neon.tech/app?sslmode=disable" }),
    error => error.code === "DATABASE_SSL_REQUIRED"
  );
  const config = adapter.resolveDatabaseConfig({ MIRA_HFM_DATABASE_URL: validUrl });
  assert.equal(config.configured, true);
  assert.equal(config.host, "ep-test.ap-southeast-1.aws.neon.tech");
  assert.equal(config.databaseName, "neondb");
});

test("pool enforces TLS verification, small pool and bounded timeouts", () => {
  let received;
  class FakePool {
    constructor(config) { received = config; }
    on() {}
  }
  adapter.createPool({
    env: { MIRA_HFM_DATABASE_URL: validUrl },
    PoolCtor: FakePool
  });
  assert.deepEqual(received.ssl, { rejectUnauthorized: true });
  assert.equal(received.max, 2);
  assert.equal(received.connectionTimeoutMillis, 5000);
  assert.equal(received.statement_timeout, 5000);
  assert.equal(received.application_name, "mira-hfm-readonly");
});

test("inspection is read-only, returns metadata only and always rolls back", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT current_database")) {
        return { rows: [{
          database_name: "neondb",
          database_role: "mira_hfm_runtime",
          transaction_read_only: "on",
          schema_exists: true
        }] };
      }
      if (sql.startsWith("SELECT table_name")) {
        return { rows: [{ table_name: "project_owners" }, { table_name: "authority_audit_events" }] };
      }
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE" }); }
  };
  const result = await adapter.inspectDatabase({
    pool: { async connect() { return client; } }
  });

  assert.equal(result.status, "CONNECTED_READ_ONLY");
  assert.equal(result.readOnly, true);
  assert.equal(result.transactionReadOnly, true);
  assert.deepEqual(result.tables, ["project_owners", "authority_audit_events"]);
  assert.ok(calls.some(item => item.sql === "BEGIN READ ONLY"));
  assert.ok(calls.some(item => item.sql === "ROLLBACK"));
  assert.ok(calls.every(item =>
    item.sql === "RELEASE" ||
    item.sql === "BEGIN READ ONLY" ||
    item.sql === "ROLLBACK" ||
    item.sql.startsWith("SET LOCAL") ||
    item.sql.startsWith("SELECT ")
  ));
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
});

test("connection failures are sanitized and do not expose driver messages", async () => {
  const result = await adapter.inspectDatabase({
    pool: { async connect() { throw Object.assign(new Error("password=synthetic-secret"), { code: "28P01" }); } }
  });
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.errorCode, "28P01");
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
});

console.log("HFM_NEON_ADAPTER_UNIT_TESTS=PASS");
