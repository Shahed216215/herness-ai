'use strict';

const { getCapacity } = require('./capacity-config');
const localStore = require('./services/mira-local-memory-store');

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
