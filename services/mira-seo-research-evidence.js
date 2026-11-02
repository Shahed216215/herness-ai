"use strict";

function parsePayload(raw) {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : null;
}

function extractSearchEvidence(raw) {
  const payload = parsePayload(raw);

  const searchResults = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.results)
      ? payload.results
      : null;

  if (!searchResults) {
    return {
      success: false,
      evidence: [],
      reason: "SEARCH_RESULT_FORMAT_INVALID"
    };
  }

  const evidence = searchResults.slice(0, 20).map((item, index) => {
    const title =
      typeof item?.title === "string" ? item.title.trim() : "";
    const url =
      typeof item?.url === "string"
        ? item.url.trim()
        : typeof item?.link === "string"
          ? item.link.trim()
          : "";
    const snippet =
      typeof item?.snippet === "string"
        ? item.snippet.trim()
        : typeof item?.content === "string"
          ? item.content.trim()
          : "";

    let validUrl = false;

    try {
      const parsed = new URL(url);
      validUrl =
        ["http:", "https:"].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password;
    } catch {
      validUrl = false;
    }

    return {
      index: index + 1,
      title: title.slice(0, 500),
      url: validUrl ? url : null,
      snippet: snippet.slice(0, 3000),
      sourceLinkValidated: validUrl,
      evidenceStatus:
        validUrl && title && snippet
          ? "source_reference_complete"
          : "incomplete_or_unverified"
    };
  });

  return {
    success: true,
    evidence,
    evidenceCount: evidence.length,
    completeSourceCount: evidence.filter(
      item => item.evidenceStatus === "source_reference_complete"
    ).length,
    note:
      "A valid URL and snippet do not independently prove source authenticity or factual accuracy."
  };
}

module.exports = {
  extractSearchEvidence
};
