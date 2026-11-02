"use strict";

const { audit } = require("../services/mira-seo-engine");

module.exports = {
  name: "seo_audit",

  declaration: {
    name: "seo_audit",
    description: "Perform offline SEO analysis on user-supplied keywords, HTML, robots.txt and sitemap XML. Does not fetch URLs or access the network.",
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
        robotsTxt: {
          type: "string",
          description: "Optional robots.txt content."
        },
        sitemapXml: {
          type: "string",
          description: "Optional sitemap XML content."
        }
      }
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
