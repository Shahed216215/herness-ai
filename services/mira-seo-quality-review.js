"use strict";

const { classifyIntent } = require("./mira-marketing-assets");

const MAX_KEYWORDS = 30;
const MAX_LINK_RECOMMENDATIONS = 30;
const MAX_DUPLICATE_FINDINGS = 50;

function cleanText(value, max = 240) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function normalize(value) {
  return cleanText(String(value || ""), 300)
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "your", "this",
    "that", "how", "what", "why", "guide", "service",
    "services", "best", "top", "to", "of", "in", "on",
    "a", "an", "is", "are", "by", "or", "as",
    "এবং", "জন্য", "কিভাবে", "কী", "কেন"
  ]);

  return new Set(
    normalize(value)
      .split(" ")
      .filter(word => word.length > 1 && !stop.has(word))
  );
}

function extractKeywords(brief, audit) {
  const output = [];
  const add = (value, suppliedIntent) => {
    const keyword = typeof value === "string"
      ? cleanText(value, 120)
      : cleanText(
          value?.keyword || value?.term || value?.query || value?.text || "",
          120
        );

    if (!keyword) return;

    const key = normalize(keyword);
    if (!key || output.some(item => normalize(item.keyword) === key)) {
      return;
    }

    output.push({
      keyword,
      intent: classifyIntent(
        keyword,
        suppliedIntent || value?.intent || value?.searchIntent
      )
    });
  };

  for (const item of Array.isArray(brief?.keywords) ? brief.keywords : []) {
    add(item);
  }

  const analysis = audit?.keywordAnalysis;
  const auditItems = Array.isArray(analysis)
    ? analysis
    : Array.isArray(analysis?.keywords)
      ? analysis.keywords
      : [];

  for (const item of auditItems) add(item);

  return output.slice(0, MAX_KEYWORDS);
}

function detectDuplicates(calendar) {
  const findings = [];

  for (let i = 0; i < calendar.length; i++) {
    for (let j = i + 1; j < calendar.length; j++) {
      const a = calendar[i];
      const b = calendar[j];

      const titleA = normalize(a.title);
      const titleB = normalize(b.title);
      const keywordA = normalize(a.primaryKeyword);
      const keywordB = normalize(b.primaryKeyword);

      const exactTitle = Boolean(titleA && titleA === titleB);
      const exactKeyword = Boolean(keywordA && keywordA === keywordB);

      const tokenA = tokens(a.title);
      const tokenB = tokens(b.title);
      const intersection = [...tokenA].filter(x => tokenB.has(x)).length;
      const union = new Set([...tokenA, ...tokenB]).size;
      const similarity = union ? intersection / union : 0;

      if (exactTitle || exactKeyword || (tokenA.size >= 3 && similarity >= 0.85)) {
        findings.push({
          type: exactTitle || exactKeyword ? "EXACT_DUPLICATE" : "HIGH_TITLE_SIMILARITY",
          itemIds: [a.id, b.id],
          titles: [cleanText(a.title), cleanText(b.title)],
          similarity: Number(similarity.toFixed(2)),
          recommendation: "Human review: merge, differentiate, or assign distinct search intent."
        });
      }

      if (findings.length >= MAX_DUPLICATE_FINDINGS) return findings;
    }
  }

  return findings;
}

function buildKeywordMap(keywords, calendar) {
  return keywords.map(item => {
    const targets = calendar.filter(entry =>
      normalize(entry.primaryKeyword) === normalize(item.keyword)
    );

    return {
      keyword: item.keyword,
      searchIntent: item.intent,
      mapped: targets.length > 0,
      targetCount: targets.length,
      targetIds: targets.map(target => target.id),
      targetTypes: targets.map(target => target.contentType),
      status: targets.length === 0
        ? "MAPPING_GAP"
        : targets.length > 1
          ? "MULTIPLE_TARGETS_REVIEW"
          : "MAPPED"
    };
  });
}

