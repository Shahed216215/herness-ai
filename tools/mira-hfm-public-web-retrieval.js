'use strict';

const { retrievePublicFacebookMemory } = require('../services/mira-hfm-public-web-retrieval');
const { archiveFacebookResearchEvidenceWithProvider } = require('../services/mira-facebook-research-memory-provider');

function createTool({ searchWeb, archiveEvidence } = {}) {
  const search = typeof searchWeb === 'function'
    ? searchWeb
    : query => require('./web-search').execute({ query });
  const archive = typeof archiveEvidence === 'function'
    ? archiveEvidence
    : input => archiveFacebookResearchEvidenceWithProvider(input);
  return {
    name:'mira_hfm_public_web_retrieval',
    declaration:{
      name:'mira_hfm_public_web_retrieval',
      description:'Search public web-indexed Facebook Page and post results for a selected numeric Page ID, optionally requiring an exact Memory ID, Project ID, and/or query match. Can archive bounded source-linked results in the separate UNTRUSTED research archive. No direct Facebook fetch, Meta API, Group/private access, login, cookies, or canonical Memory write.',
      parameters:{type:'object',properties:{
        pageId:{type:'string',description:'Numeric Facebook Page ID.'},
        pageName:{type:'string',description:'Optional Facebook Page name.'},
        pageUrl:{type:'string',description:'Optional standard HTTPS Facebook Page URL.'},
        query:{type:'string',description:'Optional exact phrase required in the indexed title/snippet.'},
        memoryId:{type:'string',description:'Optional exact Memory ID required in indexed title/snippet/source URL.'},
        projectId:{type:'string',description:'Optional exact Project ID required in indexed title/snippet/source URL.'},
        importResults:{type:'boolean',description:'Archive accepted results as untrusted research evidence; defaults to true.'},
        maxResults:{type:'integer',minimum:1,maximum:10}
      },required:['pageId']}
    },
    execute:async args=>JSON.stringify(await retrievePublicFacebookMemory({
      ...args, searchWeb:search, archiveEvidence:archive,
      importResults:args && args.importResults !== false
    }))
  };
}
const defaultTool=createTool();
module.exports={name:'mira_hfm_public_web_retrieval',declaration:defaultTool.declaration,execute:defaultTool.execute,createTool};
