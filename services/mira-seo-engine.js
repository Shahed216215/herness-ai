"use strict";

const LIMITS = Object.freeze({
  keywords: 30,
  keywordLength: 120,
  html: 200000,
  robots: 20000,
  sitemap: 100000,
  title: 300,
  pageUrl: 2048
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

function safeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) &&
      !parsed.username && !parsed.password
      ? parsed
      : null;
  } catch {
    return null;
  }
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
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function attributes(tag) {
  const result = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/g;
  let match;
  while ((match = re.exec(tag))) {
    result[match[1].toLowerCase()] =
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function metaTags(html) {
  return (html.match(/<meta\b[^>]*>/gi) || []).map(attributes);
}

function extractMeta(html, name) {
  const found = metaTags(html).find(attrs =>
    (attrs.name || "").toLowerCase() === name.toLowerCase()
  );
  return found ? found.content || "" : "";
}

function extractProperty(html, property) {
  const found = metaTags(html).find(attrs =>
    (attrs.property || "").toLowerCase() === property.toLowerCase()
  );
  return found ? found.content || "" : "";
}

function extractLinkTags(html) {
  return (html.match(/<link\b[^>]*>/gi) || []).map(attributes);
}

function collectJsonLd(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = attributes(match[1]);
    if ((attrs.type || "").toLowerCase().split(";")[0].trim() ===
        "application/ld+json") {
      scripts.push(match[2].trim());
    }
  }

  const types = [];
  let invalidCount = 0;
  for (const source of scripts) {
    try {
      const parsed = JSON.parse(source);
      const visit = value => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        const type = value["@type"];
        for (const item of Array.isArray(type) ? type : [type]) {
          if (typeof item === "string" && item.trim()) types.push(item.trim());
        }
        if (value["@graph"]) visit(value["@graph"]);
      };
      visit(parsed);
    } catch {
      invalidCount += 1;
    }
  }

  return {
    scriptCount: scripts.length,
    validScriptCount: scripts.length - invalidCount,
    invalidScriptCount: invalidCount,
    types: [...new Set(types)].slice(0, 50),
    findings: invalidCount
      ? ["One or more JSON-LD blocks contain invalid JSON."]
      : scripts.length
        ? []
        : ["No JSON-LD structured data block was supplied."]
  };
}

function analyzeLinks(html, pageUrl) {
  const tags = (html.match(/<a\b[^>]*>/gi) || []).map(attributes);
  let internal = 0;
  let external = 0;
  let absolute = 0;
  let nofollow = 0;
  let missingHref = 0;
  let invalidHref = 0;
  const base = pageUrl ? safeHttpUrl(pageUrl) : null;

  for (const attrs of tags) {
    const href = (attrs.href || "").trim();
    if (!href) {
      missingHref += 1;
      continue;
    }
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;

    let parsed;
    try {
      parsed = new URL(href, base || undefined);
    } catch {
      invalidHref += 1;
      continue;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      invalidHref += 1;
      continue;
    }
    absolute += 1;
    if (base && parsed.origin === base.origin) internal += 1;
    else if (base) external += 1;
    if ((attrs.rel || "").toLowerCase().split(/\s+/).includes("nofollow")) {
      nofollow += 1;
    }
  }

  return {
    totalAnchorTags: tags.length,
    internal: base ? internal : null,
    external: base ? external : null,
    absolute,
    nofollow,
    missingHref,
    invalidHref,
    scope: base ? "classified_against_page_origin" : "absolute_links_only"
  };
}

