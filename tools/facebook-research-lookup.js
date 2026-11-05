'use strict';

const { searchFacebookResearchMemory } = require('../services/mira-facebook-research-memory');

const DEFAULT_PAGE_ID = '118056109579206';

module.exports = {
  name: 'facebook_research_lookup',
  declaration: {
    name: 'facebook_research_lookup',
    description: 'For questions about the selected Facebook Page, retrieve matching source-linked entries from Mira local research archive before answering. If no relevant entries exist, call facebook_page_public_research to refresh the public search archive, then call this lookup again. Results remain UNVERIFIED and are not Canonical HFM Memory.',
    parameters: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Numeric Facebook Page ID; defaults to Online canel.' },
        query: { type: 'string', description: 'Question topic or keywords; empty returns recent entries.' },
        limit: { type: 'integer', minimum: 1, maximum: 10 }
      },
      required: []
    }
  },
  execute: async ({ pageId = DEFAULT_PAGE_ID, query = '', limit = 5 } = {}) => {
    return JSON.stringify(searchFacebookResearchMemory({ pageId, query, limit }));
  }
};
