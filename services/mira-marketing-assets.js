"use strict";

const MAX_PERSONAS = 3;
const MAX_CALENDAR_ITEMS = 12;
const MAX_KEYWORDS = 30;
const MAX_EVIDENCE_REFS = 5;

function cleanText(value, max = 180) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeKeyword(value) {
  if (typeof value === "string") return cleanText(value, 120);
  if (value && typeof value === "object") {
    return cleanText(
      value.keyword || value.term || value.query || value.text || "",
      120
    );
  }
  return "";
}

function classifyIntent(keyword, supplied) {
  const value = cleanText(String(supplied || ""), 40).toLowerCase();
  const allowed = [
    "informational",
    "commercial",
    "transactional",
    "navigational"
  ];

  if (allowed.includes(value)) return value;

  const q = keyword.toLowerCase();

  if (/(buy|price|pricing|cost|hire|book|purchase|কিনুন|দাম|মূল্য)/i.test(q)) {
    return "transactional";
  }
  if (/(best|top|compare|comparison|review|agency|service|সেরা|তুলনা)/i.test(q)) {
    return "commercial";
  }
  if (/(how|what|why|guide|learn|tutorial|কিভাবে|কী|কেন|গাইড)/i.test(q)) {
    return "informational";
  }
  if (/(login|sign in|official|লগইন)/i.test(q)) {
    return "navigational";
  }
  return "undetermined";
}

function extractKeywords(brief, audit) {
  const values = [];
  const add = (value, intent) => {
    const keyword = normalizeKeyword(value);
    if (!keyword) return;
    if (!values.some(item => item.keyword.toLowerCase() === keyword.toLowerCase())) {
      values.push({
        keyword,
        intent: classifyIntent(keyword, intent)
      });
    }
  };

  const briefKeywords = Array.isArray(brief?.keywords)
    ? brief.keywords
    : [];

  for (const item of briefKeywords) add(item);

  const analysis = audit?.keywordAnalysis;
  const auditKeywords = Array.isArray(analysis)
    ? analysis
    : Array.isArray(analysis?.keywords)
      ? analysis.keywords
      : [];

  for (const item of auditKeywords) {
    if (item && typeof item === "object") {
      add(
        item.keyword || item.term || item.query,
        item.intent || item.searchIntent
      );
    } else {
      add(item);
    }
  }

  return values.slice(0, MAX_KEYWORDS);
}

function evidenceReferences(research) {
  const results = Array.isArray(research?.results)
    ? research.results
    : Array.isArray(research?.evidence)
      ? research.evidence
      : [];

  return results.slice(0, MAX_EVIDENCE_REFS).map(item => ({
    title: cleanText(item?.title, 180),
    url: cleanText(item?.url, 500),
    evidenceStatus: cleanText(item?.evidenceStatus, 60) || "unverified",
    use: "market_context_only_not_customer_validation"
  })).filter(item => item.url);
}

function makePersonas(keywords, evidenceRefs) {
  const groups = new Map();

  for (const item of keywords) {
    if (
      item.intent === "undetermined" ||
      item.intent === "navigational"
    ) continue;

    if (!groups.has(item.intent)) groups.set(item.intent, []);
    groups.get(item.intent).push(item.keyword);
  }

  const descriptions = {
    informational: {
      segment: "Information-seeking prospect",
      needs: ["Understand the problem and available approaches", "Find practical guidance before choosing a provider"],
      pains: ["Unclear implementation steps", "Difficulty evaluating technical options"]
    },
    commercial: {
      segment: "Solution-evaluating prospect",
      needs: ["Compare service approaches and providers", "Understand scope, suitability, and expected outcomes"],
      pains: ["Unclear service differences", "Insufficient evidence to compare providers"]
    },
    transactional: {
      segment: "Purchase-ready prospect",
      needs: ["Understand service scope and engagement process", "Find pricing or a clear consultation path"],
      pains: ["Unclear pricing or deliverables", "Uncertainty about the next purchase step"]
    }
  };

  return [...groups.entries()].slice(0, MAX_PERSONAS).map(([intent, terms], index) => {
    const description = descriptions[intent];
    return {
      id: `persona-${intent}-hypothesis-${index + 1}`,
      type: "hypothesis",
      segment: description.segment,
      intent,
      relatedKeywords: terms.slice(0, 10),
      needs: description.needs,
      potentialPainPoints: description.pains,
      assumptions: [
        "This segment is inferred from keyword intent, not verified customer interviews or analytics.",
        "No demographic, income, company-size, or geographic attributes are asserted."
      ],
      evidenceRefs,
      evidenceUse: "market_context_only_not_customer_validation",
      confidence: "low",
      status: "HYPOTHESIS_REQUIRES_HUMAN_VALIDATION"
    };
  });
}

