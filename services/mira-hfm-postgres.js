"use strict";

const DATABASE_ENV_KEY = "MIRA_HFM_DATABASE_URL";
const NEON_HOST_SUFFIX = ".neon.tech";
let cachedPool = null;

function configError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseDatabaseConfig(env = process.env) {
  const connectionString = env[DATABASE_ENV_KEY];
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    return { configured: false, reason: "DATABASE_URL_NOT_CONFIGURED" };
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch (_error) {
    throw configError("DATABASE_URL_INVALID");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw configError("DATABASE_URL_PROTOCOL_INVALID");
  }
  if (!parsed.hostname.toLowerCase().endsWith(NEON_HOST_SUFFIX)) {
    throw configError("DATABASE_HOST_NOT_ALLOWLISTED");
  }
  if (!parsed.username || !parsed.password || !parsed.pathname || parsed.pathname === "/") {
    throw configError("DATABASE_URL_INCOMPLETE");
  }
  if (parsed.searchParams.get("sslmode") !== "require" &&
      parsed.searchParams.get("sslmode") !== "verify-full") {
    throw configError("DATABASE_SSL_REQUIRED");
  }

  return {
    configured: true,
    connectionString,
    host: parsed.hostname.toLowerCase(),
    databaseName: decodeURIComponent(parsed.pathname.slice(1))
  };
}

function resolveDatabaseConfig(env = process.env) {
  const config = parseDatabaseConfig(env);
  if (!config.configured) return config;
  return { configured: true, host: config.host, databaseName: config.databaseName };
}

function createPool(options = {}) {
  const env = options.env || process.env;
  const config = parseDatabaseConfig(env);
  if (!config.configured) throw configError(config.reason);

  let Pool = options.PoolCtor;
  if (!Pool) {
    try {
      Pool = require("pg").Pool;
    } catch (_error) {
      throw configError("POSTGRES_DRIVER_NOT_INSTALLED");
    }
  }

  const pool = new Pool({
    connectionString: config.connectionString,
    ssl: { rejectUnauthorized: true },
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
    application_name: "mira-hfm-readonly"
  });

  if (typeof pool.on === "function") {
    pool.on("error", () => {
      // Never log driver errors here; they may contain connection metadata.
    });
  }
  return pool;
}

function getPool(options = {}) {
  if (options.PoolCtor || options.env) return createPool(options);
  if (!cachedPool) cachedPool = createPool(options);
  return cachedPool;
}

async function inspectDatabase(options = {}) {
  let client = null;
  let transactionStarted = false;
  try {
    const pool = options.pool || getPool(options);
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    transactionStarted = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");

    const result = await client.query(
      "SELECT current_database() AS database_name, current_user AS database_role, " +
      "current_setting('transaction_read_only') AS transaction_read_only, " +
      "EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS schema_exists",
      ["mira_hfm"]
    );
    const row = result.rows && result.rows[0] ? result.rows[0] : {};
    const schemaExists = row.schema_exists === true;

    let tables = [];
    if (schemaExists) {
      const tableResult = await client.query(
        "SELECT table_name FROM information_schema.tables " +
        "WHERE table_schema = $1 AND table_type = $2 ORDER BY table_name",
        ["mira_hfm", "BASE TABLE"]
      );
      tables = (tableResult.rows || [])
        .map(item => String(item.table_name || ""))
        .filter(Boolean)
        .slice(0, 50);
    }

    await client.query("ROLLBACK");
    transactionStarted = false;

    return {
      status: "CONNECTED_READ_ONLY",
      readOnly: true,
      databaseName: String(row.database_name || "").slice(0, 128),
      databaseRole: String(row.database_role || "").slice(0, 128),
      transactionReadOnly: row.transaction_read_only === "on",
      schemaExists,
      tables
    };
  } catch (error) {
    return {
      status: "INCONCLUSIVE",
      readOnly: true,
      reason: error && error.code === "POSTGRES_DRIVER_NOT_INSTALLED"
        ? "POSTGRES_DRIVER_NOT_INSTALLED"
        : "DATABASE_CONNECTION_OR_INSPECTION_FAILED",
      errorCode: typeof error?.code === "string" ? error.code.slice(0, 32) : null
    };
  } finally {
    if (client) {
      if (transactionStarted) {
        try { await client.query("ROLLBACK"); } catch (_error) {}
      }
      try { client.release(); } catch (_error) {}
    }
  }
}

async function closePool() {
  if (!cachedPool) return;
  const pool = cachedPool;
  cachedPool = null;
  await pool.end();
}

module.exports = {
  DATABASE_ENV_KEY,
  resolveDatabaseConfig,
  createPool,
  getPool,
  inspectDatabase,
  closePool
};
