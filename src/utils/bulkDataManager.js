// src/utils/bulkDataManager.js
// Downloads Scryfall's daily bulk data file and stores it in IndexedDB.
// After the first download, all card lookups are served locally.
//
// Scryfall bulk data docs: https://scryfall.com/docs/api/bulk-data
// The *.scryfall.io download origin has no rate limits.

const DB_NAME = 'scryfall_bulk';
const DB_VERSION = 1;
const STORE_CARDS = 'cards';
const STORE_META = 'meta';
const BULK_TYPE = 'default_cards'; // includes prices; use 'oracle_cards' if size is a concern
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
      if (!db.objectStoreNames.contains(STORE_CARDS)) {
        const store = db.createObjectStore(STORE_CARDS, { keyPath: 'id' });
        // Index by lowercase name for fast fuzzy lookups
        store.createIndex('name_lower', 'name_lower', { unique: false });
        // Index by exact name for O(1) lookups
        store.createIndex('name_exact', 'name_exact', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function setMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key, value });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getCardCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CARDS, 'readonly');
    const req = tx.objectStore(STORE_CARDS).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Bulk-write cards to IndexedDB in batches to avoid long-running transactions.
 */
async function storeCards(cards, onProgress) {
  const db = await openDB();
  const BATCH = 500;
  let written = 0;

  for (let i = 0; i < cards.length; i += BATCH) {
    const batch = cards.slice(i, i + BATCH);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CARDS, 'readwrite');
      const store = tx.objectStore(STORE_CARDS);
      for (const card of batch) {
        store.put({
          ...card,
          name_lower: card.name?.toLowerCase() ?? '',
          name_exact: card.name ?? '',
        });
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    written += batch.length;
    onProgress?.(written, cards.length);
  }
}

// ---------------------------------------------------------------------------
// Download pipeline
// ---------------------------------------------------------------------------

/**
 * getBulkDownloadURL
 * Hits the lightweight bulk-data manifest to get today's download URL.
 */
async function getBulkDownloadURL() {
  const res = await fetch('https://api.scryfall.com/bulk-data');
  if (!res.ok) throw new Error('Failed to fetch bulk data manifest');
  const json = await res.json();
  const entry = json.data?.find((d) => d.type === BULK_TYPE);
  if (!entry) throw new Error(`Bulk type "${BULK_TYPE}" not found in manifest`);
  return { url: entry.download_uri, updatedAt: entry.updated_at, size: entry.compressed_size };
}

/**
 * downloadAndStore
 * Downloads the bulk JSON from scryfall.io (no rate limit) and writes to IndexedDB.
 * @param {function} onProgress  ({ phase: 'download'|'index', pct: 0-100 }) => void
 */
