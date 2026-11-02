'use strict';

const fs = require('fs');

const candidates = [
  'server.js',
  'app.js',
  'index.js',
  'main.js',
  'src/server.js',
  'src/app.js',
  'src/index.js'
];

let found = null;

for (const f of candidates) {
  if (fs.existsSync(f)) {
    const s = fs.readFileSync(f, 'utf8');

    if (
      s.includes('deliverable-integration') &&
      s.includes('registerDeliverableIntegrationRoutes')
    ) {
      found = f;
      break;
    }
  }
}

if (!found) {
  console.log('STAGE10_1_ROUTE_MOUNT_AUDIT: FAIL');
  process.exit(1);
}

console.log('STAGE10_1_ROUTE_MOUNT_AUDIT: PASS');
console.log(`MOUNTED_ENTRYPOINT: ${found}`);
