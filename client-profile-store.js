'use strict';

const fs = require('fs');
const path = require('path');
const storagePath = require('./mira-storage');

const STORE_FILE = storagePath('client-profiles.json');

function ensureStore() {
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify({ profiles: [] }, null, 2) + '\n',
      'utf8'
    );
  }
}

function loadStore() {
  ensureStore();

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`CLIENT_PROFILE_STORE_CORRUPTED:${error.message}`);
  }

  if (!parsed || !Array.isArray(parsed.profiles)) {
    throw new Error('CLIENT_PROFILE_STORE_INVALID');
  }

  return parsed;
}

function saveStore(store) {
  if (!store || !Array.isArray(store.profiles)) {
    throw new TypeError('CLIENT_PROFILE_STORE_INVALID');
  }

  const tmp = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, STORE_FILE);
}

function create(profile) {
  const store = loadStore();

  if (store.profiles.some(item => item.id === profile.id)) {
    const error = new Error('CLIENT_PROFILE_DUPLICATE');
    error.code = 'CLIENT_PROFILE_DUPLICATE';
    throw error;
  }

  store.profiles.push(profile);
  saveStore(store);
  return profile;
}

function get(id) {
  return loadStore().profiles.find(item => item.id === id) || null;
}

function list() {
  return loadStore().profiles.slice();
}

function update(id, updater) {
  const store = loadStore();
  const index = store.profiles.findIndex(item => item.id === id);

  if (index < 0) {
    const error = new Error('CLIENT_PROFILE_NOT_FOUND');
    error.code = 'CLIENT_PROFILE_NOT_FOUND';
    throw error;
  }

  const next = updater(store.profiles[index]);
  store.profiles[index] = next;
  saveStore(store);
  return next;
}

function remove(id) {
  const store = loadStore();
  const before = store.profiles.length;

  store.profiles = store.profiles.filter(item => item.id !== id);

  if (store.profiles.length === before) {
    const error = new Error('CLIENT_PROFILE_NOT_FOUND');
    error.code = 'CLIENT_PROFILE_NOT_FOUND';
    throw error;
  }

  saveStore(store);
  return true;
}

module.exports = {
  STORE_FILE,
  ensureStore,
  loadStore,
  saveStore,
  create,
  get,
  list,
  update,
  remove
};
