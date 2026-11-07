'use strict';

module.exports = {
  name: 'source_reference_save',
  declaration: {
    name: 'source_reference_save',
    description: 'Save a user-supplied HTTPS source URL as a private canonical HFM v1.2.0 source_reference. Use only when the user explicitly asks to save the source, reference, link, or URL and the exact URL appears in the current user message. This tool records the URL as NOT_FETCHED; it does not fetch, scrape, authenticate, or verify source content. Query strings and fragments are removed, credentials and non-HTTPS/private-network URLs are rejected, and no local or Google Drive fallback is available.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Exact HTTPS URL supplied by the user in the current message.'
        },
        sourceType: {
          type: 'string',
          enum: ['web', 'facebook_page', 'facebook_group', 'manual'],
          description: 'Source category. Defaults to web.'
        }
      },
      required: ['url']
    }
  },
  execute: async () => {
    const hfmEnabled =
      process.env.MIRA_HFM_MEMORY_WRITE_ENABLED === 'true' ||
      process.env.MIRA_HFM_MEMORY_READ_ENABLED === 'true' ||
      process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === 'true' ||
      process.env.MIRA_HFM_WORK_LEARNING_ENABLED === 'true';
    return JSON.stringify({
      success: false,
      saved: false,
      code: hfmEnabled ? 'HFM_TOOL_ROUTER_REQUIRED' : 'HFM_SOURCE_REFERENCE_CANONICAL_ONLY',
      localFallback: false,
      driveFallback: false
    });
  }
};
