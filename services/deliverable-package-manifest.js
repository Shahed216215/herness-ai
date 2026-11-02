'use strict';

const fs = require('fs');
const path = require('path');
const storagePath = require('../mira-storage');
const crypto = require('crypto');

const projectRoot = process.cwd();
const deliveriesRoot = storagePath('deliveries');
const manifestDir = path.join(deliveriesRoot, '_manifests');

function assertSafeDeliveryRoot() {
  const st = fs.lstatSync(deliveriesRoot);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error('UNSAFE_DELIVERIES_ROOT');
  }
  return fs.realpathSync(deliveriesRoot);
}

function assertSafePackageFile(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('PACKAGE_PATH_REQUIRED');
  }

  const root = assertSafeDeliveryRoot();
  const candidate = path.resolve(projectRoot, input);
  const relative = path.relative(root, candidate);

  if (!relative || relative === '..' ||
      relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('PACKAGE_PATH_OUTSIDE_DELIVERIES');
  }

  const parts = relative.split(path.sep);
  let current = root;

  for (const part of parts) {
    current = path.join(current, part);
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink()) {
      throw new Error('PACKAGE_PATH_SYMLINK_BLOCKED');
    }
    if (current !== candidate && !st.isDirectory()) {
      throw new Error('PACKAGE_PATH_PARENT_NOT_DIRECTORY');
    }
  }

  const flags = fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(candidate, flags);

  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error('PACKAGE_NOT_REGULAR_FILE');
    const data = fs.readFileSync(fd);
    return {
      path: candidate,
      size: st.size,
      sha256: crypto.createHash('sha256').update(data).digest('hex')
    };
  } finally {
    fs.closeSync(fd);
  }
}

function sha256File(filePath) {
  return assertSafePackageFile(filePath).sha256;
}

function buildManifest(delivery) {
  if (!delivery || !delivery.packagePath) {
    throw new Error('PACKAGE_PATH_REQUIRED');
  }

  const file = assertSafePackageFile(delivery.packagePath);
  return {
    schema: 'mira-deliverable-manifest-v1',
    deliverableId: delivery.id,
    workId: delivery.workId,
    title: delivery.title,
    requiredFormat: delivery.requiredFormat,
    file: {
      path: path.relative(projectRoot, file.path),
      size: file.size,
      sha256: file.sha256
    },
    createdAt: new Date().toISOString()
  };
}

function assertSafeManifestDirectory() {
  assertSafeDeliveryRoot();

  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: false, mode: 0o700 });
  }

  const st = fs.lstatSync(manifestDir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error('UNSAFE_MANIFEST_DIRECTORY');
  }
  return fs.realpathSync(manifestDir);
}

function writeManifest(delivery) {
  if (!delivery || typeof delivery.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(delivery.id) ||
      delivery.id === '.' || delivery.id === '..') {
    throw new Error('INVALID_DELIVERABLE_ID');
  }

  const manifest = buildManifest(delivery);
  const dir = assertSafeManifestDirectory();
  const file = path.join(dir, `${delivery.id}.manifest.json`);
  const temp = path.join(
    dir, `.${delivery.id}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );

  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(manifest, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    fs.renameSync(temp, file);
    return { ...manifest, manifestPath: file };
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(temp); } catch {}
    throw err;
  }
}

function verifyManifest(delivery, manifest) {
  try {
    if (!delivery || !manifest || !manifest.file ||
        !delivery.packagePath) return false;

    const file = assertSafePackageFile(delivery.packagePath);
    return (
      manifest.schema === 'mira-deliverable-manifest-v1' &&
      manifest.deliverableId === delivery.id &&
      manifest.workId === delivery.workId &&
      manifest.requiredFormat === delivery.requiredFormat &&
      manifest.file.size === file.size &&
      manifest.file.sha256 === file.sha256
    );
  } catch {
    return false;
  }
}

module.exports = {
  buildManifest,
  writeManifest,
  verifyManifest
};
