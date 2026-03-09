// src/utils/scryfallCache.js
// Fetches the slim Scryfall card JSON from Firebase Storage (updated nightly),
// caches it in IndexedDB for 24 hours, and exposes fast name-based lookups.

const DB_NAME    = 'scryfall_cache';
const DB_VERSION = 1;
const STORE      = 'cards';
const META_STORE = 'meta';
const TTL_MS     = 24 * 60 * 60 * 1000; // 24 hours

// Public URL written by the nightly GitHub Action
const STORAGE_URL = `https://storage.googleapis.com/${import.meta.env.VITE_FIREBASE_STORAGE_BUCKET}/scryfall/cards-slim.json`;

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('name_lower', 'name_lower', { unique: false });
        store.createIndex('name_exact', 'name_exact', { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = ()  => reject(req.error);
  });
}

async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function setMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key, value });
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function getCardCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function storeCards(cards, onProgress) {
  const db = await openDB();
  // Clear old data first
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });

  const BATCH = 1000;
  let written = 0;
  for (let i = 0; i < cards.length; i += BATCH) {
    const batch = cards.slice(i, i + BATCH);
    await new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const card of batch) {
        store.put({ ...card, name_lower: card.name?.toLowerCase() ?? '', name_exact: card.name ?? '' });
      }
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
    written += batch.length;
    onProgress?.(written, cards.length);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * isCacheReady
 * True if IndexedDB has fresh card data (< 24 hrs old).
 */
export async function isCacheReady() {
  try {
    const last = await getMeta('lastDownloaded');
    if (!last || Date.now() - last > TTL_MS) return false;
    return (await getCardCount()) > 0;
  } catch {
    return false;
  }
}

/**
 * initScryfallCache
 * Downloads the slim JSON from Firebase Storage and indexes it.
 * Safe to call multiple times — skips if cache is fresh.
 *
 * @param {function} onProgress ({ phase: 'download'|'index'|'ready', pct: 0-100 }) => void
 */
export async function initScryfallCache(onProgress) {
  const ready = await isCacheReady();
  if (ready) {
    const count = await getCardCount();
    onProgress?.({ phase: 'ready', pct: 100, cardCount: count });
    return { fresh: false, cardCount: count };
  }

  // Download slim JSON from Firebase Storage
  onProgress?.({ phase: 'download', pct: 0 });
  const res = await fetch(STORAGE_URL);
  if (!res.ok) throw new Error(`Failed to fetch card data: ${res.status}`);

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
      onProgress?.({ phase: 'download', pct: Math.round((received / contentLength) * 50) });
    }
  }

  onProgress?.({ phase: 'download', pct: 50 });

  const text  = await new Blob(chunks).text();
  const cards = JSON.parse(text);

  onProgress?.({ phase: 'index', pct: 50 });

  await storeCards(cards, (written, total) => {
    onProgress?.({ phase: 'index', pct: Math.round(50 + (written / total) * 50) });
  });

  await setMeta('lastDownloaded', Date.now());
  await setMeta('cardCount', cards.length);

  onProgress?.({ phase: 'ready', pct: 100, cardCount: cards.length });
  return { fresh: true, cardCount: cards.length };
}

/**
 * lookupCard
 * Case-insensitive name lookup. Prefers exact match, falls back to prefix.
 */
export async function lookupCard(name) {
  if (!name) return null;
  try {
    const db    = await openDB();
    const lower = name.toLowerCase().trim();

    // Exact match
    const exact = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('name_exact').get(name.trim());
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
    if (exact) return exact;

    // Lowercase exact
    const lExact = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('name_lower').get(lower);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
    if (lExact) return lExact;

    // Prefix scan
    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(lower, lower + '\uffff');
      const req   = db.transaction(STORE, 'readonly').objectStore(STORE).index('name_lower').openCursor(range);
      req.onsuccess = (e) => resolve(e.target.result?.value ?? null);
      req.onerror   = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
