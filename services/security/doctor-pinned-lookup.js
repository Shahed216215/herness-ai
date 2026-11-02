"use strict";

function normalizeHost(host) {
  return String(host).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

// The caller must validate every DNS address against the public-IP policy first.
function createPinnedLookup(expectedHost, records) {
  const expected = normalizeHost(expectedHost);
  if (!expected || !Array.isArray(records) || records.length === 0)
    throw new Error("Pinned lookup requires a host and resolved addresses");

  const pinned = records.map(r => ({
    address: r.address,
    family: Number(r.family)
  }));

  if (pinned.some(r =>
    !r.address || ![4, 6].includes(r.family)
  )) throw new Error("Pinned lookup received an invalid address record");

  return function pinnedLookup(hostname, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (typeof callback !== "function")
      throw new TypeError("Pinned lookup callback is required");

    if (normalizeHost(hostname) !== expected)
      return callback(new Error("Unexpected hostname during pinned lookup"));

    const opts = options && typeof options === "object" ? options : {};
    const family = typeof options === "number"
      ? options
      : Number(opts.family) || 0;

    const candidates = family === 4 || family === 6
      ? pinned.filter(r => r.family === family)
      : pinned;

    if (!candidates.length)
      return callback(new Error("No pinned DNS addresses for requested family"));

    if (opts.all) return callback(null, candidates);
    return callback(null, candidates[0].address, candidates[0].family);
  };
}

module.exports = { createPinnedLookup };
