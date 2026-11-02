"use strict";

const { secureProviderRequest } =
  require("../services/security/secure-provider-request");

module.exports = {
  name: "web_search",

  declaration: {
    name: "web_search",
    description: "Search the web.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query"
        }
      },
      required: ["query"]
    }
  },

  execute: async ({ query }) => {
    const key = process.env.TAVILY_API_KEY;
    if (!key) return "Tavily API key is missing.";

    if (typeof query !== "string" || !query.trim())
      return "Search query is required.";

    try {
      const result = await secureProviderRequest(
        "https://api.tavily.com/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          data: {
            api_key: key,
            query: query.trim(),
            max_results: 5
          }
        }
      );

      const results = Array.isArray(result.data.results)
        ? result.data.results
        : [];

      return JSON.stringify(
        results.map(x => ({
          title: x.title,
          link: x.url,
          snippet: x.content
        }))
      );
    } catch {
      return "Search failed: secure request was rejected or the provider was unavailable.";
    }
  }
};
