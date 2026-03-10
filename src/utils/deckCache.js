// src/utils/deckCache.js
// Downloads the nightly deck database from Firebase Storage and caches
// it in IndexedDB for 24 hours. Provides fast access to all deck data
// without any live API calls at suggestion time.

const DB_NAME    = 'deck_cache';
const DB_VERSION = 1;
const STORE      = 'decks';
const META_STORE = 'meta';
const TTL_MS     = 24 * 60 * 60 * 1000;

const DECKS_URL = `https://storage.googleapis.com/${import.meta.env.VITE_FIREBASE_STORAGE_BUCKET}/decks/all-decks.json`;

// ---------------------------------------------------------------------------
// IndexedDB helpers — store all decks as a single blob for simplicity
// ---------------------------------------------------------------------------
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE))     db.createObjectStore(STORE,      { keyPath: 'key' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = ()  => reject(req.error);
  });
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function idbSet(store, key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put({ key, value });
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * isDeckCacheReady
 * True if we have a fresh deck list cached (< 24 hrs old).
 */
export async function isDeckCacheReady() {
  try {
    const last = await idbGet(META_STORE, 'lastDownloaded');
    if (!last || Date.now() - last > TTL_MS) return false;
    const decks = await idbGet(STORE, 'all');
    return Array.isArray(decks) && decks.length > 0;
  } catch {
    return false;
  }
}

/**
 * initDeckCache
 * Downloads deck data from Firebase Storage if stale/missing.
 * Safe to call multiple times.
 *
 * @param {function} onProgress ({ phase: 'download'|'ready', pct }) => void
 */
export async function initDeckCache(onProgress) {
  const ready = await isDeckCacheReady();
  if (ready) {
    const decks = await idbGet(STORE, 'all');
    onProgress?.({ phase: 'ready', pct: 100, deckCount: decks.length });
    return { fresh: false, deckCount: decks.length };
  }

  onProgress?.({ phase: 'download', pct: 0 });
  const res = await fetch(DECKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch deck data: ${res.status}`);

  const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength > 0) {
      onProgress?.({ phase: 'download', pct: Math.round((received / contentLength) * 90) });
    }
  }

  const text  = await new Blob(chunks).text();
  const decks = JSON.parse(text);

  await idbSet(STORE, 'all', decks);
  await idbSet(META_STORE, 'lastDownloaded', Date.now());
  await idbSet(META_STORE, 'deckCount', decks.length);

  onProgress?.({ phase: 'ready', pct: 100, deckCount: decks.length });
  return { fresh: true, deckCount: decks.length };
}

/**
 * getAllDecks
 * Returns the full cached deck list.
 */
export async function getAllDecks() {
  const decks = await idbGet(STORE, 'all');
  return Array.isArray(decks) ? decks : [];
}

/**
 * getDeckCacheMeta
 */
export async function getDeckCacheMeta() {
  const [lastDownloaded, deckCount] = await Promise.all([
    idbGet(META_STORE, 'lastDownloaded'),
    idbGet(META_STORE, 'deckCount'),
  ]);
  return { lastDownloaded, deckCount };
}
