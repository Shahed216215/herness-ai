const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');

const CONFIG_FILE = storagePath("capacity-config.json");

const DEFAULT_CAPACITIES = {
  knowledge: 100,
  memory: 20
};

const MIN_CAPACITY = 1;
const MAX_CAPACITY = 10000;

function validateTarget(target) {
  return (
    target === "knowledge" ||
    target === "memory"
  );
}

function validateCapacity(value) {
  const capacity = Number(value);

  if (!Number.isInteger(capacity)) {
    throw new Error(
      "Capacity must be an integer."
    );
  }

  if (
    capacity < MIN_CAPACITY ||
    capacity > MAX_CAPACITY
  ) {
    throw new Error(
      `Capacity must be between ${MIN_CAPACITY} and ${MAX_CAPACITY}.`
    );
  }

  return capacity;
}

function normalizeConfig(data) {
  const config =
    data && typeof data === "object"
      ? data
      : {};

  return {
    knowledge: validateCapacity(
      config.knowledge ??
        DEFAULT_CAPACITIES.knowledge
    ),

    memory: validateCapacity(
      config.memory ??
        DEFAULT_CAPACITIES.memory
    )
  };
}

function loadCapacityConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      ...DEFAULT_CAPACITIES
    };
  }

  try {
    const raw =
      fs.readFileSync(
        CONFIG_FILE,
        "utf8"
      );

    if (!raw.trim()) {
      return {
        ...DEFAULT_CAPACITIES
      };
    }

    return normalizeConfig(
      JSON.parse(raw)
    );
  } catch (error) {
    throw new Error(
      `Failed to load capacity configuration: ${error.message}`
    );
  }
}

function saveCapacityConfig(config) {
  const normalized =
    normalizeConfig(config);

  const tempFile =
    `${CONFIG_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      normalized,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    CONFIG_FILE
  );

  return normalized;
}

function getCapacity(target) {
  const normalizedTarget =
    String(target || "")
      .trim()
      .toLowerCase();

  if (!validateTarget(normalizedTarget)) {
    throw new Error(
      "Unsupported capacity target."
    );
  }

  const config =
    loadCapacityConfig();

  return config[normalizedTarget];
}

function getAllCapacities() {
  return loadCapacityConfig();
}

function setCapacity(
  target,
  requestedCapacity
) {
  const normalizedTarget =
    String(target || "")
      .trim()
      .toLowerCase();

  if (!validateTarget(normalizedTarget)) {
    throw new Error(
      "Unsupported capacity target."
    );
  }

  const capacity =
    validateCapacity(
      requestedCapacity
    );

  const currentConfig =
    loadCapacityConfig();

  const previousCapacity =
    currentConfig[normalizedTarget];

  if (
    previousCapacity === capacity
  ) {
    throw new Error(
      "Requested capacity is unchanged."
    );
  }

  const nextConfig = {
    ...currentConfig,
    [normalizedTarget]:
      capacity
  };

  const saved =
    saveCapacityConfig(
      nextConfig
    );

  return {
    target: normalizedTarget,
    previousCapacity,
    requestedCapacity: capacity,
    capacities: saved
  };
}

module.exports = {
  CONFIG_FILE,
  DEFAULT_CAPACITIES,
  MIN_CAPACITY,
  MAX_CAPACITY,
  loadCapacityConfig,
  saveCapacityConfig,
  getCapacity,
  getAllCapacities,
  setCapacity
};
