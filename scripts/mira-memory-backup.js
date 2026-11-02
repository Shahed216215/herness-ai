'use strict';

const { createBackup } = require('../services/mira-local-memory-store');

try {
  const result = createBackup();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    success: false,
    error: error.message
  }, null, 2) + '\n');
  process.exitCode = 1;
}
