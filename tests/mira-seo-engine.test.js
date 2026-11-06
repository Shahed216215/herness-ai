"use strict";

const assert = require("assert");
const {
  audit,
  classifyIntent,
  collectJsonLd,
  analyzeLinks,
  analyzeSearchConsoleCsv
} = require("../services/mira-seo-engine");
const seoTool = require("../tools/seo-audit");
const { getToolPolicy } = require("../services/mira-work-execution-engine");
const { tools } = require("../tools");

async function main() {
  const html = [
    "<html lang=\"en\"><head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Python SEO Guide for Beginners</title>",
    '<meta name="description" content="Learn practical Python SEO basics with examples and a clear beginner guide for your website.">',
    '<meta property="og:title" content="Python SEO Guide">',
    '<meta property="og:description" content="A practical SEO guide.">',
    '<meta property="og:type" content="article">',
    '<meta property="og:url" content="https://example.test/python-seo">',
    '<meta property="og:image" content="https://example.test/seo.png">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="Python SEO Guide">',
    '<meta name="twitter:description" content="A practical SEO guide.">',
    '<meta name="twitter:image" content="https://example.test/seo.png">',
    '<link rel="canonical" href="https://example.test/python-seo">',
    '<link rel="alternate" hreflang="en" href="https://example.test/en">',
    "</head><body>",
    "<h1>Python SEO Guide</h1>",
    "<h2>Getting Started</h2>",
    '<img src="one.jpg" alt="Python SEO example">',
    '<img src="two.jpg">',
    '<a href="/related">Related page</a>',
    '<a href="https://outside.test/resource" rel="nofollow">External resource</a>',
    "<p>Python SEO helps beginners understand website optimization. ".repeat(45),
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Python SEO Guide"}</script>',
    "</body></html>"
  ].join("");

  const result = audit({
    keywords: [
      "how to learn SEO",
      "best SEO tools",
      "buy SEO software"
    ],
    pageUrl: "https://example.test/python-seo",
    html,
    robotsTxt: "User-agent: *\nAllow: /\nSitemap: https://example.test/sitemap.xml",
    sitemapXml: "<urlset><url><loc>https://example.test/</loc></url></urlset>"
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.version, "2.0.0");
  assert.strictEqual(result.mode, "offline_local_analysis");
  assert.strictEqual(result.networkAccess, false);
  assert.strictEqual(result.searchPerformance.provided, false);
  assert.strictEqual(result.onPage.title, "Python SEO Guide for Beginners");
  assert.strictEqual(result.onPage.h1Count, 1);
  assert.strictEqual(result.onPage.canonicalCount, 1);
  assert.strictEqual(result.onPage.imageCount, 2);
  assert.strictEqual(result.onPage.imagesMissingAlt, 1);
  assert.strictEqual(result.onPage.document.htmlLang, "en");
  assert.strictEqual(result.onPage.document.charsetPresent, true);
  assert.strictEqual(result.onPage.document.viewportPresent, true);
  assert.strictEqual(result.onPage.document.noindex, false);
  assert.deepStrictEqual(result.onPage.openGraph.missingFields, []);
  assert.deepStrictEqual(result.onPage.twitterCards.missingFields, []);
  assert.strictEqual(result.onPage.structuredData.types.includes("Article"), true);
  assert.strictEqual(result.onPage.structuredData.invalidScriptCount, 0);
  assert.strictEqual(result.onPage.links.internal, 1);
  assert.strictEqual(result.onPage.links.external, 1);
  assert.strictEqual(result.onPage.links.nofollow, 1);
  assert.strictEqual(result.keywordAnalysis[0].intent, "informational");
  assert.strictEqual(result.keywordAnalysis[1].intent, "commercial");
  assert.strictEqual(result.keywordAnalysis[2].intent, "transactional");
  assert.strictEqual(result.technical.robotsTxt.provided, true);
  assert.strictEqual(result.technical.sitemap.urlCount, 1);
  assert.ok(result.contentBrief.suggestedOutline.length > 0);

  const blockedHtml = [
    '<html><head><meta name="robots" content="noindex,nofollow">',
    '<link rel="canonical" href="https://wrong.test/page">',
    '<meta property="og:title" content="Only title">',
    "</head><body><h1>One</h1><h3>Skipped level</h3>",
    '<script type="application/ld+json">{bad json}</script></body></html>'
  ].join("");
  const blocked = audit({
    pageUrl: "https://example.test/page",
    html: blockedHtml
  });
  assert.strictEqual(blocked.onPage.document.noindex, true);
  assert.strictEqual(blocked.onPage.document.nofollow, true);
  assert.ok(blocked.onPage.canonicalFindings.some(x => /different origin/.test(x)));
  assert.ok(blocked.onPage.findings.some(x => x.code === "JSON_LD_INVALID"));
  assert.ok(blocked.onPage.findings.some(x => x.code === "HEADING_LEVEL_SKIPS"));
  assert.ok(blocked.onPage.findings.some(x => x.code === "OPEN_GRAPH_COMPLETE"));
  assert.strictEqual(blocked.onPage.structuredData.invalidScriptCount, 1);

  const sitemap = audit({
    sitemapXml: "<urlset><url><loc>https://example.test/a</loc></url>" +
      "<url><loc>https://example.test/a</loc></url>" +
      "<url><loc>javascript:alert(1)</loc></url></urlset>"
  });
  assert.strictEqual(sitemap.technical.sitemap.duplicateCount, 1);
  assert.strictEqual(sitemap.technical.sitemap.invalidUrlCount, 1);

  const caseSensitiveSitemap = audit({
    sitemapXml: "<urlset><url><loc>https://example.test/Page</loc></url>" +
      "<url><loc>https://example.test/page</loc></url>" +
      "<url><loc>https://example.test/path/</loc></url>" +
      "<url><loc>https://example.test/path</loc></url></urlset>"
  });
  assert.strictEqual(caseSensitiveSitemap.technical.sitemap.duplicateCount, 0);

  const gsc = analyzeSearchConsoleCsv([
    "Top queries,Top pages,Clicks,Impressions,CTR,Position",
    '"seo, tools","https://example.test/seo",12,1000,1.2%,9.5',
    '"seo, tools","https://example.test/seo",8,500,1.6%,10.5',
    '"seo guide","https://example.test/guide",30,200,15%,3.2',
    '"bad row","https://example.test/bad",oops,20,1%,4'
  ].join("\n"));
  assert.strictEqual(gsc.importedRows, 3);
  assert.strictEqual(gsc.skippedRows, 1);
  assert.strictEqual(gsc.totals.clicks, 50);
  assert.strictEqual(gsc.totals.impressions, 1700);
  assert.strictEqual(gsc.queries[0].query, "seo, tools");
  assert.strictEqual(gsc.queries[0].ctr, 1.33);
  assert.ok(gsc.queries[0].opportunitySignals.includes("HIGH_IMPRESSIONS_LOW_CTR_REVIEW"));
  assert.throws(() => analyzeSearchConsoleCsv("Query,Page,Clicks\nx,y,1"), /MISSING_COLUMN/);
  assert.throws(() => analyzeSearchConsoleCsv(""), /CSV_REQUIRED/);
  const queryOnly = analyzeSearchConsoleCsv([
    "Top queries,Clicks,Impressions,CTR,Position",
    "seo audit,5,500,1%,7"
  ].join("\n"));
  assert.strictEqual(queryOnly.queries.length, 1);
  assert.strictEqual(queryOnly.pages.length, 0);
  const pageOnly = analyzeSearchConsoleCsv([
    "Top pages,Clicks,Impressions,CTR,Position",
    "https://example.test/page,5,500,1%,7"
  ].join("\n"));
  assert.strictEqual(pageOnly.pages.length, 1);
  assert.strictEqual(pageOnly.queries.length, 0);


  const unscopedLinks = analyzeLinks('<a href="https://outside.test/a">x</a>');
  assert.strictEqual(unscopedLinks.internal, null);
  assert.strictEqual(unscopedLinks.external, null);
  assert.strictEqual(unscopedLinks.absolute, 1);

  assert.strictEqual(classifyIntent("official website login"), "navigational");
  assert.strictEqual(classifyIntent("unknown phrase"), "undetermined");

  // Bengali keyword intent regression tests.
  assert.strictEqual(classifyIntent("কিভাবে SEO শিখব"), "informational");
  assert.strictEqual(classifyIntent("SEO-এর দাম কত"), "transactional");
  assert.strictEqual(classifyIntent("সেরা SEO tools"), "commercial");
  assert.strictEqual(classifyIntent("অ্যাকাউন্ট লগইন"), "navigational");

  assert.strictEqual(collectJsonLd('<script type="application/ld+json">{"@type":"Product"}</script>').types[0], "Product");
  assert.strictEqual(analyzeLinks('<a href="/relative">x</a>').invalidHref, 1);

  assert.throws(
    () => audit({ keywords: new Array(31).fill("keyword") }),
    /Maximum 30/
  );
  assert.throws(
    () => audit({ html: "x".repeat(200001) }),
    /html exceeds/
  );
  assert.throws(
    () => audit({ keywords: ["x".repeat(121)] }),
    /keyword exceeds/
  );
  assert.throws(
    () => audit({ keywords: "not-an-array" }),
    /keywords/
  );
  assert.throws(
    () => audit({ pageUrl: "javascript:alert(1)" }),
    /absolute HTTP/
  );

  const toolResult = JSON.parse(await seoTool.execute({
    keywords: ["SEO guide"],
    pageUrl: "https://example.test/"
  }));
  assert.strictEqual(toolResult.success, true);
  assert.strictEqual(toolResult.version, "2.0.0");
  assert.strictEqual(toolResult.networkAccess, false);

  const toolError = JSON.parse(await seoTool.execute({
    html: "x".repeat(200001)
  }));
  assert.strictEqual(toolError.success, false);

  assert.ok(tools.seo_audit, "SEO tool must be registered.");
  const policy = getToolPolicy("seo_audit");
  assert.ok(policy, "SEO tool policy must exist.");
  assert.strictEqual(policy.operation, "inspect");
  assert.strictEqual(policy.autonomous, true);
  assert.strictEqual(policy.humanApprovalRequired, false);
  assert.strictEqual(policy.explicitConfirmation, false);

  console.log("PASS: keyword intent classification (English and Bengali)");
  console.log("PASS: on-page metadata, headings, canonical and image-alt checks");
  console.log("PASS: document language, charset, viewport and robots indexability");
  console.log("PASS: Open Graph, Twitter Cards, hreflang and JSON-LD diagnostics");
  console.log("PASS: internal/external links and visible-content heuristics");
  console.log("PASS: robots.txt and duplicate/invalid sitemap analysis");
  console.log("PASS: offline Search Console CSV aggregation and cautious opportunity heuristics");
  console.log("PASS: input limits, URL validation and invalid input rejection");
  console.log("PASS: seo_audit tool registration and inspect-only policy");
  console.log("NETWORK_CALLS=0");
  console.log("EXTERNAL_ACTIONS=0");
  console.log("SEO_ENGINE_TEST_STATUS=PASS");
}

main().catch(error => {
  console.error("SEO_ENGINE_TEST_STATUS=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
