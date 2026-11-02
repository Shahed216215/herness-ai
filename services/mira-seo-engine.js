"use strict";

const LIMITS = Object.freeze({
  keywords: 30,
  keywordLength: 120,
  html: 200000,
  robots: 20000,
  sitemap: 100000,
  title: 300
});

function text(value, max, field) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new Error(field + " must be a string.");
  }
  if (value.length > max) {
    throw new Error(field + " exceeds the maximum length.");
  }
  return value.trim();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function attributes(tag) {
  const result = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = re.exec(tag))) {
    result[match[1].toLowerCase()] =
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function extractMeta(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = attributes(tag);
    if ((attrs.name || "").toLowerCase() === name.toLowerCase()) {
      return attrs.content || "";
    }
  }
  return "";
}

function analyzeOnPage(html, keywords) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = stripTags(titleMatch ? titleMatch[1] : "");
  const description = extractMeta(html, "description");

  const headings = {};
  for (let i = 1; i <= 6; i++) {
      const re = new RegExp("<h" + i + "\\b[^>]*>([\\s\\S]*?)</h" + i + "\\s*>", "gi");
    headings["h" + i] = [];
    let match;
    while ((match = re.exec(html))) {
      headings["h" + i].push(stripTags(match[1]));
    }
  }

  const canonicalTags = (html.match(/<link\b[^>]*>/gi) || [])
    .map(attributes)
    .filter(a => (a.rel || "").toLowerCase().split(/\s+/).includes("canonical"));

  const images = (html.match(/<img\b[^>]*>/gi) || []).map(attributes);
  const missingAlt = images.filter(img => !Object.prototype.hasOwnProperty.call(img, "alt"));

  const body = stripTags(html).toLowerCase();
  const keywordChecks = keywords.map(keyword => {
    const term = keyword.toLowerCase();
    return {
      keyword,
      inTitle: title.toLowerCase().includes(term),
      inDescription: description.toLowerCase().includes(term),
      inH1: headings.h1.some(h => h.toLowerCase().includes(term)),
      inBody: body.includes(term)
    };
  });

  const checks = [
    { name: "title_present", passed: !!title },
    { name: "title_length", passed: title.length >= 30 && title.length <= 60 },
    { name: "description_present", passed: !!description },
    { name: "description_length", passed: description.length >= 70 && description.length <= 160 },
    { name: "single_h1", passed: headings.h1.length === 1 },
    { name: "canonical_present", passed: canonicalTags.length === 1 },
    { name: "images_have_alt", passed: missingAlt.length === 0 }
  ];

  const passed = checks.filter(c => c.passed).length;

  return {
    title,
    titleLength: title.length,
    metaDescription: description,
    metaDescriptionLength: description.length,
    headings,
    h1Count: headings.h1.length,
    canonical: canonicalTags.length === 1 ? canonicalTags[0].href || null : null,
    canonicalCount: canonicalTags.length,
    imageCount: images.length,
    imagesMissingAlt: missingAlt.length,
    keywordChecks,
    checks,
    checklistScore: Math.round(passed / checks.length * 100),
    scoreDisclaimer: "Checklist score only; not a Google ranking prediction."
  };
}

function hasBengaliKeyword(value, terms) {
  return terms.some(term => {
    const pattern = new RegExp(
      "(^|[^\\p{L}\\p{N}_])" + term + "($|[^\\p{L}\\p{N}_])",
      "u"
    );
    return pattern.test(value);
  });
}

function classifyIntent(keyword) {
  const q = keyword.toLowerCase();

  if (/\b(price|cost|buy|purchase|order|cheap|discount)\b/.test(q) ||
      hasBengaliKeyword(q, ["কিনুন", "দাম", "মূল্য"])) {
    return "transactional";
  }
  if (/\b(best|top|review|vs|compare|comparison)\b/.test(q) ||
      hasBengaliKeyword(q, ["সেরা", "তুলনা"])) {
    return "commercial";
  }
  if (/\b(how|what|why|when|where|guide|tutorial|meaning)\b/.test(q) ||
      hasBengaliKeyword(q, ["কিভাবে", "কী", "কেন"])) {
    return "informational";
  }
  if (/\b(login|sign in|official website|website)\b/.test(q) ||
      hasBengaliKeyword(q, ["লগইন"])) {
    return "navigational";
  }
  return "undetermined";
}

