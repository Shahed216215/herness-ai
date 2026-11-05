'use strict';

// Conservative duplicate detection: remove only byte-semantic JSON-equivalent records.
// Similar content, shared titles, matching URLs or different IDs are not sufficient.
function sameStoredRecord(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
function findDuplicateGroups(records) {
  if (!Array.isArray(records)) throw new Error('Knowledge records must be an array.');
  const groups = [];
  for (const record of records) {
    const group = groups.find(items => sameStoredRecord(items[0], record));
    if (group) group.push(record);
    else groups.push([record]);
  }
  return groups.filter(group => group.length > 1);
}
function removeExactDuplicateCopies(records) {
  if (!Array.isArray(records)) throw new Error('Knowledge records must be an array.');
  const unique = [];
  for (const record of records) {
    if (!unique.some(existing => sameStoredRecord(existing, record))) unique.push(record);
  }
  return unique;
}
module.exports = { sameStoredRecord, findDuplicateGroups, removeExactDuplicateCopies };
