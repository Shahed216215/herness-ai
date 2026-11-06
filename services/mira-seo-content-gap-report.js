"use strict";

const MAX_KEYWORDS = 30;
const MAX_KEYWORD_LENGTH = 120;
const MAX_REPORT_ITEMS = 20;

function cleanString(value, field, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new TypeError("SEO_REPORT_INVALID_" + field.toUpperCase());
  }
  return value.trim();
}

function normalizeDomain(value) {
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || ""))
      ? String(value)
      : "https://" + String(value || "");
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol) ||
        parsed.username || parsed.password) return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function analyzeContentGaps(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("SEO_CONTENT_GAP_INPUT_OBJECT_REQUIRED");
  }
  const allowed = new Set(["targetKeywords", "ownDomain", "competitorIntelligence"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError("SEO_CONTENT_GAP_FIELD_NOT_ALLOWED:" + key);
  }
  if (!Array.isArray(input.targetKeywords) ||
      input.targetKeywords.length < 1 ||
      input.targetKeywords.length > MAX_KEYWORDS) {
    throw new TypeError("SEO_CONTENT_GAP_KEYWORDS_MUST_CONTAIN_1_TO_30_ITEMS");
  }
  const ownDomain = normalizeDomain(cleanString(input.ownDomain, "own_domain", 253));
  if (!ownDomain) throw new TypeError("SEO_CONTENT_GAP_OWN_DOMAIN_INVALID");
  const intelligence = input.competitorIntelligence;
  if (!intelligence || typeof intelligence !== "object" ||
      !Array.isArray(intelligence.queryReports) ||
      !Array.isArray(intelligence.competitorDomains)) {
    throw new TypeError("SEO_CONTENT_GAP_COMPETITOR_EVIDENCE_REQUIRED");
  }

  const seen = new Set();
  const keywords = input.targetKeywords.map(value => {
    const keyword = cleanString(value, "keyword", MAX_KEYWORD_LENGTH);
    const key = keyword.toLocaleLowerCase();
    if (seen.has(key)) throw new TypeError("SEO_CONTENT_GAP_DUPLICATE_KEYWORD");
    seen.add(key);
    return keyword;
  });

  const reports = [];
  for (const keyword of keywords) {
    const query = intelligence.queryReports.find(item =>
      typeof item?.query === "string" &&
      item.query.trim().toLocaleLowerCase() === keyword.toLocaleLowerCase()
    );
    if (!query) {
      reports.push({
        keyword,
        status: "INSUFFICIENT_EVIDENCE",
        signal: "NO_EXACT_MATCHING_RESEARCH_QUERY",
        candidateGap: false,
        evidence: []
      });
      continue;
    }

    const ownVisible = query.ownDomainVisible;
    const sources = Array.isArray(query.sources) ? query.sources : [];
    const evidence = sources.filter(source => {
      const domain = normalizeDomain(source?.url || "");
      return domain && domain !== ownDomain &&
        typeof source.title === "string" &&
        source.title.trim();
    }).slice(0, 10).map(source => ({
      domain: normalizeDomain(source.url),
      title: source.title.slice(0, 300),
      url: source.url
    }));

    if (ownVisible !== false || evidence.length === 0) {
      reports.push({
        keyword,
        status: "INSUFFICIENT_EVIDENCE",
        signal: ownVisible === true
          ? "OWN_DOMAIN_OBSERVED_IN_RETURNED_SAMPLE"
          : ownVisible === null
            ? "OWN_DOMAIN_NOT_CONFIGURED_IN_RESEARCH"
            : "NO_COMPLETE_COMPETITOR_SOURCE_EVIDENCE",
        candidateGap: false,
        evidence
      });
      continue;
    }

    reports.push({
      keyword,
      status: "CANDIDATE_GAP",
      signal: "OWN_DOMAIN_NOT_OBSERVED_COMPETITOR_SOURCES_PRESENT",
      candidateGap: true,
      evidence,
      interpretation: "A limited provider search sample suggests a topic to review; it does not prove missing content, ranking loss, or commercial competition."
    });
  }

  return {
    success: true,
    mode: "evidence_bounded_content_gap_candidates",
    ownDomain,
    targetKeywordCount: keywords.length,
    candidateGapCount: reports.filter(item => item.candidateGap).length,
    insufficientEvidenceCount: reports.filter(item =>
      item.status === "INSUFFICIENT_EVIDENCE"
    ).length,
    keywordReports: reports,
    limitations: [
      "Only exact user-supplied keywords matched to exact research queries are evaluated.",
      "A candidate gap requires the own domain to be absent from the returned sample and at least one complete competitor source URL/title.",
      "A candidate gap is not proof that content is missing, a competitor is direct, or a ranking opportunity exists.",
      "Provider result samples and ordering are not Google organic ranking data.",
      "No search volume, CPC, keyword difficulty, traffic, backlink or conversion metric is inferred."
    ]
  };
}

