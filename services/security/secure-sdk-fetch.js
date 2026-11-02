"use strict";

const { secureProviderRequest } =
  require("./secure-provider-request");

const ALLOWED_HOSTS = new Set([
  "api.openai.com",
  "api.groq.com",
  "generativelanguage.googleapis.com"
]);

function headerObject(input) {
  const out = {};
  if (!input) return out;
  try {
    if (typeof input.forEach === "function") {
      input.forEach((value, key) => { out[key] = value; });
    } else {
      for (const [key, value] of Object.entries(input)) {
        out[key] = String(value);
      }
    }
  } catch {
    throw new Error("Provider request headers are invalid");
  }
  return out;
}

async function secureSdkFetch(input, init = {}) {
  const rawUrl =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input && typeof input.url === "string"
        ? input.url
        : "";

  let url;
  try { url = new URL(rawUrl); }
  catch { throw new Error("SDK provider URL is invalid"); }

  if (url.protocol !== "https:" ||
      !ALLOWED_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username || url.password || url.hash) {
    throw new Error("SDK provider destination blocked by security policy");
  }

  const method = String(
    init.method || input?.method || "GET"
  ).toUpperCase();

  if (!["GET", "POST"].includes(method)) {
    throw new Error("SDK provider HTTP method blocked by security policy");
  }

  if (init.redirect && init.redirect !== "error") {
    throw new Error("SDK provider redirects are disabled");
  }

  const headers = headerObject(init.headers || input?.headers);
  let body = init.body;

  if (body === undefined && input && typeof input.clone === "function") {
    try { body = await input.clone().text(); } catch {}
  }

  let data;
  if (typeof body === "string" && body.length) {
    try { data = JSON.parse(body); }
    catch { data = body; }
  } else if (body !== undefined && body !== null) {
    data = body;
  }

  const result = await secureProviderRequest(url.toString(), {
    method,
    headers,
    data,
    maxRedirects: 0
  }, { allowHttpErrors: true });

  return new Response(
    result.body || JSON.stringify(result.data || {}),
    {
      status: result.status,
      headers: { "content-type": "application/json" }
    }
  );
}

module.exports = { secureSdkFetch, ALLOWED_HOSTS };
