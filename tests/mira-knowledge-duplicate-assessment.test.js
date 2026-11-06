'use strict';
const assert = require('node:assert/strict');
const { sameStoredRecord, findDuplicateGroups, removeExactDuplicateCopies } = require('../services/mira-knowledge-duplicate-assessment');

const first = { id: 'kb-1', title: 'Same title', url: 'https://example.test', content: 'same', source: 'manual' };
const exactCopy = JSON.parse(JSON.stringify(first));
const differentId = { ...first, id: 'kb-2' };
const differentSource = { ...first, source: 'web' };
const differentRevision = { ...first, revision: 2 };

assert.equal(sameStoredRecord(first, exactCopy), true);
console.log('FULL_RECORD_EXACT_COPY_DETECTED=PASS');
assert.equal(sameStoredRecord(first, differentId), false);
console.log('DISTINCT_LEGACY_IDS_PRESERVED=PASS');
assert.equal(sameStoredRecord(first, differentSource), false);
console.log('PROVENANCE_DIFFERENCE_PRESERVED=PASS');
assert.equal(sameStoredRecord(first, differentRevision), false);
console.log('REVISION_DIFFERENCE_PRESERVED=PASS');
assert.equal(findDuplicateGroups([first, exactCopy, differentId]).length, 1);
console.log('ONLY_IDENTICAL_RECORDS_GROUPED=PASS');
assert.equal(removeExactDuplicateCopies([first, exactCopy, differentId]).length, 2);
console.log('NONIDENTICAL_KNOWLEDGE_NOT_DELETED=PASS');
assert.throws(() => findDuplicateGroups({}), /array/);
console.log('INVALID_COLLECTION_REJECTED=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_KNOWLEDGE_DUPLICATE_ASSESSMENT_ISOLATED_PASS');