function markdownEscape(value) {
  return String(value ?? "—").replace(/[|\r\n]/g, " ").replace(/</g, "&lt;");
}

function generateSeoReport(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("SEO_REPORT_INPUT_OBJECT_REQUIRED");
  }
  const allowed = new Set([
    "siteName", "siteUrl", "generatedAt", "seoAudit",
    "competitorIntelligence", "contentGapAnalysis", "searchPerformance"
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError("SEO_REPORT_FIELD_NOT_ALLOWED:" + key);
  }
  const siteName = input.siteName === undefined
    ? "Website"
    : cleanString(input.siteName, "site_name", 120);
  const siteUrl = input.siteUrl === undefined
    ? "Not supplied"
    : cleanString(input.siteUrl, "site_url", 2048);
  const generatedAt = input.generatedAt === undefined
    ? "Not supplied"
    : cleanString(input.generatedAt, "generated_at", 80);
  const audit = input.seoAudit || null;
  if (audit !== null && (typeof audit !== "object" || Array.isArray(audit))) {
    throw new TypeError("SEO_REPORT_AUDIT_OBJECT_INVALID");
  }
  const competitor = input.competitorIntelligence || null;
  const gaps = input.contentGapAnalysis || null;
  const performance = input.searchPerformance || audit?.searchPerformance || null;

  const findings = Array.isArray(audit?.onPage?.findings)
    ? audit.onPage.findings.slice(0, MAX_REPORT_ITEMS)
    : [];
  const gapRows = Array.isArray(gaps?.keywordReports)
    ? gaps.keywordReports.slice(0, MAX_REPORT_ITEMS)
    : [];
  const competitorRows = Array.isArray(competitor?.competitorDomains)
    ? competitor.competitorDomains.slice(0, MAX_REPORT_ITEMS)
    : [];
  const queryRows = Array.isArray(performance?.queries)
    ? performance.queries.slice(0, MAX_REPORT_ITEMS)
    : [];
  const pageRows = Array.isArray(performance?.pages)
    ? performance.pages.slice(0, MAX_REPORT_ITEMS)
    : [];
  const checks = Array.isArray(audit?.onPage?.checks) ? audit.onPage.checks : [];
  const passed = checks.filter(item => item?.passed === true).length;

  const lines = [
    "# SEO Research Report",
    "",
    "- Website: " + markdownEscape(siteName),
    "- URL: " + markdownEscape(siteUrl),
    "- Generated at: " + markdownEscape(generatedAt),
    "- Report mode: deterministic, source-bounded, no paid SEO API",
    "",
    "## On-page audit",
    "",
    "- Checklist score: " + (Number.isFinite(audit?.onPage?.checklistScore)
      ? audit.onPage.checklistScore + "%" : "Not supplied"),
    "- Checks passed: " + passed + "/" + checks.length,
    "- Visible word count: " + (Number.isFinite(audit?.onPage?.content?.visibleWordCount)
      ? audit.onPage.content.visibleWordCount : "Not supplied"),
    "- Findings included: " + findings.length,
    "",
    "| Severity | Finding | Detail |",
    "|---|---|---|"
  ];
  if (!findings.length) lines.push("| — | No audit findings supplied | — |");
  else for (const finding of findings) {
    lines.push("| " + markdownEscape(finding.severity) + " | " +
      markdownEscape(finding.code) + " | " + markdownEscape(finding.message) + " |");
  }

  lines.push("", "## Search Console performance", "");
  if (!performance || performance.provided !== true) {
    lines.push("No Search Console CSV data was supplied.");
  } else {
    lines.push(
      "- Imported rows: " + (performance.importedRows ?? "Unknown"),
      "- Skipped rows: " + (performance.skippedRows ?? "Unknown"),
      "- Clicks: " + (performance.totals?.clicks ?? "Unknown"),
      "- Impressions: " + (performance.totals?.impressions ?? "Unknown"),
      "",
      "| Query | Clicks | Impressions | CTR | Avg. position |",
      "|---|---:|---:|---:|---:|"
    );
    for (const item of queryRows) lines.push("| " +
      [item.query, item.clicks, item.impressions,
        Number.isFinite(item.ctr) ? item.ctr + "%" : "—",
        item.averagePosition].map(markdownEscape).join(" | ") + " |");
    if (!queryRows.length) lines.push("| No query rows supplied | — | — | — | — |");
    if (pageRows.length) {
      lines.push("", "### Pages", "", "| Page | Clicks | Impressions | CTR | Avg. position |",
        "|---|---:|---:|---:|---:|");
      for (const item of pageRows) lines.push("| " +
        [item.page, item.clicks, item.impressions,
          Number.isFinite(item.ctr) ? item.ctr + "%" : "—",
          item.averagePosition].map(markdownEscape).join(" | ") + " |");
    }
  }

  lines.push("", "## Competitor research", "");
  if (!competitor) lines.push("No competitor intelligence was supplied.");
  else {
    lines.push("- Queries analysed: " + (competitor.searchCount ?? "Unknown"),
      "- Candidate domains: " + (competitor.competitorDomainCount ?? competitorRows.length),
      "- Freshness: " + (competitor.freshness?.status || "UNKNOWN"),
      "",
      "| Domain | Classification | Query coverage | Result count |",
      "|---|---|---:|---:|");
    if (!competitorRows.length) lines.push("| No domains supplied | — | — | — |");
    for (const item of competitorRows) lines.push("| " +
      [item.domain, item.competitorClassification,
        item.queryCoverageCount, item.resultCount].map(markdownEscape).join(" | ") + " |");
  }

  lines.push("", "## Content gap candidates", "");
  if (!gaps) lines.push("No content gap analysis was supplied.");
  else {
    lines.push("- Candidate gaps: " + (gaps.candidateGapCount ?? 0),
      "- Insufficient evidence: " + (gaps.insufficientEvidenceCount ?? 0),
      "",
      "| Keyword | Status | Signal | Evidence sources |",
      "|---|---|---|---:|");
    if (!gapRows.length) lines.push("| No keyword rows supplied | — | — | — |");
    for (const item of gapRows) {
      lines.push("| " +
        [item.keyword, item.status, item.signal,
          Array.isArray(item.evidence) ? item.evidence.length : 0]
          .map(markdownEscape).join(" | ") + " |");
      for (const source of (Array.isArray(item.evidence) ? item.evidence : [])) {
        lines.push("  - " + markdownEscape(source.title) + " — " +
          markdownEscape(source.url));
      }
    }
  }

  lines.push("", "## Methodology and limitations", "",
    "- This report is generated from supplied audit, Search Console CSV and research evidence only.",
    "- It does not fetch or crawl websites, sign in to Google, call paid APIs, publish content or modify a website.",
    "- Competitor research samples are not Google organic rankings or proof of direct competitors.",
    "- Content gap labels are review candidates, not confirmed missing content or guaranteed ranking opportunities.",
    "- No search volume, CPC, keyword difficulty, traffic, backlinks, market share or conversion values are fabricated.",
    "- Human review is required before client delivery or publication.",
    "",
    "## Release status",
    "",
    "This report is an analysis artifact only. Production readiness is not certified."
  );

  return {
    success: true,
    format: "markdown",
    mode: "deterministic_offline_report_generation",
    networkAccess: false,
    externalActions: false,
    markdown: lines.join("\n"),
    sections: {
      onPageFindings: findings.length,
      searchConsoleQueries: queryRows.length,
      searchConsolePages: pageRows.length,
      competitorDomains: competitorRows.length,
      contentGapKeywords: gapRows.length
    },
    limitations: [
      "Only supplied evidence is included; missing inputs are not inferred.",
      "Report generation does not validate the authenticity or completeness of supplied exports.",
      "Human review is required before external delivery."
    ]
  };
}

module.exports = { analyzeContentGaps, generateSeoReport };