function analyzeOnPage(html, keywords, pageUrl = "") {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = stripTags(titleMatch ? titleMatch[1] : "");
  const description = extractMeta(html, "description");
  const metas = metaTags(html);
  const links = extractLinkTags(html);
  const headings = {};

  for (let i = 1; i <= 6; i++) {
    const re = new RegExp("<h" + i + "\\b[^>]*>([\\s\\S]*?)</h" + i + "\\s*>", "gi");
    headings["h" + i] = [];
    let match;
    while ((match = re.exec(html))) headings["h" + i].push(stripTags(match[1]));
  }

  const canonicalTags = links.filter(a =>
    (a.rel || "").toLowerCase().split(/\s+/).includes("canonical")
  );
  const canonicalUrl = canonicalTags.length === 1
    ? safeHttpUrl(canonicalTags[0].href || "")
    : null;
  const page = pageUrl ? safeHttpUrl(pageUrl) : null;
  const canonicalFindings = [];
  if (canonicalTags.length === 0) canonicalFindings.push("Canonical link is missing.");
  if (canonicalTags.length > 1) canonicalFindings.push("Multiple canonical links were found.");
  if (canonicalTags.length === 1 && !canonicalUrl) canonicalFindings.push("Canonical URL is not an absolute HTTP(S) URL.");
  if (canonicalUrl && page && canonicalUrl.origin !== page.origin) {
    canonicalFindings.push("Canonical URL points to a different origin than the supplied page URL.");
  }

  const images = (html.match(/<img\b[^>]*>/gi) || []).map(attributes);
  const missingAlt = images.filter(img => !Object.prototype.hasOwnProperty.call(img, "alt"));
  const emptyAlt = images.filter(img =>
    Object.prototype.hasOwnProperty.call(img, "alt") && !img.alt.trim()
  );

  const robots = metas.filter(attrs =>
    ["robots", "googlebot"].includes((attrs.name || "").toLowerCase())
  );
  const robotsContent = robots.map(attrs => attrs.content || "").join(",").toLowerCase();
  const noindex = /(^|[\s,])noindex([\s,]|$)/.test(robotsContent);
  const nofollow = /(^|[\s,])nofollow([\s,]|$)/.test(robotsContent);

  const htmlTag = (html.match(/<html\b[^>]*>/i) || [""])[0];
  const htmlAttrs = attributes(htmlTag);
  const hasCharset = metas.some(attrs =>
    Boolean(attrs.charset) ||
    ((attrs["http-equiv"] || "").toLowerCase() === "content-type" &&
      /charset\s*=\s*[^;\s]+/i.test(attrs.content || ""))
  );
  const hasViewport = metas.some(attrs =>
    (attrs.name || "").toLowerCase() === "viewport" && Boolean(attrs.content)
  );

  const alternates = links.filter(attrs =>
    (attrs.rel || "").toLowerCase().split(/\s+/).includes("alternate") &&
    attrs.hreflang
  );
  const invalidHreflang = alternates.filter(attrs =>
    !/^(x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(attrs.hreflang)
  );

  const og = {
    title: extractProperty(html, "og:title"),
    description: extractProperty(html, "og:description"),
    type: extractProperty(html, "og:type"),
    url: extractProperty(html, "og:url"),
    image: extractProperty(html, "og:image")
  };
  const missingOpenGraph = Object.keys(og).filter(key => !og[key]);
  const twitter = {
    card: extractMeta(html, "twitter:card"),
    title: extractMeta(html, "twitter:title"),
    description: extractMeta(html, "twitter:description"),
    image: extractMeta(html, "twitter:image")
  };
  const missingTwitter = Object.keys(twitter).filter(key => !twitter[key]);

  const structuredData = collectJsonLd(html);
  const linkAnalysis = analyzeLinks(html, pageUrl);
  const bodyText = stripTags(html);
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const headingLevels = [];
  for (let i = 1; i <= 6; i++) {
    const re = new RegExp("<h" + i + "\\b", "gi");
    const count = (html.match(re) || []).length;
    for (let j = 0; j < count; j++) headingLevels.push(i);
  }
  const skippedHeadingLevels = [];
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) {
      skippedHeadingLevels.push({
        from: "h" + headingLevels[i - 1],
        to: "h" + headingLevels[i]
      });
    }
  }

  const body = bodyText.toLowerCase();
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
    { name: "title_present", passed: !!title, severity: "HIGH" },
    { name: "title_length", passed: title.length >= 30 && title.length <= 60, severity: "MEDIUM" },
    { name: "description_present", passed: !!description, severity: "MEDIUM" },
    { name: "description_length", passed: description.length >= 70 && description.length <= 160, severity: "LOW" },
    { name: "single_h1", passed: headings.h1.length === 1, severity: "MEDIUM" },
    { name: "canonical_valid", passed: canonicalTags.length === 1 && Boolean(canonicalUrl) && canonicalFindings.length === 0, severity: "HIGH" },
    { name: "images_have_alt", passed: missingAlt.length === 0, severity: "MEDIUM" },
    { name: "html_lang_present", passed: Boolean(htmlAttrs.lang), severity: "MEDIUM" },
    { name: "charset_present", passed: hasCharset, severity: "LOW" },
    { name: "viewport_present", passed: hasViewport, severity: "MEDIUM" },
    { name: "indexable_by_meta_robots", passed: !noindex, severity: "HIGH" },
    { name: "open_graph_complete", passed: missingOpenGraph.length === 0, severity: "LOW" },
    { name: "json_ld_valid", passed: structuredData.scriptCount === 0 || structuredData.invalidScriptCount === 0, severity: "LOW" }
  ];

  const passed = checks.filter(c => c.passed).length;
  const findings = [];
  for (const check of checks) {
    if (!check.passed) findings.push({
      code: check.name.toUpperCase(),
      severity: check.severity,
      message: "SEO check failed: " + check.name
    });
  }
  for (const message of canonicalFindings) findings.push({
    code: "CANONICAL_CONFIGURATION",
    severity: "HIGH",
    message
  });
  if (nofollow) findings.push({
    code: "META_NOINDEX_FOLLOW_POLICY",
    severity: "HIGH",
    message: "A meta robots directive contains nofollow; verify this is intentional."
  });
  if (emptyAlt.length) findings.push({
    code: "EMPTY_IMAGE_ALT",
    severity: "LOW",
    message: "Some images have empty alt text; confirm they are decorative."
  });
  if (skippedHeadingLevels.length) findings.push({
    code: "HEADING_LEVEL_SKIPS",
    severity: "LOW",
    message: "Heading outline skips one or more levels."
  });
  if (invalidHreflang.length) findings.push({
    code: "HREFLANG_INVALID",
    severity: "MEDIUM",
    message: "One or more hreflang values are invalid."
  });
  if (structuredData.invalidScriptCount) findings.push({
    code: "JSON_LD_INVALID",
    severity: "MEDIUM",
    message: "One or more JSON-LD blocks could not be parsed."
  });
  if (wordCount > 0 && wordCount < 300) findings.push({
    code: "LOW_VISIBLE_WORD_COUNT",
    severity: "LOW",
    message: "Visible text is under 300 words; review whether the page fully satisfies its search intent."
  });

  return {
    title,
    titleLength: title.length,
    metaDescription: description,
    metaDescriptionLength: description.length,
    headings,
    h1Count: headings.h1.length,
    skippedHeadingLevels,
    canonical: canonicalTags.length === 1 ? canonicalTags[0].href || null : null,
    canonicalCount: canonicalTags.length,
    canonicalFindings,
    imageCount: images.length,
    imagesMissingAlt: missingAlt.length,
    imagesEmptyAlt: emptyAlt.length,
    document: {
      htmlLang: htmlAttrs.lang || null,
      charsetPresent: hasCharset,
      viewportPresent: hasViewport,
      metaRobots: robots.map(attrs => attrs.content || ""),
      noindex,
      nofollow
    },
    openGraph: {
      fields: og,
      missingFields: missingOpenGraph
    },
    twitterCards: {
      fields: twitter,
      missingFields: missingTwitter
    },
    hreflang: {
      alternateCount: alternates.length,
      invalidCount: invalidHreflang.length,
      values: alternates.map(attrs => attrs.hreflang)
    },
    structuredData,
    links: linkAnalysis,
    content: {
      visibleWordCount: wordCount,
      thinContentHeuristic: wordCount > 0 && wordCount < 300,
      disclaimer: "Word-count threshold is a review heuristic, not a Google ranking rule."
    },
    keywordChecks,
    checks,
    findings,
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
  const invalidUrls = urls.filter(url => !safeHttpUrl(url));
  const normalized = urls
    .map(url => safeHttpUrl(url))
    .filter(Boolean)
    .map(parsed => {
      parsed.hash = "";
      return parsed.href;
    });
  const duplicateCount = normalized.length - new Set(normalized).size;

  if (!isXml) findings.push("Expected urlset or sitemapindex root element.");
  if (!urls.length) findings.push("No loc entries found.");
  if (invalidUrls.length) findings.push("Some loc entries are not absolute HTTP(S) URLs.");
  if (duplicateCount) findings.push("Duplicate loc entries were found.");

  return {
    provided: true,
    rootRecognized: isXml,
    urlCount: urls.length,
    invalidUrlCount: invalidUrls.length,
    duplicateCount,
    findings
  };
}

