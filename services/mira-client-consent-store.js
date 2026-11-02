"use strict";

const fs = require("node:fs");
const path = require("node:path");
const storagePath = require("../mira-storage");

const DEFAULT_FILE = storagePath("client-consents.json");

function validateDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.version !== 1 || !Array.isArray(value.events)) {
    throw new Error("CLIENT_CONSENT_STORE_CORRUPT");
  }

  for (const event of value.events) {
    if (!event || typeof event !== "object" ||
        typeof event.clientId !== "string" ||
        typeof event.scope !== "string" ||
        !["authorized", "revoked"].includes(event.status) ||
        typeof event.recordedAt !== "string" ||
        !event.actor || typeof event.actor.username !== "string") {
      throw new Error("CLIENT_CONSENT_EVENT_INVALID");
    }
  }

  return value;
}

function createConsentStore(options = {}) {
  const filePath = path.resolve(options.filePath || DEFAULT_FILE);

  function read() {
    let raw;

    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("CLIENT_CONSENT_STORE_UNSAFE");
      }
      raw = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, events: [] };
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("CLIENT_CONSENT_STORE_CORRUPT");
    }

    return validateDocument(parsed);
  }

  function write(document) {
    const safe = validateDocument(document);
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("CLIENT_CONSENT_STORE_UNSAFE");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(temp, JSON.stringify(safe, null, 2), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      fs.chmodSync(temp, 0o600);
      fs.renameSync(temp, filePath);
    } catch (error) {
      try { fs.unlinkSync(temp); } catch {}
      throw error;
    }
    return true;
  }

  function current(clientId, scope) {
    const events = read().events;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.clientId === clientId && event.scope === scope) {
        return event;
      }
    }
    return null;
  }

  return Object.freeze({ filePath, read, write, current });
}

const defaultStore = createConsentStore();

module.exports = {
  createConsentStore,
  read: defaultStore.read,
  write: defaultStore.write,
  current: defaultStore.current,
  filePath: defaultStore.filePath
};
