"use strict";

// Load project environment for direct audit-module consumers.
try { require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true }); } catch (error) {}


const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const crypto = require("crypto");

const AUDIT_FILE =
  process.env.MIRA_AUDIT_FILE || storagePath("audit-log.json");

const MAX_AUDIT_ENTRIES = 500;
const AUDIT_HASH_ALGORITHM = "sha256";
const AUDIT_INTEGRITY_VERSION = 1;

function loadAuditLog() {
  try {
    if (!fs.existsSync(AUDIT_FILE)) {
      return [];
    }

    const raw = fs.readFileSync(
      AUDIT_FILE,
      "utf8"
    );

    if (!raw.trim()) {
      return [];
    }

    const data = JSON.parse(raw);

    return Array.isArray(data)
      ? data
      : [];
  } catch (error) {
    throw new Error(
      `Failed to load audit log: ${error.message}`
    );
  }
}

function saveAuditLog(entries) {
  const limited =
    entries.slice(-MAX_AUDIT_ENTRIES);

  const tempFile =
    `${AUDIT_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      limited,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    AUDIT_FILE
  );

  return limited;
}

function sanitizeValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "string"
  ) {
    return value.length > 500
      ? `${value.slice(0, 500)}...`
      : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map(sanitizeValue);
  }

  if (
    typeof value === "object"
  ) {
    const result = {};

    for (
      const [key, item] of
      Object.entries(value).slice(0, 30)
    ) {
      if (
        /token|secret|password|api.?key|authorization|credential/i
          .test(key)
      ) {
        result[key] = "[REDACTED]";
      } else {
        result[key] =
          sanitizeValue(item);
      }
    }

    return result;
  }

  return String(value);
}

function createAuditId() {
  return crypto.randomUUID();
}

function createIntegrityPayload(entry) {
  return {
    integrityVersion:
      (entry.integrityVersion || 1),

    id:
      entry.id,

    timestamp:
      entry.timestamp,

    actorRole:
      entry.actorRole,

    action:
      entry.action,

    resource:
      entry.resource,

    resourceId:
      entry.resourceId,

    status:
      entry.status,

    details:
      entry.details,

    previousHash:
      entry.previousHash || null
  };
}

function calculateLegacySha256Hash(entry) {
  const payload =
    createIntegrityPayload(entry);

  const canonical =
    JSON.stringify(payload);

  return crypto
    .createHash(
      AUDIT_HASH_ALGORITHM
    )
    .update(
      canonical,
      "utf8"
    )
    .digest("hex");
}

function getLastIntegrityHash(entries) {
  for (
    let index = entries.length - 1;
    index >= 0;
    index -= 1
  ) {
    const entry =
      entries[index];

    if (
      entry &&
      typeof entry.integrityHash === "string" &&
      /^[a-f0-9]{64}$/i.test(
        entry.integrityHash
      )
    ) {
      return entry.integrityHash;
    }
  }

  return null;
}

function recordAuditBase({
  actorRole = "unknown",
  action,
  resource = "",
  resourceId = "",
  status = "success",
  details = {}
}) {
  if (!action) {
    throw new Error(
      "Audit action is required."
    );
  }

  const entries =
    loadAuditLog();

  const entry = {
    id:
      createAuditId(),

    timestamp:
      new Date().toISOString(),

    actorRole:
      String(actorRole || "unknown"),

    action:
      String(action),

    resource:
      String(resource || ""),

    resourceId:
      String(resourceId || ""),

    status:
      String(status || "success"),

    details:
      sanitizeValue(details)
  };

  const previousHash =
    getLastIntegrityHash(entries);

  entry.previousHash =
    previousHash;

  entry.integrityVersion = currentIntegrityVersion();

  entry.integrityHash =
    calculateIntegrityHash(entry);

  entries.push(entry);

  saveAuditLog(entries);

  return entry;
}

function verifyAuditIntegrityBase() {
  const entries =
    loadAuditLog();

  let legacyEntries = 0;
  let verifiedEntries = 0;
  let integrityFailures = 0;
  let chainFailures = 0;

  let previousVerifiedHash = null;
  let integrityStarted = false;

  const failures = [];

  for (
    let index = 0;
    index < entries.length;
    index += 1
  ) {
    const entry =
      entries[index];

    if (
      !entry ||
      typeof entry !== "object"
    ) {
      integrityFailures += 1;

      failures.push({
        index,
        reason: "invalid_entry"
      });

      continue;
    }

    const hasIntegrity =
      typeof entry.integrityHash === "string" &&
      typeof entry.integrityVersion === "number";

    if (!hasIntegrity) {
      legacyEntries += 1;

      if (integrityStarted) {
        chainFailures += 1;

        failures.push({
          index,
          reason:
            "legacy_entry_after_integrity_chain_started"
        });
      }

      continue;
    }

    integrityStarted = true;

    const expectedHash =
      calculateIntegrityHash(entry);

    if (
      entry.integrityHash !==
      expectedHash
    ) {
      integrityFailures += 1;

      failures.push({
        index,
        reason:
          "integrity_hash_mismatch",
        expectedHash,
        actualHash:
          entry.integrityHash
      });

      continue;
    }

    const actualPreviousHash =
      entry.previousHash || null;

    /*
     * The first retained entry may point to an entry that was
     * removed by MAX_AUDIT_ENTRIES retention. Its own
     * integrityHash still authenticates this previousHash value.
     *
     * Therefore the first retained entry is treated as the
     * verification boundary. Every subsequent retained entry
     * must still link to the immediately preceding verified hash.
     */
    if (index > 0) {
      const expectedPreviousHash =
        previousVerifiedHash;

      if (
        actualPreviousHash !==
        expectedPreviousHash
      ) {
        chainFailures += 1;

        failures.push({
          index,
          reason:
            "previous_hash_mismatch",
          expectedPreviousHash,
          actualPreviousHash
        });
      }
    }

    previousVerifiedHash =
      entry.integrityHash;

    verifiedEntries += 1;
  }

  const chainValid =
    chainFailures === 0;

  const hashesValid =
    integrityFailures === 0;

  const ok =
    chainValid &&
    hashesValid;

  return {
    ok,

    algorithm:
      AUDIT_HASH_ALGORITHM,

    integrityVersion:
      AUDIT_INTEGRITY_VERSION,

    totalEntries:
      entries.length,

    legacyEntries,

    verifiedEntries,

    integrityFailures,

    chainFailures,

    chainValid,

    hashesValid,

    tamperDetected:
      !ok,

    failures
  };
}

function getAuditLog(limit = 100) {
  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 100,
        1
      ),
      MAX_AUDIT_ENTRIES
    );

  return loadAuditLog()
    .slice(-safeLimit)
    .reverse();
}

function clearAuditLogBase() {
  saveAuditLog([]);

  return {
    success: true,
    cleared: true
  };
}

function getHmacKey() {
  const explicit = process.env.MIRA_AUDIT_HMAC_KEY;
  if (explicit && explicit.length >= 16) return explicit;
  const secret = process.env.MIRA_SESSION_SECRET;
  if (secret) {
    return crypto.createHmac("sha256", secret)
      .update("mira-audit-hmac-v2", "utf8").digest("hex");
  }
  return null;
}
function currentIntegrityVersion() {
  return getHmacKey() ? 2 : 1;
}
function hmacHex(key, text) {
  return crypto.createHmac(AUDIT_HASH_ALGORITHM, key).update(text, "utf8").digest("hex");
}
function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function calculateIntegrityHash(entry) {
  if (Number(entry && entry.integrityVersion) >= 2) {
    const key = getHmacKey();
    if (!key) return "hmac_key_unavailable";
    return hmacHex(key, JSON.stringify(createIntegrityPayload(entry)));
  }
  return calculateLegacySha256Hash(entry);
}
function anchorPath() {
  return AUDIT_FILE + ".anchor";
}
function anchorSignature(key, a) {
  return hmacHex(key, JSON.stringify({
    lastHash: a.lastHash, lastId: a.lastId, updatedAt: a.updatedAt
  }));
}
function writeAnchor(entry) {
  const key = getHmacKey();
  if (!key || Number(entry.integrityVersion) < 2) return;
  const a = {
    lastHash: entry.integrityHash,
    lastId: entry.id,
    updatedAt: new Date().toISOString()
  };
  a.sig = anchorSignature(key, a);
  const tmp = anchorPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(a), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, anchorPath());
}
function recordAudit(input) {
  // STAGE62_FAIL_CLOSED_HMAC_GUARD: never downgrade a v2 audit stream.
  if (!getHmacKey()) {
    let hasV2History = false;
    try {
      const raw = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
      const entries = Array.isArray(raw) ? raw :
        (raw.entries || raw.auditLog || raw.records || []);
      hasV2History = Array.isArray(entries) &&
        entries.some(e => Number(e && e.integrityVersion) >= 2);
    } catch (_) {}
    if (hasV2History) {
      throw new Error("Audit write blocked: HMAC key unavailable for an existing v2 audit stream");
    }
  }
  const entry = recordAuditBase(input);
  try {
    writeAnchor(entry);
  } catch (error) {
    console.error("AUDIT_ANCHOR_WRITE_FAILED");
  }
  return entry;
}
function clearAuditLog() {
  const result = clearAuditLogBase();
  try { fs.unlinkSync(anchorPath()); } catch (error) {}
  return result;
}
function verifyAuditIntegrity() {
  const result = verifyAuditIntegrityBase();
  const failures = Array.isArray(result.failures) ? result.failures.slice() : [];
  const entries = loadAuditLog();
  const key = getHmacKey();
  const versionOf = e => Number(e && e.integrityVersion) || 0;
  let firstV2 = -1;
  for (let i = 0; i < entries.length; i += 1) {
    if (versionOf(entries[i]) >= 2) { firstV2 = i; break; }
  }
  let downgradeFailures = 0;
  let anchorFailures = 0;
  if (firstV2 >= 0) {
    if (!key) {
      anchorFailures += 1;
      failures.push({ reason: "hmac_key_unavailable" });
    }
    for (let i = firstV2 + 1; i < entries.length; i += 1) {
      if (versionOf(entries[i]) < 2) {
        downgradeFailures += 1;
        failures.push({ index: i, reason: "downgrade_after_hmac_entries" });
      }
    }
  }
  let anchorState = "absent";
  let anchor = null;
  const anchorExists = fs.existsSync(anchorPath());
  if (anchorExists) {
    try { anchor = JSON.parse(fs.readFileSync(anchorPath(), "utf8")); }
    catch (error) { anchor = null; }
  }
  if (anchorExists && !anchor) {
    anchorFailures += 1;
    anchorState = "unreadable";
    failures.push({ reason: "anchor_unreadable" });
  } else if (anchor) {
    const sigOk = !!key && safeEqualHex(anchor.sig, anchorSignature(key, anchor));
    if (!sigOk) {
      anchorFailures += 1;
      anchorState = "signature_invalid";
      failures.push({ reason: "anchor_signature_invalid" });
    } else {
      const last = entries.length ? entries[entries.length - 1] : null;
      const lastHash = last && last.integrityHash ? last.integrityHash : null;
      if (lastHash === anchor.lastHash) {
        anchorState = "match";
      } else if (last && last.previousHash === anchor.lastHash) {
        anchorState = "log_one_ahead_of_anchor";
      } else {
        anchorFailures += 1;
        anchorState = "mismatch";
        failures.push({ reason: "anchor_mismatch_possible_truncation_or_replacement" });
      }
    }
  } else if (firstV2 >= 0) {
    anchorFailures += 1;
    anchorState = "missing";
    failures.push({ reason: "anchor_missing" });
  }
  const ok = result.ok && downgradeFailures === 0 && anchorFailures === 0;
  return Object.assign({}, result, {
    ok,
    tamperDetected: !ok,
    chainValid: result.chainValid && downgradeFailures === 0,
    anchorState,
    hmacKeyConfigured: !!key,
    downgradeFailures,
    anchorFailures,
    failures
  });
}

module.exports = {
  AUDIT_FILE,
  MAX_AUDIT_ENTRIES,
  AUDIT_HASH_ALGORITHM,
  AUDIT_INTEGRITY_VERSION,
  loadAuditLog,
  saveAuditLog,
  recordAudit,
  getAuditLog,
  clearAuditLog,
  calculateIntegrityHash,
  verifyAuditIntegrity
};
