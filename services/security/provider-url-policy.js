"use strict";

const dns = require("node:dns/promises");
const net = require("node:net");

const V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8],
  ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4],
  ["240.0.0.0", 4]
].map(([ip, bits]) => {
  const n = ip.split(".").reduce((a, x) => (a * 256) + Number(x), 0);
  return { n, bits };
});

function v4Number(ip) {
  if (net.isIP(ip) !== 4) return null;
  return ip.split(".").reduce((a, x) => a * 256 + Number(x), 0);
}

function inV4Range(ip, base, bits) {
  const n = v4Number(ip);
  const b = v4Number(base);
  if (n === null || b === null) return false;
  const shift = 32 - bits;
  return Math.floor(n / (2 ** shift)) ===
         Math.floor(b / (2 ** shift));
}

function ipv4Public(ip) {
  if (net.isIP(ip) !== 4) return false;
  return !V4_BLOCKED.some(r =>
    Math.floor(v4Number(ip) / (2 ** (32 - r.bits))) ===
    Math.floor(r.n / (2 ** (32 - r.bits)))
  );
}

function ipv6Number(ip) {
  let s = ip.toLowerCase().split("%")[0];

  if (s.includes(".")) {
    const i = s.lastIndexOf(":");
    if (i < 0) return null;
    const tail = s.slice(i + 1);
    if (net.isIP(tail) !== 4) return null;
    const p = tail.split(".").map(Number);
    s = s.slice(0, i) + ":" +
      (((p[0] << 8) | p[1]).toString(16)) + ":" +
      (((p[2] << 8) | p[3]).toString(16));
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1]
    ? halves[1].split(":") : [];
  let groups;

  if (halves.length === 1) {
    if (left.length !== 8) return null;
    groups = left;
  } else {
    const zeros = 8 - left.length - right.length;
    if (zeros < 1) return null;
    groups = [...left, ...Array(zeros).fill("0"), ...right];
  }

  if (groups.length !== 8 ||
      groups.some(x => !/^[0-9a-f]{1,4}$/.test(x))) return null;

  return groups.reduce((n, x) => (n << 16n) | BigInt("0x" + x), 0n);
}

function publicIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return ipv4Public(ip);
  if (family !== 6) return false;

  const n = ipv6Number(ip);
  if (n === null) return false;

  // IPv4-mapped IPv6: apply the IPv4 policy to the embedded address.
  if ((n >> 32n) === 0xffffn) {
    const v4 = Number(n & 0xffffffffn);
    const dotted = [
      (v4 >>> 24) & 255, (v4 >>> 16) & 255,
      (v4 >>> 8) & 255, v4 & 255
    ].join(".");
    return ipv4Public(dotted);
  }

  // Conservative: only global-unicast 2000::/3 is eligible.
  if ((n >> 125n) !== 1n) return false;

  // Documentation, protocol-assignment and transition ranges.
  if (inV6Range(n, "2001:db8::", 32)) return false;
  if (inV6Range(n, "2001::", 23)) return false;
  if (inV6Range(n, "2002::", 16)) return false;
  if (inV6Range(n, "3fff::", 20)) return false;

  return true;
}

function inV6Range(n, base, bits) {
  const b = ipv6Number(base);
  if (b === null) return false;
  return (n >> BigInt(128 - bits)) ===
         (b >> BigInt(128 - bits));
}

function localName(host) {
  const h = String(host).toLowerCase()
    .replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".test");
}

async function validateProviderUrl(raw, options = {}) {
  const allowPrivate = options.allowPrivate === true;
  const lookup = options.lookup || dns.lookup;

  if (typeof raw !== "string" || !raw.trim())
    throw new Error("Provider URL is required");

  let u;
  try { u = new URL(raw); }
  catch { throw new Error("Provider URL is invalid"); }

  if (!["https:", "http:"].includes(u.protocol))
    throw new Error("Provider URL scheme is not allowed");
  if (u.username || u.password)
    throw new Error("Provider URL credentials are not allowed");
  if (u.hash)
    throw new Error("Provider URL fragments are not allowed");

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const family = net.isIP(host);
  const local = localName(host);

  if (local && !allowPrivate)
    throw new Error("Local provider hostname is blocked by policy");

  let records = [];
  if (family) {
    if (!publicIp(host) && !allowPrivate)
      throw new Error("Private or special-use provider IP is blocked");
    records = [{ address: host, family }];
  } else if (local) {
    records = await lookup(host, { all: true, verbatim: true });
  } else {
    try {
      records = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error("Provider hostname DNS resolution failed");
    }
  }

  if (!Array.isArray(records) || records.length === 0)
    throw new Error("Provider hostname returned no addresses");

  const hasNonPublic = records.some(r => !publicIp(r.address));
  if (hasNonPublic && !allowPrivate)
    throw new Error("Provider hostname resolves to a private or special-use IP");

  if (u.protocol !== "https:" &&
      !(allowPrivate && hasNonPublic))
    throw new Error("Public provider endpoints must use HTTPS");

  return u.toString();
}

module.exports = { validateProviderUrl, publicIp, localName };
