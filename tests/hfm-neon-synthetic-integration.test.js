"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const adapter = require("../services/mira-hfm-postgres");

async function main() {
  const url = process.env.MIRA_HFM_TEST_DATABASE_URL;
  const consent = process.env.MIRA_HFM_TEST_DATABASE_ALLOW_WRITES;
  if (!url || consent !== "I_CREATED_A_DISPOSABLE_NEON_BRANCH") {
    console.log("HFM_NEON_SYNTHETIC_TEST=NOT_APPROVED");
    console.log("Set MIRA_HFM_TEST_DATABASE_URL to a disposable Neon branch and explicitly set MIRA_HFM_TEST_DATABASE_ALLOW_WRITES=I_CREATED_A_DISPOSABLE_NEON_BRANCH.");
    process.exitCode = 2;
    return;
  }
  if (url === process.env.MIRA_HFM_DATABASE_URL) {
    throw new Error("TEST_DATABASE_MUST_NOT_EQUAL_RUNTIME_DATABASE");
  }

  const pool = adapter.createPool({
    env: { MIRA_HFM_DATABASE_URL: url }
  });
  const schema = "mira_hfm_it_" + crypto.randomUUID().replace(/-/g, "");
  const quotedSchema = '"' + schema + '"';
  let client;
  let schemaCreated = false;

  try {
    client = await pool.connect();
    await client.query("CREATE SCHEMA " + quotedSchema);
    schemaCreated = true;
    await client.query(
      "CREATE TABLE " + quotedSchema + '.synthetic_recovery (id INTEGER PRIMARY KEY, value TEXT NOT NULL)'
    );

    await client.query("BEGIN");
    await client.query(
      "INSERT INTO " + quotedSchema + '.synthetic_recovery (id, value) VALUES ($1, $2)',
      [1, "rollback-probe"]
    );
    await client.query("ROLLBACK");
    const rolledBack = await client.query(
      "SELECT count(*)::int AS count FROM " + quotedSchema + ".synthetic_recovery"
    );
    assert.equal(rolledBack.rows[0].count, 0);

    await client.query("BEGIN");
    await client.query(
      "INSERT INTO " + quotedSchema + '.synthetic_recovery (id, value) VALUES ($1, $2)',
      [2, "committed-probe"]
    );
    await client.query("COMMIT");
    const committed = await client.query(
      "SELECT id, value FROM " + quotedSchema + ".synthetic_recovery WHERE id = $1",
      [2]
    );
    assert.deepEqual(committed.rows, [{ id: 2, value: "committed-probe" }]);

    await client.query("BEGIN");
    await client.query(
      "UPDATE " + quotedSchema + ".synthetic_recovery SET value = $1 WHERE id = $2",
      ["must-rollback", 2]
    );
    await client.query("ROLLBACK");
    const recovered = await client.query(
      "SELECT value FROM " + quotedSchema + ".synthetic_recovery WHERE id = $1",
      [2]
    );
    assert.equal(recovered.rows[0].value, "committed-probe");

    console.log("HFM_NEON_SYNTHETIC_INSERT_COMMIT=PASS");
    console.log("HFM_NEON_SYNTHETIC_TRANSACTION_ROLLBACK=PASS");
    console.log("HFM_NEON_SYNTHETIC_STATE_RECOVERY=PASS");
  } finally {
    if (client && schemaCreated) {
      try { await client.query("DROP SCHEMA " + quotedSchema + " CASCADE"); } catch (_error) {}
    }
    if (client) client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error("HFM_NEON_SYNTHETIC_TEST=FAIL");
  console.error("ERROR_CODE=" + String(error.code || "UNKNOWN").slice(0, 32));
  process.exitCode = 1;
});
