'use strict';

const { getMemory } = require('../memory');

module.exports = {
  name: 'memory_count',

  declaration: {
    name: 'memory_count',
    description:
      'Return the number of messages stored in Mira local Memory.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },

  execute: async () => {
    try {
      const memory = getMemory();
      return JSON.stringify({
        success: true,
        count: memory.length,
        source: 'local Memory'
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        count: null,
        error: error.message
      });
    }
  }
};