function analyzeKeywords(input) {
  if (input.keywords !== undefined && !Array.isArray(input.keywords)) {
    throw new Error("keywords must be an array.");
  }
  const keywords = input.keywords === undefined ? [] : input.keywords;
  if (keywords.length > LIMITS.keywords) {
    throw new Error("Maximum 30 keywords are allowed.");
  }

  return keywords.map(value => {
    const keyword = text(value, LIMITS.keywordLength, "keyword");
    if (!keyword) throw new Error("Keyword cannot be empty.");
    return {
      keyword,
      intent: classifyIntent(keyword),
      wordCount: keyword.split(/\s+/).length,
      recommendation:
        "Validate intent against actual search results before publishing."
    };
  });
}

function analyzeRobots(value) {
  if (!value) return { provided: false, findings: [] };

  const findings = [];
  const lines = value.split(/\r?\n/);
  const userAgents = lines.filter(l => /^\s*user-agent\s*:/i.test(l));
  const sitemaps = lines.filter(l => /^\s*sitemap\s*:/i.test(l));
  const disallows = lines.filter(l => /^\s*disallow\s*:/i.test(l));

  if (!userAgents.length) findings.push("No User-agent directive found.");
  if (!sitemaps.length) findings.push("No Sitemap directive found.");
  if (disallows.some(l => /^\s*disallow\s*:\s*\/\s*$/i.test(l))) {
    findings.push("A global Disallow: / directive may block crawling.");
  }

  return {
    provided: true,
    userAgentDirectives: userAgents.length,
    sitemapDirectives: sitemaps.length,
    disallowDirectives: disallows.length,
    findings
  };
}

function analyzeSitemap(value) {
  if (!value) return { provided: false, findings: [] };

  const findings = [];
  const isXml = /<urlset\b|<sitemapindex\b/i.test(value);
  const urls = (value.match(/<loc(?:\s[^>]*)?>[\s\S]*?<\/loc\s*>/gi) || [])
    .map(v => stripTags(v));

  if (!isXml) findings.push("Expected urlset or sitemapindex root element.");
  if (!urls.length) findings.push("No loc entries found.");

  const invalidUrls = urls.filter(url => !/^https?:\/\/[^ ]+/i.test(url));
  if (invalidUrls.length) findings.push("Some loc entries are not absolute HTTP(S) URLs.");

  return {
    provided: true,
    rootRecognized: isXml,
    urlCount: urls.length,
    invalidUrlCount: invalidUrls.length,
    findings
  };
}

function createContentBrief(input, keywordResults) {
  const primary = keywordResults[0]?.keyword || "";
  const secondary = keywordResults.slice(1).map(k => k.keyword);

  return {
    topic: primary || "User-defined topic",
    searchIntent: keywordResults[0]?.intent || "undetermined",
    suggestedTitle: primary ? primary + " — Complete Guide" : "",
    suggestedOutline: [
      "Introduction and searcher's problem",
      "What the topic means",
      "Main points and practical explanation",
      "Examples or comparison where relevant",
      "Frequently asked questions",
      "Conclusion and appropriate next step"
    ],
    secondaryKeywords: secondary,
    editorialNotes: [
      "Answer the dominant search intent directly.",
      "Use original, accurate and useful information.",
      "Avoid keyword stuffing and unsupported claims.",
      "Verify facts and sources before publication."
    ]
  };
}

function audit(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Input must be an object.");
  }

  const html = text(input.html, LIMITS.html, "html");
  const robotsTxt = text(input.robotsTxt, LIMITS.robots, "robotsTxt");
  const sitemapXml = text(input.sitemapXml, LIMITS.sitemap, "sitemapXml");
  const keywords = analyzeKeywords(input);

  const onPage = html ? analyzeOnPage(html, keywords.map(k => k.keyword)) : null;

  return {
    success: true,
    engine: "Mira SEO Engine",
    version: "1.0.0",
    mode: "offline_local_analysis",
    networkAccess: false,
    keywordAnalysis: keywords,
    onPage,
    technical: {
      robotsTxt: analyzeRobots(robotsTxt),
      sitemap: analyzeSitemap(sitemapXml)
    },
    contentBrief: createContentBrief(input, keywords),
    limitations: [
      "No live SERP or competitor data is collected.",
      "No website URL is fetched.",
      "No Google Search Console or Analytics data is accessed.",
      "Results are diagnostic suggestions, not ranking guarantees."
    ]
  };
}

module.exports = {
  audit,
  classifyIntent,
  analyzeOnPage,
  analyzeRobots,
  analyzeSitemap,
  LIMITS
};
