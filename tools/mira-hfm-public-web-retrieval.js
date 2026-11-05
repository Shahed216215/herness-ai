'use strict';

const { retrievePublicFacebookMemory } = require('../services/mira-hfm-public-web-retrieval');

function createTool({ searchWeb } = {}) {
  const search = typeof searchWeb === 'function'
    ? searchWeb
    : query => require('./web-search').execute({ query });
  return {
    name:'mira_hfm_public_web_retrieval',
    declaration:{
      name:'mira_hfm_public_web_retrieval',
      description:'Read-only search of public web-indexed Facebook Page and post results for a selected numeric Page ID, optionally requiring an exact Memory ID, Project ID, and/or query match. Results are returned as untrusted evidence only. This tool never writes to any archive or canonical Memory. No direct Facebook fetch, Meta API, Group/private access, login, or cookies.',
      parameters:{type:'object',properties:{
        pageId:{type:'string',description:'Numeric Facebook Page ID.'},
        pageName:{type:'string',description:'Optional Facebook Page name.'},
        pageUrl:{type:'string',description:'Optional standard HTTPS Facebook Page URL.'},
        query:{type:'string',description:'Optional exact phrase required in the indexed title/snippet.'},
        memoryId:{type:'string',description:'Optional exact Memory ID required in indexed title/snippet/source URL.'},
        projectId:{type:'string',description:'Optional exact Project ID required in indexed title/snippet/source URL.'},
        maxResults:{type:'integer',minimum:1,maximum:10}
      },required:['pageId']}
    },
    execute:async args=>JSON.stringify(await retrievePublicFacebookMemory({
      ...args, searchWeb:search, importResults:false
    }))
  };
}
const defaultTool=createTool();
module.exports = {
  name: 'mira_hfm_public_web_retrieval',
  declaration: defaultTool.declaration,
  execute: defaultTool.execute,
  createTool
};
