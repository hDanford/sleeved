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
  setDoc,
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

// ---------------------------------------------------------------------------
// On-demand commander fetch + cache
// ---------------------------------------------------------------------------

/** Convert a commander name to an EDHREC slug, e.g. "Atraxa, Praetors' Voice" → "atraxa-praetors-voice" */
function toEdhrecSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')   // strip punctuation
    .trim()
    .replace(/\s+/g, '-');          // spaces → hyphens
}

function inferStrategy(name) {
  const n = (name ?? '').toLowerCase();
  if (/burn|aggro|weenie|goblins|affinity|infect/.test(n)) return 'aggro';
  if (/control|stax|prison/.test(n)) return 'control';
  if (/combo|storm|breach|reanimator/.test(n)) return 'combo';
  if (/ramp|landfall|devotion/.test(n)) return 'ramp';
  if (/tribal|elves|merfolk|zombies|vampires|dragons/.test(n)) return 'tribal';
  return 'midrange';
}

const COLOR_MAP = { W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' };
function normalizeColors(colorIdentity) {
  if (!Array.isArray(colorIdentity)) return [];
  return colorIdentity.map((c) => COLOR_MAP[c?.toUpperCase()] ?? c).filter(Boolean);
}

/**
 * fetchAndCacheCommanderDeck
 *
 * Looks up a commander by name:
 *   1. Returns from in-memory cache if present
 *   2. Checks Firestore (meta_decks/commander/decks/edhrec-{slug})
 *   3. Falls back to fetching EDHREC JSON directly and writing to Firestore
 *
 * @param {string} commanderName  Exact card name, e.g. "Atraxa, Praetors' Voice"
 * @returns {Promise<object|null>}  Deck object or null if not found
 */
export async function fetchAndCacheCommanderDeck(commanderName) {
  if (!commanderName?.trim()) return null;

  const slug = toEdhrecSlug(commanderName.trim());
  const docId = `edhrec-${slug}`;
  const docRef = doc(db, 'meta_decks', 'commander', 'decks', docId);

  // 1. In-memory cache hit
  const cached = _cache.get('commander');
  if (cached) {
    const hit = cached.decks.find((d) => d.id === docId);
    if (hit) return hit;
  }

  // 2. Firestore check
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const deck = { id: snap.id, ...snap.data() };
      // Inject into in-memory cache so it appears in the list
      _injectIntoCatalogCache('commander', deck);
      return deck;
    }
  } catch {
    // Firestore unavailable — fall through to EDHREC fetch
  }

  // 3. Fetch from EDHREC and write to Firestore
  try {
    const res = await fetch(
      `https://json.edhrec.com/pages/commanders/${slug}.json`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`EDHREC returned ${res.status}`);

    const data = await res.json();
    const jsonDict = data?.container?.json_dict ?? {};
    const cardlists = jsonDict?.cardlists ?? [];
    const commanderCard = jsonDict?.card ?? {};

    const keyCards = [];
    const seen = new Set();
    for (const list of cardlists) {
      for (const card of list?.cardviews ?? []) {
        if (!card?.name || seen.has(card.name)) continue;
        seen.add(card.name);
        keyCards.push({
          name: card.name,
          quantity: 1,
          section: 'mainboard',
          inclusion: card.inclusion ?? 0,
          synergy: card.synergy ?? 0,
        });
      }
    }

    if (!keyCards.length) return null;

    const deck = {
      id: docId,
      name: `${commanderName} Commander`,
      commander: commanderName,
      source: 'EDHREC',
      sourceUrl: `https://edhrec.com/commanders/${slug}`,
      format: 'commander',
      strategy: inferStrategy(commanderName),
      colors: normalizeColors(commanderCard?.color_identity),
      viewCount: commanderCard?.num_decks ?? 0,
      owner: null,
      description: `Top recommended cards for ${commanderName} commander decks, based on EDHREC data.`,
      keyCards,
      edhrecSuggestions: [],
      syncedAt: new Date().toISOString(),
      syncDate: new Date().toISOString().split('T')[0],
    };

    // Write to Firestore so future loads (and the nightly sync) pick it up
    try {
      await setDoc(docRef, deck);
    } catch {
      // Write failed (e.g. permissions) — still return the deck for this session
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