function buildInternalLinks(calendar, duplicateFindings) {
  const duplicatePairs = new Set();

  for (const finding of duplicateFindings) {
    duplicatePairs.add([...finding.itemIds].sort().join("::"));
  }

  const recommendations = [];

  for (let i = 0; i < calendar.length; i++) {
    for (let j = 0; j < calendar.length; j++) {
      if (i === j) continue;

      const source = calendar[i];
      const target = calendar[j];
      const pair = [source.id, target.id].sort().join("::");

      if (duplicatePairs.has(pair)) continue;

      const sourceTokens = tokens([
        source.primaryKeyword,
        ...(Array.isArray(source.secondaryKeywords) ? source.secondaryKeywords : [])
      ].join(" "));

      const targetTokens = tokens([
        target.primaryKeyword,
        ...(Array.isArray(target.secondaryKeywords) ? target.secondaryKeywords : [])
      ].join(" "));

      const shared = [...sourceTokens].filter(word => targetTokens.has(word));

      if (!shared.length) continue;

      recommendations.push({
        fromContentId: source.id,
        toContentId: target.id,
        suggestedAnchorText: cleanText(target.primaryKeyword, 120),
        sharedTopicTerms: shared.slice(0, 5),
        rationale: "The pages share topic terms; verify contextual relevance before linking.",
        status: "SUGGESTED_REQUIRES_HUMAN_REVIEW",
        linkCreated: false
      });

      if (recommendations.length >= MAX_LINK_RECOMMENDATIONS) {
        return recommendations;
      }
    }
  }

  return recommendations;
}

function calculateQuality(keywords, calendar, personas, keywordMap) {
  const mapped = keywordMap.filter(item => item.mapped).length;
  const eligible = keywordMap.length;
  const intentAligned = calendar.filter(item => {
    const expected = classifyIntent(item.primaryKeyword);
    return expected === "undetermined" ||
      expected === item.searchIntent;
  }).length;

  const complete = calendar.filter(item =>
    Boolean(
      cleanText(item.title) &&
      cleanText(item.primaryKeyword) &&
      cleanText(item.purpose) &&
      cleanText(item.callToAction) &&
      cleanText(item.contentType) &&
      cleanText(item.scheduledDate)
    )
  ).length;

  const personaIds = new Set(personas.map(item => item.id));
  const personaAligned = calendar.filter(item =>
    !item.personaId || personaIds.has(item.personaId)
  ).length;

  const governanceValid = calendar.every(item =>
    item.publicationAuthorized === false &&
    item.status === "PLANNED_REQUIRES_HUMAN_REVIEW"
  );

  const dimensions = {
    keywordCoverage: {
      weight: 25,
      score: eligible ? Number((mapped / eligible * 100).toFixed(1)) : 0,
      numerator: mapped,
      denominator: eligible
    },
    intentConsistency: {
      weight: 25,
      score: calendar.length
        ? Number((intentAligned / calendar.length * 100).toFixed(1))
        : 0,
      numerator: intentAligned,
      denominator: calendar.length
    },
    contentCompleteness: {
      weight: 30,
      score: calendar.length
        ? Number((complete / calendar.length * 100).toFixed(1))
        : 0,
      numerator: complete,
      denominator: calendar.length
    },
    personaReferenceIntegrity: {
      weight: 10,
      score: calendar.length
        ? Number((personaAligned / calendar.length * 100).toFixed(1))
        : 0,
      numerator: personaAligned,
      denominator: calendar.length
    },
    publicationGovernance: {
      weight: 10,
      score: governanceValid ? 100 : 0,
      valid: governanceValid
    }
  };

  const overallScore = Number(
    Object.values(dimensions)
      .reduce((sum, item) => sum + item.score * item.weight / 100, 0)
      .toFixed(1)
  );

  return {
    methodology: "Deterministic structural checks; not a search-ranking or traffic prediction.",
    overallScore,
    scale: "0-100",
    rating: overallScore >= 85
      ? "STRUCTURALLY_STRONG"
      : overallScore >= 70
        ? "STRUCTURALLY_GOOD"
        : overallScore >= 50
          ? "NEEDS_IMPROVEMENT"
          : "REVIEW_REQUIRED",
    dimensions,
    keywordCount: eligible,
    mappedKeywordCount: mapped,
    contentItemCount: calendar.length,
    personaCount: personas.length
  };
}

