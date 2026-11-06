"use strict";

const { audit } = require("../services/mira-seo-engine");

module.exports = {
  name: "seo_audit",

  declaration: {
    name: "seo_audit",
    description: "Perform bounded offline SEO analysis on user-supplied keywords, HTML, robots.txt and sitemap XML. Checks on-page metadata, indexability hints, Open Graph, Twitter Cards, hreflang, JSON-LD syntax, headings, links and visible-content heuristics. Does not fetch URLs or access the network.",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Up to 30 user-supplied keywords."
        },
        html: {
          type: "string",
          description: "Optional HTML source, maximum 200 KB."
        },
        pageUrl: {
          type: "string",
          description: "Optional absolute HTTP(S) page URL used only to classify supplied canonical and link origins. It is never fetched."
        },
        robotsTxt: {
          type: "string",
          description: "Optional robots.txt content."
        },
        sitemapXml: {
          type: "string",
          description: "Optional sitemap XML content."
        },
        searchConsoleCsv: {
          type: "string",
          description: "Optional user-exported Google Search Console Performance CSV (Query, Page, Clicks, Impressions, CTR, Position), maximum 200 KB. Parsed locally; no Google login or API call."
        }
      },
      additionalProperties: false
    }
  },

  execute: async (args = {}) => {
    try {
      return JSON.stringify(audit(args), null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  }
};
