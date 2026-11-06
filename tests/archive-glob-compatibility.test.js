'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const archiver = require('archiver');

function closeOnError(emitter, reject) {
  emitter.once('error', reject);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-archive-glob-'));
  const source = path.join(root, 'source');
  const outputPath = path.join(root, 'compatibility.zip');

  try {
    fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
    fs.mkdirSync(path.join(source, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(source, 'root.txt'), 'root-file');
    fs.writeFileSync(path.join(source, 'nested', 'child.txt'), 'nested-file');
    fs.writeFileSync(path.join(source, 'ignored', 'skip.txt'), 'ignored-file');
    fs.writeFileSync(path.join(source, 'notes.log'), 'non-matching-file');

    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    const closePromise = new Promise((resolve, reject) => {
      closeOnError(output, reject);
      closeOnError(archive, reject);
      output.once('close', resolve);
    });

    archive.pipe(output);
    archive.glob('**/*.txt', {
      cwd: source,
      ignore: ['ignored/**']
    });

    await archive.finalize();
    await closePromise;

    const zip = fs.readFileSync(outputPath);
    assert.ok(zip.length > 22, 'ZIP output must contain a central directory');
    assert.ok(zip.includes(Buffer.from('root.txt')),
      'glob must include root-level matching files');
    assert.ok(zip.includes(Buffer.from('nested/child.txt')),
      'glob must include nested matching files');
    assert.equal(zip.includes(Buffer.from('ignored/skip.txt')), false,
      'glob ignore pattern must exclude ignored directory');
    assert.equal(zip.includes(Buffer.from('notes.log')), false,
      'glob pattern must exclude non-matching files');

    console.log('PASS: archiver glob includes root and nested matching files');
    console.log('PASS: archiver glob ignore and extension filters are honored');
    console.log('ARCHIVER_MINIMATCH_COMPATIBILITY=PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('ARCHIVER_MINIMATCH_COMPATIBILITY=FAIL');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