function titleFor(keyword, intent) {
  const clean = keyword.charAt(0).toUpperCase() + keyword.slice(1);
  if (intent === "transactional") return `${clean}: Services, Scope, and Next Steps`;
  if (intent === "commercial") return `How to Evaluate ${clean}`;
  if (intent === "informational") return `${clean}: A Practical Guide`;
  return `Understanding ${clean}`;
}

function contentTypeFor(intent) {
  if (intent === "transactional") return "service_or_conversion_page";
  if (intent === "commercial") return "comparison_or_evaluation_article";
  return "educational_article";
}

function funnelFor(intent) {
  if (intent === "transactional") return "bottom_of_funnel";
  if (intent === "commercial") return "middle_of_funnel";
  return "top_of_funnel";
}

function ctaFor(intent) {
  if (intent === "transactional") return "Request a consultation";
  if (intent === "commercial") return "Explore the relevant service";
  return "Read the related service guide";
}

function makeCalendar(keywords, personas, evidenceRefs, now) {
  const eligible = keywords.filter(item =>
    item.intent !== "navigational" &&
    item.intent !== "undetermined"
  ).slice(0, MAX_CALENDAR_ITEMS);

  const start = new Date(now);
  const personaByIntent = new Map(personas.map(p => [p.intent, p.id]));

  return eligible.map((item, index) => {
    const dayOffset = Math.floor(index * 30 / Math.max(eligible.length, 1));
    const date = new Date(start.getTime() + dayOffset * 86400000);
    const isoDate = date.toISOString().slice(0, 10);

    return {
      id: `calendar-${String(index + 1).padStart(2, "0")}`,
      scheduledDate: isoDate,
      title: titleFor(item.keyword, item.intent),
      contentType: contentTypeFor(item.intent),
      primaryKeyword: item.keyword,
      secondaryKeywords: [],
      searchIntent: item.intent,
      funnelStage: funnelFor(item.intent),
      channel: "website",
      purpose: "Address the selected search intent with original, useful content.",
      callToAction: ctaFor(item.intent),
      personaId: personaByIntent.get(item.intent) || null,
      evidenceRefs,
      evidenceUse: "market_context_only_not_customer_validation",
      status: "PLANNED_REQUIRES_HUMAN_REVIEW",
      publicationAuthorized: false
    };
  });
}

function generateMarketingAssets(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("MARKETING_ASSET_INPUT_INVALID");
  }

  const brief = input.brief || {};
  const audit = input.audit || {};
  const research = input.research || {};
  const now = input.now ? new Date(input.now) : new Date();

  if (Number.isNaN(now.getTime())) {
    throw new TypeError("MARKETING_ASSET_DATE_INVALID");
  }

  const keywords = extractKeywords(brief, audit);
  const evidenceRefs = evidenceReferences(research);
  const personas = makePersonas(keywords, evidenceRefs);
  const contentCalendar = makeCalendar(
    keywords,
    personas,
    evidenceRefs,
    now
  );

  return {
    assetGeneration: {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      status: "GENERATED_FOR_HUMAN_REVIEW",
      keywordCount: keywords.length,
      limitations: [
        "Personas are low-confidence hypotheses, not verified customer profiles.",
        "Search evidence is contextual and does not validate individual persona attributes.",
        "No search volume, CPC, keyword difficulty, or conversion rate is inferred.",
        "Calendar dates are planning suggestions, not publication commitments."
      ]
    },
    personas,
    contentCalendar
  };
}

module.exports = {
  generateMarketingAssets,
  classifyIntent
};
