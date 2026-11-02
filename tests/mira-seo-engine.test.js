"use strict";

const assert = require("assert");
const { audit, classifyIntent } = require("../services/mira-seo-engine");
const seoTool = require("../tools/seo-audit");
const { getToolPolicy } = require("../services/mira-work-execution-engine");
const { tools } = require("../tools");

async function main() {
  const html = [
    "<html><head>",
    "<title>Python SEO Guide for Beginners</title>",
    '<meta name="description" content="Learn practical Python SEO basics with examples and a clear beginner guide for your website.">',
    '<link rel="canonical" href="https://example.test/python-seo">',
    "</head><body>",
    "<h1>Python SEO Guide</h1>",
    "<h2>Getting Started</h2>",
    '<img src="one.jpg" alt="Python SEO example">',
    '<img src="two.jpg">',
    "<p>Python SEO helps beginners understand website optimization.</p>",
    "</body></html>"
  ].join("");

  const result = audit({
    keywords: [
      "how to learn SEO",
      "best SEO tools",
      "buy SEO software"
    ],
    html,
    robotsTxt: "User-agent: *\nAllow: /\nSitemap: https://example.test/sitemap.xml",
    sitemapXml: "<urlset><url><loc>https://example.test/</loc></url></urlset>"
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.mode, "offline_local_analysis");
  assert.strictEqual(result.networkAccess, false);
  assert.strictEqual(result.onPage.title, "Python SEO Guide for Beginners");
  assert.strictEqual(result.onPage.h1Count, 1);
  assert.strictEqual(result.onPage.canonicalCount, 1);
  assert.strictEqual(result.onPage.imageCount, 2);
  assert.strictEqual(result.onPage.imagesMissingAlt, 1);
  assert.strictEqual(result.keywordAnalysis[0].intent, "informational");
  assert.strictEqual(result.keywordAnalysis[1].intent, "commercial");
  assert.strictEqual(result.keywordAnalysis[2].intent, "transactional");
  assert.strictEqual(result.technical.robotsTxt.provided, true);
  assert.strictEqual(result.technical.sitemap.urlCount, 1);
  assert.ok(result.contentBrief.suggestedOutline.length > 0);

  assert.strictEqual(classifyIntent("official website login"), "navigational");
  assert.strictEqual(classifyIntent("unknown phrase"), "undetermined");

  // Bengali keyword intent regression tests.
  assert.strictEqual(classifyIntent("কিভাবে SEO শিখব"), "informational");
  assert.strictEqual(classifyIntent("SEO-এর দাম কত"), "transactional");
  assert.strictEqual(classifyIntent("সেরা SEO tools"), "commercial");
  assert.strictEqual(classifyIntent("অ্যাকাউন্ট লগইন"), "navigational");

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

  const toolResult = JSON.parse(await seoTool.execute({
    keywords: ["SEO guide"]
  }));
  assert.strictEqual(toolResult.success, true);
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

  console.log("PASS: keyword intent classification");
  console.log("PASS: on-page title/meta/headings/canonical/image checks");
  console.log("PASS: robots.txt and sitemap analysis");
  console.log("PASS: content brief generation");
  console.log("PASS: input limits and invalid input rejection");
  console.log("PASS: seo_audit tool registration and policy");
  console.log("NETWORK_CALLS=0");
  console.log("SEO_ENGINE_TEST_STATUS=PASS");
}

main().catch(error => {
  console.error("SEO_ENGINE_TEST_STATUS=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