function buildSeoQualityReview(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("SEO_QUALITY_REVIEW_INPUT_INVALID");
  }

  const brief = input.brief || {};
  const audit = input.audit || {};
  const marketingAssets = input.marketingAssets || {};

  const keywords = extractKeywords(brief, audit);
  const personas = Array.isArray(marketingAssets.personas)
    ? marketingAssets.personas
    : [];
  const calendar = Array.isArray(marketingAssets.contentCalendar)
    ? marketingAssets.contentCalendar
    : [];

  const keywordMap = buildKeywordMap(keywords, calendar);
  const duplicateFindings = detectDuplicates(calendar);
  const internalLinkRecommendations = buildInternalLinks(
    calendar,
    duplicateFindings
  );

  const mappingGaps = keywordMap.filter(item => !item.mapped);
  const multipleTargets = keywordMap.filter(item => item.targetCount > 1);
  const quality = calculateQuality(
    keywords,
    calendar,
    personas,
    keywordMap
  );

  const reviewChecklist = [
    {
      id: "keyword-mapping",
      label: "Verify every priority keyword has one appropriate target.",
      status: mappingGaps.length || multipleTargets.length ? "ACTION_REQUIRED" : "READY_FOR_REVIEW"
    },
    {
      id: "duplicate-content",
      label: "Review possible duplicate or overlapping content.",
      status: duplicateFindings.length ? "ACTION_REQUIRED" : "READY_FOR_REVIEW"
    },
    {
      id: "internal-links",
      label: "Validate contextual relevance of suggested internal links.",
      status: internalLinkRecommendations.length ? "REVIEW_SUGGESTIONS" : "NO_SUGGESTIONS"
    },
    {
      id: "persona-validation",
      label: "Validate persona hypotheses against real customer evidence.",
      status: personas.length ? "HUMAN_VALIDATION_REQUIRED" : "NO_PERSONAS"
    },
    {
      id: "evidence",
      label: "Verify research sources and claims before client delivery.",
      status: "HUMAN_EVIDENCE_REVIEW_REQUIRED"
    },
    {
      id: "publication",
      label: "Obtain separate approval before any publication.",
      status: "PUBLICATION_NOT_AUTHORIZED"
    }
  ];

  const generatedAt = input.now
    ? new Date(input.now).toISOString()
    : new Date().toISOString();

  const clientName = cleanText(brief.clientName || "", 120);

  const clientReport = {
    title: "SEO Quality Review Report",
    clientName: clientName || null,
    generatedAt,
    executiveSummary: {
      structuralQualityScore: quality.overallScore,
      rating: quality.rating,
      keywordMappingGaps: mappingGaps.length,
      duplicateFindings: duplicateFindings.length,
      internalLinkSuggestions: internalLinkRecommendations.length,
      humanReviewRequired: true
    },
    methodology: quality.methodology,
    quality,
    keywordMap,
    mappingGaps,
    multipleTargetKeywords: multipleTargets,
    duplicateFindings,
    internalLinkRecommendations,
    reviewChecklist,
    limitations: [
      "The score measures deterministic structural completeness, not Google rankings or SEO performance.",
      "Keyword search volume, CPC, keyword difficulty, traffic, and conversion metrics are not estimated.",
      "Duplicate findings are heuristic signals and require human interpretation.",
      "Internal links are suggestions only; no links are inserted into a website.",
      "Personas are hypotheses, not validated customer profiles.",
      "Research source authenticity and factual claims require human verification."
    ]
  };

  return {
    schemaVersion: 1,
    generatedAt,
    status: "QUALITY_REVIEW_GENERATED",
    review: {
      status: "PENDING_REVIEW",
      decision: null,
      reviewer: null,
      reviewedAt: null,
      approvalRequired: true,
      approvalGranted: false
    },
    quality,
    keywordMap,
    mappingGaps,
    multipleTargetKeywords: multipleTargets,
    duplicateFindings,
    internalLinkRecommendations,
    reviewChecklist,
    clientReport,
    executionBoundary: {
      websiteModified: false,
      linksCreated: false,
      contentPublished: false,
      clientMessageSent: false,
      externalActions: false
    }
  };
}

module.exports = {
  buildSeoQualityReview,
  normalize,
  detectDuplicates,
  buildKeywordMap,
  buildInternalLinks
};
