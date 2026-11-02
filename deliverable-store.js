'use strict';

const fs = require('fs');
const path = require('path');
const storagePath = require('./mira-storage');

const DATA_DIR = storagePath('data');
const STORE_FILE = path.join(DATA_DIR, 'deliverables.json');

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify({ deliveries: [] }, null, 2)
    );
  }
}

function loadStore() {
  ensureStore();

  const raw = fs.readFileSync(STORE_FILE, 'utf8');
  if (!raw.trim()) return { deliveries: [] };

  const parsed = JSON.parse(raw);

  if (!parsed || !Array.isArray(parsed.deliveries)) {
    throw new Error('DELIVERY_STORE_CORRUPTED');
  }

  return parsed;
}

function saveStore(store) {
  if (!store || !Array.isArray(store.deliveries)) {
    throw new Error('INVALID_DELIVERY_STORE');
  }

  ensureStore();

  const temp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2));
  fs.renameSync(temp, STORE_FILE);
}

function create(delivery) {
  const store = loadStore();

  if (store.deliveries.some(x => x.id === delivery.id)) {
    throw new Error('DUPLICATE_DELIVERABLE');
  }

  store.deliveries.push(delivery);
  saveStore(store);
  return delivery;
}

function get(id) {
  return loadStore().deliveries.find(x => x.id === id) || null;
}

function list() {
  return loadStore().deliveries.slice();
}

function update(id, updater) {
  const store = loadStore();
  const index = store.deliveries.findIndex(x => x.id === id);

  if (index === -1) {
    throw new Error('DELIVERABLE_NOT_FOUND');
  }

  const current = store.deliveries[index];
  const next =
    typeof updater === 'function'
      ? updater(JSON.parse(JSON.stringify(current)))
      : updater;

  const merged =
    next &&
    typeof next === 'object' &&
    !Array.isArray(next)
      ? { ...current, ...next }
      : next;

  store.deliveries[index] = merged;
  saveStore(store);

  return merged;
}

function history() {
  return loadStore().deliveries.flatMap(delivery =>
    (delivery.history || []).map(event => ({
      deliverableId: delivery.id,
      ...event
    }))
  );
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
  history
};
