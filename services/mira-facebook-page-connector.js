"use strict";

const secureProviderRequest = (...args) =>
  require("./security/secure-provider-request").secureProviderRequest(...args);

const GRAPH_HOST = "https://graph.facebook.com";
const PAGE_ID_RE = /^\d{1,32}$/;
const VERSION_RE = /^v\d{1,3}\.\d{1,2}$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function cleanText(value, max = 5000) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

function safeGraphError(response) {
  const graph = response && response.data && response.data.error;
  const code = graph && Number.isInteger(Number(graph.code))
    ? "META_GRAPH_ERROR_" + Number(graph.code)
    : "META_GRAPH_HTTP_" + Number(response && response.status || 0);
  const error = new Error("Meta Graph API request failed; inspect the sanitized status code.");
  error.code = code;
  error.httpStatus = Number(response && response.status || 0);
  return error;
}

function createFacebookPageConnector(options = {}) {
  const env = options.env || process.env;
  const request = options.request || secureProviderRequest;

  function config() {
    const pageId = cleanText(env.FACEBOOK_PAGE_ID, 32);
    const token = cleanText(env.FACEBOOK_PAGE_ACCESS_TOKEN, 4096);
    const version = cleanText(env.META_GRAPH_API_VERSION, 16);
    if (!PAGE_ID_RE.test(pageId))
      fail("FACEBOOK_PAGE_CONFIG_INVALID", "A numeric Facebook Page ID is required.");
    if (!token)
      fail("FACEBOOK_PAGE_TOKEN_MISSING", "Facebook Page access token is not configured.");
    if (!VERSION_RE.test(version))
      fail("META_GRAPH_VERSION_INVALID", "Set META_GRAPH_API_VERSION to an explicit supported version.");
    return { pageId, token, version };
  }

  function endpoint(cfg, suffix = "") {
    return GRAPH_HOST + "/" + cfg.version + "/" + cfg.pageId + suffix;
  }

  async function graphCall(url, method, token, data) {
    const response = await request(url, {
      method,
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      ...(data ? { data } : {}),
      maxRedirects: 0
    }, { allowHttpErrors: true });
    if (!response || response.status < 200 || response.status >= 300)
      throw safeGraphError(response);
    if (!response.data || typeof response.data !== "object")
      fail("META_GRAPH_INVALID_RESPONSE", "Meta Graph API returned an invalid response.");
    if (response.data.error) throw safeGraphError(response);
    return response.data;
  }

  async function detectCapabilities() {
    const cfg = config();
    try {
      const page = await graphCall(
        endpoint(cfg) + "?fields=id,name",
        "GET",
        cfg.token
      );
      if (String(page.id || "") !== cfg.pageId)
        fail("FACEBOOK_PAGE_ID_MISMATCH", "Meta returned a different Page ID.");
      return {
        pageId: cfg.pageId,
        pageName: cleanText(page.name, 200) || null,
        read: "VERIFIED",
        write: "NOT_VERIFIED",
        writeReason: "Write permission is not tested by publishing during capability detection.",
        manualPosting: "AVAILABLE"
      };
    } catch (error) {
      return {
        pageId: cfg.pageId,
        read: "FAILED",
        write: "NOT_VERIFIED",
        manualPosting: "AVAILABLE",
        errorCode: cleanText(error && error.code, 64) || "FACEBOOK_PAGE_READ_FAILED"
      };
    }
  }

  function createManualPostDraft(input = {}) {
    const message = cleanText(input.message, 5000);
    if (!message)
      fail("FACEBOOK_POST_MESSAGE_REQUIRED", "A non-empty post message is required.");
    return {
      status: "PENDING_MANUAL_POST",
      pageId: cleanText(input.pageId || env.FACEBOOK_PAGE_ID, 32) || null,
      message,
      instructions: "Review the text, publish it manually on the intended Facebook Page, then import the resulting post URL for verification.",
      published: false,
      verified: false
    };
  }

  async function publishPost(input = {}) {
    if (input.approved !== true)
      fail("FACEBOOK_PUBLISH_APPROVAL_REQUIRED", "Explicit approval is required before publishing.");
    const cfg = config();
    const message = cleanText(input.message, 5000);
    if (!message)
      fail("FACEBOOK_POST_MESSAGE_REQUIRED", "A non-empty post message is required.");
    const result = await graphCall(
      endpoint(cfg, "/feed"),
      "POST",
      cfg.token,
      { message }
    );
    const postId = cleanText(result.id, 128);
    if (!postId)
      fail("FACEBOOK_PUBLISH_UNCONFIRMED", "Meta did not return a post ID.");
    return {
      status: "PENDING_READBACK",
      pageId: cfg.pageId,
      postId,
      published: true,
      verified: false
    };
  }

  function parsePagePostUrl(rawUrl) {
    let url;
    try { url = new URL(String(rawUrl || "")); }
    catch { fail("FACEBOOK_POST_URL_INVALID", "A valid Facebook post URL is required."); }
    const hosts = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"]);
    if (url.protocol !== "https:" || !hosts.has(url.hostname.toLowerCase()))
      fail("FACEBOOK_POST_URL_INVALID", "Only standard HTTPS Facebook URLs are accepted.");
    if (url.username || url.password || url.hash ||
        ["access_token", "token", "appsecret_proof"].some(key => url.searchParams.has(key)))
      fail("FACEBOOK_POST_URL_INVALID", "Facebook post URL contains forbidden components.");
    const pathMatch = url.pathname.match(/\/([0-9]{1,32})\/(?:posts|permalink)\/([0-9]{1,32})\/?$/);
    const storyId = url.searchParams.get("story_fbid") || url.searchParams.get("fbid");
    const queryPageId = url.searchParams.get("id");
    const id = pathMatch
      ? pathMatch[1] + "_" + pathMatch[2]
      : storyId && queryPageId && /^\d{1,32}$/.test(queryPageId)
        ? queryPageId + "_" + storyId
        : storyId || (url.pathname.match(/\/permalink\/([0-9]+)/) || [])[1];
    if (!id || !/^\d{1,32}(?:_\d{1,32})?$/.test(id))
      fail("FACEBOOK_POST_URL_UNSUPPORTED", "The URL does not contain a supported numeric post ID.");
    const safeUrl = new URL(url.origin + url.pathname);
    for (const key of ["story_fbid", "fbid", "id"])
      if (url.searchParams.has(key)) safeUrl.searchParams.set(key, url.searchParams.get(key));
    return { postId: id, sourceUrl: safeUrl.toString() };
  }

  async function verifyPost(input = {}) {
    const cfg = config();
    const postId = cleanText(input.postId, 128);
    if (!/^\d{1,32}(?:_\d{1,32})?$/.test(postId))
      fail("FACEBOOK_POST_ID_INVALID", "A supported numeric Facebook post ID is required.");
    const url = GRAPH_HOST + "/" + cfg.version + "/" + postId +
      "?fields=id,message,permalink_url,from";
    const result = await graphCall(url, "GET", cfg.token);
    if (String(result.id || "") !== postId)
      fail("FACEBOOK_READBACK_MISMATCH", "Readback returned a different post ID.");
    if (result.from && result.from.id && String(result.from.id) !== cfg.pageId)
      fail("FACEBOOK_READBACK_PAGE_MISMATCH", "Readback post belongs to a different Page.");
    return {
      status: "VERIFIED",
      pageId: cfg.pageId,
      postId,
      message: cleanText(result.message, 5000),
      permalink: cleanText(result.permalink_url, 2048) || null,
      sourceIntegrity: "META_READBACK",
      canonicalMemoryWrite: false
    };
  }

  async function importPostUrl(input = {}) {
    const parsed = parsePagePostUrl(input.url);
    const verified = await verifyPost({ postId: parsed.postId });
    return { ...verified, submittedUrl: parsed.sourceUrl };
  }

  return {
    detectCapabilities,
    createManualPostDraft,
    publishPost,
    parsePagePostUrl,
    verifyPost,
    importPostUrl
  };
}

module.exports = { createFacebookPageConnector };