async function downloadAndStore(onProgress) {
  const { url, updatedAt } = await getBulkDownloadURL();

  // Download — stream the response to track progress
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bulk data download failed: ${res.status}`);

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
      onProgress?.({ phase: 'download', pct: Math.round((received / contentLength) * 100) });
    }
  }

  onProgress?.({ phase: 'download', pct: 100 });

  // Decode and parse
  const blob = new Blob(chunks);
  const text = await blob.text();
  const cards = JSON.parse(text);

  onProgress?.({ phase: 'index', pct: 0 });

  // Clear existing cards before re-indexing
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CARDS, 'readwrite');
    tx.objectStore(STORE_CARDS).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  await storeCards(cards, (written, total) => {
    onProgress?.({ phase: 'index', pct: Math.round((written / total) * 100) });
  });

  await setMeta('lastDownloaded', Date.now());
  await setMeta('scryfallUpdatedAt', updatedAt);
  await setMeta('cardCount', cards.length);

  onProgress?.({ phase: 'index', pct: 100 });
  return cards.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * isBulkReady
 * Returns true if IndexedDB has card data that is less than 24 hours old.
 */
export async function isBulkReady() {
  try {
    const lastDownloaded = await getMeta('lastDownloaded');
    if (!lastDownloaded) return false;
    if (Date.now() - lastDownloaded > TTL_MS) return false;
    const count = await getCardCount();
    return count > 0;
  } catch {
    return false;
  }
}

/**
 * getBulkMeta
 * Returns info about the current bulk data for display in the UI.
 */
export async function getBulkMeta() {
  try {
    const [lastDownloaded, scryfallUpdatedAt, cardCount] = await Promise.all([
      getMeta('lastDownloaded'),
      getMeta('scryfallUpdatedAt'),
      getMeta('cardCount'),
    ]);
    return { lastDownloaded, scryfallUpdatedAt, cardCount };
  } catch {
    return {};
  }
}

/**
 * initBulkData
 * Call once on app start. Downloads and indexes bulk data if stale or missing.
 * Safe to call multiple times — won't re-download if data is fresh.
 *
 * @param {function} onProgress  ({ phase, pct, cardCount? }) => void
 * @returns {Promise<{ fresh: boolean, cardCount: number }>}
 */
export async function initBulkData(onProgress) {
  const ready = await isBulkReady();
  if (ready) {
    const { cardCount } = await getBulkMeta();
    onProgress?.({ phase: 'ready', pct: 100, cardCount });
    return { fresh: false, cardCount };
  }

  try {
    const cardCount = await downloadAndStore(onProgress);
    onProgress?.({ phase: 'ready', pct: 100, cardCount });
    return { fresh: true, cardCount };
  } catch (err) {
    console.error('[bulkDataManager] Download failed:', err);
    onProgress?.({ phase: 'error', pct: 0, error: err.message });
    throw err;
  }
}

/**
 * lookupCard
 * Fuzzy lookup by name (case-insensitive). Returns the best Scryfall card match.
 * Prefers exact match, then falls back to prefix/contains match.
 *
 * @param {string} name
 * @returns {Promise<object|null>}
 */
export async function lookupCard(name) {
  if (!name) return null;
  try {
    const db = await openDB();
    const lower = name.toLowerCase().trim();

    // Try exact match first
    const exact = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CARDS, 'readonly');
      const idx = tx.objectStore(STORE_CARDS).index('name_exact');
      const req = idx.get(name.trim());
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (exact) return exact;

    // Fall back to lowercase exact
    const lowerExact = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CARDS, 'readonly');
      const idx = tx.objectStore(STORE_CARDS).index('name_lower');
      const req = idx.get(lower);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (lowerExact) return lowerExact;

    // Prefix scan for fuzzy match (e.g. "Lightning Bo" → "Lightning Bolt")
    const fuzzy = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CARDS, 'readonly');
      const idx = tx.objectStore(STORE_CARDS).index('name_lower');
      const range = IDBKeyRange.bound(lower, lower + '\uffff');
      const req = idx.openCursor(range);
      req.onsuccess = (e) => resolve(e.target.result?.value ?? null);
      req.onerror = () => reject(req.error);
    });
    return fuzzy;
  } catch {
    return null;
  }
}

/**
 * lookupCardExact
 * Strict exact-name lookup (case-sensitive). Faster than lookupCard.
 */
export async function lookupCardExact(name) {
  if (!name) return null;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CARDS, 'readonly');
      const idx = tx.objectStore(STORE_CARDS).index('name_exact');
      const req = idx.get(name.trim());
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * searchLocalCards
 * Returns up to `limit` cards whose names start with `query`.
 * Used for autocomplete / typeahead.
 */
export async function searchLocalCards(query, limit = 20) {
  if (!query) return [];
  try {
    const db = await openDB();
    const lower = query.toLowerCase().trim();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CARDS, 'readonly');
      const idx = tx.objectStore(STORE_CARDS).index('name_lower');
      const range = IDBKeyRange.bound(lower, lower + '\uffff');
      const results = [];
      const req = idx.openCursor(range);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || results.length >= limit) { resolve(results); return; }
        results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}
