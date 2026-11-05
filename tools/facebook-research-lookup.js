'use strict';
const store = require('../services/mira-facebook-research-memory');
module.exports = {
 name: 'facebook_research_lookup',
 declaration: { name: 'facebook_research_lookup', description: 'Read untrusted Facebook research archive entries.', parameters: { type: 'object', properties: { pageId: {type:'string'}, query: {type:'string'}, limit: {type:'integer'} }, required: [] } },
 execute: async ({pageId='118056109579206', query='', limit=5}={}) => JSON.stringify(store.searchFacebookResearchMemory({pageId,query,limit}))
};
