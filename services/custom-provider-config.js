"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.resolve(
  process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH ||
  path.join(process.cwd(), "data", "custom-provider-slots.json")
);

const MODEL_PATTERN = /^[A-Za-z0-9._:/@+-]{1,200}$/;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._()\-]{0,79}$/;

function emptySlots() {
  return Array.from({ length: 5 }, (_, i) => ({
    slot: i + 1,
    name: "",
    endpoint: "",
    model: ""
  }));
}

function isPrivateIpv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p))) {
    return false;
  }
  const n = parts.map(Number);
  if (n.some(v => v < 0 || v > 255)) return true;

  return n[0] === 0 ||
    n[0] === 10 ||
    n[0] === 127 ||
    (n[0] === 169 && n[1] === 254) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && n[1] === 168) ||
    n[0] >= 224;
}

function validateEndpoint(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, status: "endpoint_required" };
  }

  if (raw.length > 2048 || raw !== raw.trim()) {
    return { ok: false, status: "endpoint_invalid" };
  }

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return { ok: false, status: "endpoint_invalid" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, status: "https_required" };
  }

  if (url.username || url.password || url.search || url.hash) {
    return { ok: false, status: "endpoint_contains_prohibited_data" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host === "::" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    return { ok: false, status: "endpoint_host_not_allowed" };
  }

  if (isPrivateIpv4(host)) {
    return { ok: false, status: "endpoint_host_not_allowed" };
  }

  return { ok: true, endpoint: url.toString() };
}

function validateSlots(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: "invalid_payload" };
  }

  if (!Array.isArray(input.slots) || input.slots.length !== 5) {
    return { ok: false, status: "exactly_five_slots_required" };
  }

  const slots = [];

  for (let i = 0; i < 5; i++) {
    const row = input.slots[i];

    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, status: "invalid_slot" };
    }

    if (row.slot !== i + 1) {
      return { ok: false, status: "slot_order_invalid" };
    }

    for (const key of Object.keys(row)) {
      if (!["slot", "name", "endpoint", "model"].includes(key)) {
        return { ok: false, status: "unexpected_field" };
      }
    }

    const name = typeof row.name === "string" ? row.name.trim() : "";
    const endpointRaw =
      typeof row.endpoint === "string" ? row.endpoint.trim() : "";
    const model = typeof row.model === "string" ? row.model.trim() : "";

    if (
      (row.name !== undefined && typeof row.name !== "string") ||
      (row.endpoint !== undefined && typeof row.endpoint !== "string") ||
      (row.model !== undefined && typeof row.model !== "string")
    ) {
      return { ok: false, status: "invalid_field_type" };
    }

    if (!name && !endpointRaw && !model) {
      slots.push({ slot: i + 1, name: "", endpoint: "", model: "" });
      continue;
    }

    if (!name || !endpointRaw || !model) {
      return { ok: false, status: "slot_fields_incomplete" };
    }

    if (!NAME_PATTERN.test(name)) {
      return { ok: false, status: "slot_name_invalid" };
    }

    if (!MODEL_PATTERN.test(model)) {
      return { ok: false, status: "model_id_invalid" };
    }

    const endpoint = validateEndpoint(endpointRaw);
    if (!endpoint.ok) {
      return { ok: false, status: endpoint.status };
    }

    slots.push({
      slot: i + 1,
      name,
      endpoint: endpoint.endpoint,
      model
    });
  }

  return { ok: true, status: "configuration_valid", slots };
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { version: 1, slots: emptySlots() };
  }

  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const checked = validateSlots({ slots: parsed.slots });

  if (!checked.ok || parsed.version !== 1) {
    throw new Error("stored_configuration_invalid");
  }

  return { version: 1, slots: checked.slots };
}

function writeConfig(input) {
  const checked = validateSlots(input);
  if (!checked.ok) throw new Error(checked.status);

  const directory = path.dirname(CONFIG_PATH);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const temporary = CONFIG_PATH + "." + process.pid + ".tmp";
  const content = JSON.stringify(
    { version: 1, slots: checked.slots },
    null,
    2
  ) + "\n";

  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, CONFIG_PATH);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (_) {}
    throw error;
  }

  return { version: 1, slots: checked.slots };
}

module.exports = {
  emptySlots,
  validateEndpoint,
  validateSlots,
  readConfig,
  writeConfig
};
