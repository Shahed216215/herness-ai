'use strict';

const fs = require('fs');
const path = require('path');
const storagePath = require('./mira-storage');

const {
  normalizeFollowUp,
  validateFollowUp
} = require('./client-follow-up-schema');

const STORE_FILE = storagePath('data/client-follow-ups.json');

function ensureStore() {
  const dir = path.dirname(STORE_FILE);

  fs.mkdirSync(dir, {
    recursive: true
  });

  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify({
        followUps: []
      }, null, 2) + '\n',
      'utf8'
    );
  }
}

function loadStore() {
  ensureStore();

  const raw = fs.readFileSync(
    STORE_FILE,
    'utf8'
  );

  const parsed = JSON.parse(raw);

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray(parsed.followUps)
  ) {
    throw new Error(
      'INVALID_CLIENT_FOLLOW_UP_STORE'
    );
  }

  return parsed;
}

function saveStore(store) {
  if (
    !store ||
    typeof store !== 'object' ||
    !Array.isArray(store.followUps)
  ) {
    throw new Error(
      'INVALID_CLIENT_FOLLOW_UP_STORE'
    );
  }

  ensureStore();

  const temp =
    `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temp,
    JSON.stringify(store, null, 2) + '\n',
    'utf8'
  );

  fs.renameSync(
    temp,
    STORE_FILE
  );
}

function create(input) {
  const record =
    normalizeFollowUp(input);

  const validation =
    validateFollowUp(record);

  if (!validation.valid) {
    throw new Error(
      `INVALID_FOLLOW_UP:${validation.errors.join(';')}`
    );
  }

  const store = loadStore();

  if (
    store.followUps.some(
      item => item.id === record.id
    )
  ) {
    throw new Error(
      'DUPLICATE_FOLLOW_UP'
    );
  }

  store.followUps.push(record);
  saveStore(store);

  return record;
}

function get(id) {
  return loadStore()
    .followUps
    .find(item => item.id === id) || null;
}

function list(filters = {}) {
  return loadStore()
    .followUps
    .filter(item => {
      if (
        filters.projectId !== undefined &&
        item.projectId !== filters.projectId
      ) {
        return false;
      }

      if (
        filters.clientId !== undefined &&
        item.clientId !== filters.clientId
      ) {
        return false;
      }

      if (
        filters.status !== undefined &&
        item.status !== filters.status
      ) {
        return false;
      }

      return true;
    })
    .slice();
}

function findByMessageHash(
  clientId,
  messageHash
) {
  if (!clientId || !messageHash) {
    return null;
  }

  return loadStore()
    .followUps
    .find(
      item =>
        item.clientId === clientId &&
        item.messageHash === messageHash
    ) || null;
}

function findLatestForClient(clientId) {
  const items = list({ clientId });

  if (!items.length) {
    return null;
  }

  return items.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() -
      new Date(a.createdAt).getTime()
  )[0];
}

function countForClient(clientId) {
  return list({ clientId }).length;
}

function update(id, updates = {}) {
  const store = loadStore();

  const index =
    store.followUps.findIndex(
      item => item.id === id
    );

  if (index === -1) {
    throw new Error(
      'FOLLOW_UP_NOT_FOUND'
    );
  }

  const current =
    store.followUps[index];

  const next = {
    ...current,
    ...updates,
    id: current.id,
    updatedAt:
      new Date().toISOString()
  };

  const normalized =
    normalizeFollowUp(next);

  const validation =
    validateFollowUp(normalized);

  if (!validation.valid) {
    throw new Error(
      `INVALID_FOLLOW_UP_UPDATE:${validation.errors.join(';')}`
    );
  }

  store.followUps[index] = normalized;
  saveStore(store);

  return normalized;
}

module.exports = {
  STORE_FILE,
  ensureStore,
  loadStore,
  saveStore,
  create,
  get,
  list,
  findByMessageHash,
  findLatestForClient,
  countForClient,
  update
};
