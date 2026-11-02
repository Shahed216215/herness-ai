"use strict";

const dns = require("node:dns/promises");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const axios = require("axios");
const { validateProviderUrl, publicIp, localName } =
  require("./provider-url-policy");

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 30000;

function normalizeHost(host) {
  return String(host).toLowerCase()
    .replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function createPinnedLookup(expectedHost, records, onUse = () => {}) {
  const expected = normalizeHost(expectedHost);
  const pinned = records.map(r => ({
    address: r.address,
    family: r.family || net.isIP(r.address)
  }));

  return function pinnedLookup(hostname, options, callback) {
    if (normalizeHost(hostname) !== expected)
      return callback(new Error("Unexpected hostname during pinned lookup"));
    if (!pinned.length)
      return callback(new Error("No pinned DNS addresses"));

    const requestedFamily = Number(
      options && typeof options === "object"
        ? options.family
        : typeof options === "number" ? options : 0
    ) || 0;

    const candidates = requestedFamily === 4 || requestedFamily === 6
      ? pinned.filter(record => record.family === requestedFamily)
      : pinned;

    if (!candidates.length)
      return callback(new Error("No pinned DNS addresses for requested family"));

    onUse();
    if (options && typeof options === "object" && options.all)
      return callback(null, candidates);
    return callback(null, candidates[0].address, candidates[0].family);
  };
}

async function secureProviderRequest(rawUrl, requestConfig = {}, policy = {}) {
  const allowPrivate = policy.allowPrivate === true;
  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { throw new Error("Provider URL is invalid"); }

  if (parsed.protocol !== "https:" &&
      !(allowPrivate && parsed.protocol === "http:"))
    throw new Error("Provider transport requires HTTPS");

  if (parsed.username || parsed.password || parsed.hash)
    throw new Error("Provider URL contains forbidden credentials or fragment");

  const host = normalizeHost(parsed.hostname);
  if (localName(host) && !allowPrivate)
    throw new Error("Local provider hostname is blocked");

  const family = net.isIP(host);
  let records;

  if (family) {
    records = [{ address: host, family }];
  } else {
    try {
      records = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error("Provider hostname DNS resolution failed");
    }
  }

  if (!Array.isArray(records) || !records.length)
    throw new Error("Provider hostname returned no addresses");

  if (!allowPrivate && records.some(r => !publicIp(r.address)))
    throw new Error("Provider hostname resolves to a private or special-use IP");

  const hasNonPublic = records.some(r => !publicIp(r.address));
  if (parsed.protocol !== "https:" &&
      !(allowPrivate && hasNonPublic))
    throw new Error("Public provider endpoints must use HTTPS");

  await validateProviderUrl(rawUrl, {
    allowPrivate,
    lookup: async () => records.map(r => ({
      address: r.address,
      family: r.family || net.isIP(r.address)
    }))
  });

  let used = false;
  const lookup = createPinnedLookup(host, records, () => { used = true; });
  const agentOptions = {
    keepAlive: false,
    maxSockets: 1,
    lookup
  };
  const agent = parsed.protocol === "https:"
    ? new https.Agent({ ...agentOptions, rejectUnauthorized: true })
    : new http.Agent(agentOptions);

  try {
    const response = await axios.request({
      ...requestConfig,
      url: parsed.toString(),
      method: requestConfig.method || "POST",
      httpAgent: parsed.protocol === "http:" ? agent : undefined,
      httpsAgent: parsed.protocol === "https:" ? agent : undefined,
      proxy: false,
      maxRedirects: 0,
      timeout: TIMEOUT_MS,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      responseType: "text",
      transformResponse: [data => data],
      validateStatus: () => true
    });

    if (!used)
      throw new Error("Pinned DNS lookup was not used by the connection");

    const body = typeof response.data === "string" ? response.data : "";
    let data;
    try { data = body ? JSON.parse(body) : {}; }
    catch { data = {}; }

    if ((response.status < 200 || response.status >= 300) &&
        policy.allowHttpErrors !== true)
      throw new Error("Provider request failed with HTTP " + response.status);

    return { status: response.status, data, body };
  } finally {
    agent.destroy();
  }
}

module.exports = { secureProviderRequest, createPinnedLookup };
