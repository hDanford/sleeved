// src/utils/deckCatalog.js
// Reads the nightly-synced deck catalog from Firestore.
// Firestore path: meta_decks/{format}/decks/{deckId}
//
// Decks are written by scripts/sync-decks.mjs each night.
// When Firestore is empty for Commander (e.g. sync script hasn't run yet),
// this module falls back to building decks live from Scryfall.

import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import {
  fetchCommanderDeckByName,
  fetchScryfallCommanderDecks,
} from './deckSources/scryfallCommanderSource';

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
 * For Commander, falls back to building decks live from Scryfall when
 * Firestore is empty (e.g. the nightly sync hasn't run yet).
 * Results are cached in memory for 30 minutes.
 *
 * @param {string} format  'standard' | 'modern' | 'pioneer' | 'commander'
 * @returns {Promise<Array>}  Array of deck objects
 */
export async function loadDecksForFormat(format) {
  // Check in-memory cache first
  const cached = _cache.get(format);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.decks;
  }

  // Try Firestore
  try {
    const colRef = collection(db, 'meta_decks', format, 'decks');
    const snap = await getDocs(colRef);

    if (!snap.empty) {
      const decks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      _cache.set(format, { decks, fetchedAt: Date.now() });
      return decks;
    }
  } catch (err) {
    console.warn('[deckCatalog] Firestore unavailable for', format, '—', err.message);
  }

  // ── Firestore empty / unavailable ──────────────────────────────────────────
  // For Commander, build a live catalog from Scryfall pre-built archetypes.
  // Other formats return empty (their Scryfall fallback lives in deckSuggestions).
  if (format === 'commander') {
    console.log('[deckCatalog] Building Commander catalog from Scryfall (Firestore empty)');
    try {
      const decks = await fetchScryfallCommanderDecks(12);
      if (decks.length > 0) {
        _cache.set(format, { decks, fetchedAt: Date.now() });
        return decks;
      }
    } catch (err) {
      console.warn('[deckCatalog] Scryfall commander fallback failed:', err.message);
    }
  }

  return [];
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

// ---------------------------------------------------------------------------
// On-demand commander search
// ---------------------------------------------------------------------------

/**
 * fetchAndCacheCommanderDeck
 *
 * Looks up a commander deck by name using this priority order:
 *   1. In-memory cache (both Scryfall and legacy EDHREC IDs)
 *   2. Firestore (new `scryfall-cmd-` prefix, then legacy `edhrec-` prefix)
 *   3. Scryfall live build via fetchCommanderDeckByName()
 *      — Archidekt will slot in here as a future step (see scryfallCommanderSource.js)
 *
 * On a successful live build, the deck is written to Firestore and injected
 * into the in-memory cache so it appears immediately in the catalog list.
 *
 * @param {string} commanderName  Exact or close card name, e.g. "Atraxa, Praetors' Voice"
 * @returns {Promise<object|null>}  Deck object, or null if the commander wasn't found
 */
export async function fetchAndCacheCommanderDeck(commanderName) {
  if (!commanderName?.trim()) return null;

  const name = commanderName.trim();

  // Derive the IDs we might expect in the cache/Firestore
  const scryfallSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const legacySlug   = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-');
  const newDocId     = `scryfall-cmd-${scryfallSlug}`;
  const oldDocId     = `edhrec-${legacySlug}`;

  // ── 1. In-memory cache ─────────────────────────────────────────────────────
  const cached = _cache.get('commander');
  if (cached) {
    const hit = cached.decks.find((d) => d.id === newDocId || d.id === oldDocId);
    if (hit) return hit;
  }

  // ── 2. Firestore ───────────────────────────────────────────────────────────
  for (const docId of [newDocId, oldDocId]) {
    try {
      const snap = await getDoc(doc(db, 'meta_decks', 'commander', 'decks', docId));
      if (snap.exists()) {
        const deck = { id: snap.id, ...snap.data() };
        _injectIntoCatalogCache('commander', deck);
        return deck;
      }
    } catch {
      // Firestore unavailable or doc missing — try next ID
    }
  }

  // ── 3. Live Scryfall build ─────────────────────────────────────────────────
  try {
    const deck = await fetchCommanderDeckByName(name);
    if (!deck || !deck.keyCards?.length) return null;

    // Persist to Firestore so subsequent page loads skip the build
    try {
      const docRef = doc(db, 'meta_decks', 'commander', 'decks', deck.id);
      await setDoc(docRef, deck);
    } catch {
      // Write failed (offline / permissions) — still return the deck for this session
    }

    _injectIntoCatalogCache('commander', deck);
    return deck;
  } catch (e) {
    console.warn('[deckCatalog] fetchAndCacheCommanderDeck failed:', e.message);
    return null;
  }
}

/** Inject a single deck into the in-memory catalog cache without invalidating it. */
function _injectIntoCatalogCache(format, deck) {
  const cached = _cache.get(format);
  if (!cached) return;
  const exists = cached.decks.some((d) => d.id === deck.id);
  if (!exists) {
    cached.decks = [deck, ...cached.decks];
  }
}
