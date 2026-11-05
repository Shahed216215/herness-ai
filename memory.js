'use strict';

const path = require('node:path');
const { getCapacity } = require('./capacity-config');
const localStore = require('./services/mira-local-memory-store');
const jsonStateStore = require('./services/mira-json-state-store');

function getMaxMemory() {
  return getCapacity('memory');
}

function loadMemory() {
  return localStore.readMemory();
}

function saveMemory(memory) {
  if (!Array.isArray(memory)) {
    throw new Error('Memory must be an array.');
  }

  const maxMemory = getMaxMemory();
  const limitedMemory = memory.slice(-maxMemory);
  const displaced = memory.slice(0, Math.max(0, memory.length - maxMemory));

  // Capacity pressure is a conflict/data-preservation event, not permission
  // to silently discard older Memory records. Quarantine must commit first.
  if (displaced.length > 0) {
    const sourceDigest = jsonStateStore.sha256(JSON.stringify(memory));
    jsonStateStore.quarantineConflict(
      path.dirname(localStore.MEMORY_FILE),
      'general-memory-capacity-eviction',
      {
        domain: 'GENERAL_MEMORY',
        records: displaced
      },
      {
        reason: 'MEMORY_CAPACITY_EVICTION',
        storeId: 'MIRA_GENERAL_MEMORY',
        sourceFile: path.basename(localStore.MEMORY_FILE),
        sourceDigest,
        capacity: maxMemory,
        originalEntryCount: memory.length,
        retainedEntryCount: limitedMemory.length,
        evictedEntryCount: displaced.length
      }
    );
  }

  localStore.writeMemory(limitedMemory);
  return limitedMemory;
}

function isDuplicateMessage(memory, role, content) {
  return memory.some(message =>
    message &&
    message.role === role &&
    message.content === content
  );
}

function addMemory(messageOrRole, content) {
  let role;
  let memoryContent;

  if (
    messageOrRole &&
    typeof messageOrRole === 'object' &&
    !Array.isArray(messageOrRole)
  ) {
    role = messageOrRole.role;
    memoryContent = messageOrRole.content;
  } else {
    role = messageOrRole;
    memoryContent = content;
  }

  if (
    typeof role !== 'string' ||
    typeof memoryContent !== 'string' ||
    !role.trim() ||
    !memoryContent.trim()
  ) {
    return;
  }

  const memory = loadMemory();

  if (isDuplicateMessage(memory, role, memoryContent)) {
    return;
  }

  memory.push({
    role,
    content: memoryContent,
    time: new Date().toISOString()
  });

  saveMemory(memory);
}

function getMemory() {
  return loadMemory();
}

module.exports = {
  addMemory,
  getMemory
};
