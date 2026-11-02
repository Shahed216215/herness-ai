'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const modPath = path.resolve('services/deliverable-package-manifest.js');
const deliveries = path.resolve('deliveries');
fs.mkdirSync(deliveries, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(deliveries, '.stage19-manifest-test-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'stage19-manifest-outside-'));
const mod = require(modPath);

function clean(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

try {
  const packagePath = path.join(sandbox, 'safe.txt');
  fs.writeFileSync(packagePath, 'verified package');
  const delivery = {
    id: 'stage19-test-delivery',
    workId: 'stage19-test-work',
    title: 'security test',
    requiredFormat: 'txt',
    packagePath
  };

  const manifest = mod.buildManifest(delivery);
  assert.strictEqual(mod.verifyManifest(delivery, manifest), true);
  fs.writeFileSync(packagePath, 'tampered package');
  assert.strictEqual(mod.verifyManifest(delivery, manifest), false);
  fs.writeFileSync(packagePath, 'verified package');

  const outsideFile = path.join(outside, 'outside.txt');
  fs.writeFileSync(outsideFile, 'outside');
  assert.throws(
    () => mod.buildManifest({ ...delivery, packagePath: outsideFile }),
    /OUTSIDE_DELIVERIES/
  );

  const link = path.join(sandbox, 'linked.txt');
  fs.symlinkSync(outsideFile, link);
  assert.throws(
    () => mod.buildManifest({ ...delivery, packagePath: link }),
    /SYMLINK_BLOCKED/
  );
  assert.strictEqual(
    mod.verifyManifest({ ...delivery, packagePath: link }, manifest), false
  );

  const written = mod.writeManifest(delivery);
  assert.strictEqual(mod.verifyManifest(delivery, written), true);
  assert.ok(fs.existsSync(written.manifestPath));

  assert.throws(
    () => mod.writeManifest({ ...delivery, id: '../escape' }),
    /INVALID_DELIVERABLE_ID/
  );

  console.log('MANIFEST_PATH_SECURITY=PASS');
  console.log('CASE_COUNT=7');
} finally {
  clean(sandbox);
  clean(outside);
}