function parseCsvRows(source) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      if (cell.length) throw new Error("SEARCH_CONSOLE_CSV_INVALID_QUOTE");
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("SEARCH_CONSOLE_CSV_UNCLOSED_QUOTE");
  row.push(cell.replace(/\r$/, ""));
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function parseMetric(value, field, options = {}) {
  const normalized = String(value || "").trim().replace(/,/g, "");
  const percent = normalized.endsWith("%");
  const numeric = Number(percent ? normalized.slice(0, -1) : normalized);
  if (!normalized || !Number.isFinite(numeric) || numeric < 0) {
    throw new Error("SEARCH_CONSOLE_CSV_INVALID_" + field.toUpperCase());
  }
  if (options.positive && numeric <= 0) {
    throw new Error("SEARCH_CONSOLE_CSV_INVALID_" + field.toUpperCase());
  }
  return options.percent
    ? (percent ? numeric : numeric <= 1 ? numeric * 100 : numeric)
    : numeric;
}

function analyzeSearchConsoleCsv(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("SEARCH_CONSOLE_CSV_REQUIRED");
  }
  if (source.length > 200000) {
    throw new Error("SEARCH_CONSOLE_CSV_TOO_LARGE");
  }
  const rows = parseCsvRows(source.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("SEARCH_CONSOLE_CSV_HEADER_AND_ROWS_REQUIRED");
  if (rows.length - 1 > 5000) throw new Error("SEARCH_CONSOLE_CSV_TOO_MANY_ROWS");

  const headers = rows[0].map(value => value.trim().toLowerCase());
  const aliases = {
    query: ["query", "top queries"],
    page: ["page", "top pages"],
    clicks: ["clicks"],
    impressions: ["impressions"],
    ctr: ["ctr"],
    position: ["position", "average position"]
  };
  const indexes = {};
  for (const [field, names] of Object.entries(aliases)) {
    indexes[field] = headers.findIndex(value => names.includes(value));
    if (indexes[field] < 0) {
      throw new Error("SEARCH_CONSOLE_CSV_MISSING_COLUMN_" + field.toUpperCase());
    }
  }

  const records = [];
  let skippedRows = 0;
  for (const values of rows.slice(1)) {
    if (values.length < headers.length) {
      skippedRows++;
      continue;
    }
    try {
      const query = values[indexes.query].trim();
      const page = values[indexes.page].trim();
      if (!query || !page) throw new Error("missing dimension");
      const clicks = parseMetric(values[indexes.clicks], "clicks");
      const impressions = parseMetric(values[indexes.impressions], "impressions");
      const ctr = parseMetric(values[indexes.ctr], "ctr", { percent: true });
      const position = parseMetric(values[indexes.position], "position", { positive: true });
      if (ctr > 100) throw new Error("SEARCH_CONSOLE_CSV_INVALID_CTR");
      records.push({ query, page, clicks, impressions, ctr, position });
    } catch {
      skippedRows++;
    }
  }
  if (!records.length) throw new Error("SEARCH_CONSOLE_CSV_NO_VALID_DATA_ROWS");

  const queryMap = new Map();
  const pageMap = new Map();
  for (const record of records) {
    const queryKey = record.query.toLocaleLowerCase();
    const pageKey = record.page;
    const q = queryMap.get(queryKey) || {
      query: record.query, clicks: 0, impressions: 0, weightedCtr: 0,
      weightedPosition: 0, rows: 0, pages: new Set()
    };
    q.clicks += record.clicks;
    q.impressions += record.impressions;
    q.weightedCtr += record.ctr * record.impressions;
    q.weightedPosition += record.position * record.impressions;
    q.rows++;
    q.pages.add(pageKey);
    queryMap.set(queryKey, q);

    const p = pageMap.get(pageKey) || {
      page: pageKey, clicks: 0, impressions: 0, weightedCtr: 0,
      weightedPosition: 0, rows: 0
    };
    p.clicks += record.clicks;
    p.impressions += record.impressions;
    p.weightedCtr += record.ctr * record.impressions;
    p.weightedPosition += record.position * record.impressions;
    p.rows++;
    pageMap.set(pageKey, p);
  }
  const summarize = item => ({
    ...item,
    ctr: item.impressions
      ? Number((item.weightedCtr / item.impressions).toFixed(2)) : 0,
    averagePosition: item.impressions
      ? Number((item.weightedPosition / item.impressions).toFixed(2)) : null
  });
  const queries = [...queryMap.values()].map(item => {
    const summary = summarize(item);
    delete summary.weightedCtr;
    delete summary.weightedPosition;
    delete summary.rows;
    summary.pages = [...item.pages].slice(0, 20);
    summary.opportunitySignals = [];
    if (summary.impressions >= 100 && summary.ctr < 2) {
      summary.opportunitySignals.push("HIGH_IMPRESSIONS_LOW_CTR_REVIEW");
    }
    if (summary.averagePosition >= 8 && summary.averagePosition <= 20) {
      summary.opportunitySignals.push("POSITIONS_8_TO_20_REVIEW");
    }
    return summary;
  }).sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
  const pages = [...pageMap.values()].map(item => {
    const summary = summarize(item);
    delete summary.weightedCtr;
    delete summary.weightedPosition;
    delete summary.rows;
    return summary;
  }).sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page));

  return {
    success: true,
    source: "USER_SUPPLIED_SEARCH_CONSOLE_CSV",
    importedRows: records.length,
    skippedRows,
    totals: {
      clicks: records.reduce((sum, item) => sum + item.clicks, 0),
      impressions: records.reduce((sum, item) => sum + item.impressions, 0)
    },
    queries,
    pages,
    methodology: [
      "CTR and average position are impressions-weighted when query/page rows are aggregated.",
      "Opportunity labels are review heuristics, not guaranteed ranking or traffic gains.",
      "Only rows included in the supplied export are analyzed; export filters and date range are not independently verified.",
      "No Google account connection, API request or website fetch is performed."
    ]
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
  const searchConsoleCsv = text(input.searchConsoleCsv, 200000, "searchConsoleCsv");
  const pageUrl = text(input.pageUrl, LIMITS.pageUrl, "pageUrl");
  if (pageUrl && !safeHttpUrl(pageUrl)) {
    throw new Error("pageUrl must be an absolute HTTP(S) URL without credentials.");
  }
  const keywords = analyzeKeywords(input);
  const onPage = html
    ? analyzeOnPage(html, keywords.map(k => k.keyword), pageUrl)
    : null;

  return {
    success: true,
    engine: "Mira SEO Engine",
    version: "2.0.0",
    mode: "offline_local_analysis",
    networkAccess: false,
    keywordAnalysis: keywords,
    onPage,
    technical: {
      robotsTxt: analyzeRobots(robotsTxt),
      sitemap: analyzeSitemap(sitemapXml)
    },
    searchPerformance: searchConsoleCsv
      ? analyzeSearchConsoleCsv(searchConsoleCsv)
      : { provided: false, source: "NOT_CONNECTED" },
    contentBrief: createContentBrief(input, keywords),
    limitations: [
      "No live SERP or competitor data is collected by the offline audit.",
      "No website URL is fetched; pageUrl is used only to classify supplied links.",
      "No Google Search Console or Analytics data is accessed.",
      "Structured-data checks validate JSON syntax and discover @type labels; they do not validate Schema.org semantics.",
      "Visible word count and checklist scores are heuristics, not Google ranking factors or ranking predictions.",
      "Core Web Vitals, HTTP status, redirects, rendered JavaScript, backlinks, search volume, CPC and keyword difficulty require separate authorized data sources."
    ]
  };
}

module.exports = {
  audit,
  classifyIntent,
  analyzeOnPage,
  analyzeRobots,
  analyzeSitemap,
  analyzeSearchConsoleCsv,
  collectJsonLd,
  analyzeLinks,
  LIMITS
};
