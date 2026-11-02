'use strict';

const assert = require('assert');
const fs = require('fs');

const builder =
  require('../services/deliverable-builder');

const manifest =
  require('../services/deliverable-package-manifest');

const store =
  require('../deliverable-store');

const id =
  `stage101-tamper-${Date.now()}`;

let file = null;

function cleanup() {
  try {
    if (file && fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (_) {}

  try {
    const data = store.loadStore();

    data.deliveries =
      data.deliveries.filter(
        item => item.id !== id
      );

    store.saveStore(data);
  } catch (_) {}
}

try {
  cleanup();

  const item =
    builder.register({
      id,
      workId: `tamper-work-${Date.now()}`,
      title: 'Tamper Test',
      requiredFormat: 'CSV'
    });

  const built =
    builder.build(item.id);

  const verified =
    builder.verify(item.id);

  assert.strictEqual(
    verified.status,
    'QA_PASSED'
  );

  file =
    verified.packagePath;

  const record =
    manifest.writeManifest(
      verified
    );

  assert.strictEqual(
    manifest.verifyManifest(
      verified,
      record
    ),
    true
  );

  fs.appendFileSync(
    file,
    '\nTAMPERED'
  );

  assert.strictEqual(
    manifest.verifyManifest(
      verified,
      record
    ),
    false
  );

  console.log(
    'STAGE10_1_TAMPER_DETECTION: PASS'
  );
} finally {
  cleanup();
}
