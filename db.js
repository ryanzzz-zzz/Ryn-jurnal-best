/* ============================================================
   RYN THE JOURNAL — Local IndexedDB layer
   No server, no login. All data + images persist on-device.
   ============================================================ */

const DB_NAME = 'ryn_journal_db';
const DB_VERSION = 1;
const STORE_TRADES = 'trades';
const STORE_SETTINGS = 'settings';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_TRADES)) {
        const store = db.createObjectStore(STORE_TRADES, { keyPath: 'id' });
        store.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

function tx(storeName, mode) {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

async function dbAll(storeName) {
  const store = await tx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(storeName, key) {
  const store = await tx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbClear(storeName) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbBulkPut(storeName, values) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    values.forEach(v => store.put(v));
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

// ---- Settings helpers ----
const DEFAULT_SETTINGS = {
  currency: 'USD',
  defaultRisk: '1%',
  defaultRR: '1:2',
  minSampleSize: 5,
  darkMode: true
};

async function getSettings() {
  const rows = await dbAll(STORE_SETTINGS);
  const map = { ...DEFAULT_SETTINGS };
  rows.forEach(r => { map[r.key] = r.value; });
  return map;
}

async function setSetting(key, value) {
  return dbPut(STORE_SETTINGS, { key, value });
}

window.RYNDB = {
  dbAll, dbGet, dbPut, dbDelete, dbClear, dbBulkPut,
  getSettings, setSetting,
  STORE_TRADES, STORE_SETTINGS, DEFAULT_SETTINGS
};
