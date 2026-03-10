// src/utils/deckCatalog.js
// Reads the nightly-synced deck catalog from Firestore.
// Firestore path: meta_decks/{format}/decks/{deckId}
//
// Decks are written by scripts/sync-decks.mjs each night.
// Returns real decks only — no placeholders.

import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from './firebaseConfig';

// In-memory cache per format so the page doesn't re-fetch on each render
const _cache = new Map(); // format → { decks, fetchedAt }
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const SUPPORTED_FORMATS = ['standard', 'modern', 'pioneer', 'commander'];

/**
 * getFormatMeta
 * Returns metadata about a format's last sync (deckCount, syncedAt).
 */
export async function getFormatMeta(format) {
  try {
    const snap = await getDoc(doc(db, 'meta_decks', format));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

/**
 * loadDecksForFormat
 * Fetches all decks for a given format from Firestore.
 * Results are cached in memory for 30 minutes.
 *
 * @param {string} format  'standard' | 'modern' | 'pioneer' | 'commander'
 * @returns {Promise<Array>}  Array of deck objects
 */
export async function loadDecksForFormat(format) {
  // Check in-memory cache
  const cached = _cache.get(format);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.decks;
  }

  const colRef = collection(db, 'meta_decks', format, 'decks');
  const snap = await getDocs(colRef);

  if (snap.empty) {
    return [];
  }

  const decks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  _cache.set(format, { decks, fetchedAt: Date.now() });
  return decks;
}

/**
 * loadAllDecks
 * Loads decks for all supported formats.
 * Uses Promise.allSettled so one failing format doesn't block others.
 *
 * @returns {Promise<Array>}
 */
export async function loadAllDecks() {
  const results = await Promise.allSettled(
    SUPPORTED_FORMATS.map((f) => loadDecksForFormat(f))
  );

  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }
  return all;
}

/**
 * getStrategiesForFormat
 * Returns unique strategy values present in the loaded decks.
 */
export function getStrategiesForFormat(decks) {
  const strats = new Set(decks.map((d) => d.strategy).filter(Boolean));
  return ['all', ...Array.from(strats).sort()];
}

/**
 * filterDecks
 * Filters a deck array by format and strategy.
 *
 * @param {Array}  decks
 * @param {object} filters  { format: string, strategy: string }
 * @returns {Array}
 */
export function filterDecks(decks, { format = 'all', strategy = 'all' } = {}) {
  return decks.filter((d) => {
    if (format !== 'all' && d.format !== format) return false;
    if (strategy !== 'all' && d.strategy !== strategy) return false;
    return true;
  });
}
