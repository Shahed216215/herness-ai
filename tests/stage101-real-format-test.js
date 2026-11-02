'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildRealFormat,
  verifyRealFormat
} = require('../services/deliverable-real-format-builder');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-real-format-'));

  for (const format of ['XLSX', 'DOCX', 'PDF', 'CODE_PACKAGE']) {
    const ext = {
      XLSX: '.xlsx',
      DOCX: '.docx',
      PDF: '.pdf',
      CODE_PACKAGE: '.zip'
    }[format];

    const outputPath = path.join(root, `${format.toLowerCase()}${ext}`);

    await buildRealFormat({
      outputPath,
      format,
      title: `Mira ${format} Test`,
      content: {
        message: 'Real format verification',
        format
      }
    });

    assert(fs.existsSync(outputPath));
    assert(fs.statSync(outputPath).size > 0);
    assert.strictEqual(
      verifyRealFormat(outputPath, format),
      true,
      `${format} signature invalid`
    );
  }

  fs.rmSync(root, { recursive: true, force: true });

  console.log('STAGE10_1_REAL_FORMATS: PASS');
  console.log('XLSX: REAL ZIP/OOXML: PASS');
  console.log('DOCX: REAL ZIP/OOXML: PASS');
  console.log('PDF: REAL PDF SIGNATURE: PASS');
  console.log('CODE_PACKAGE: REAL ZIP: PASS');
})();
