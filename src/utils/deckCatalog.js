// src/utils/deckCatalog.js
// Reads the nightly-synced deck catalog from Firestore.
// Firestore path: meta_decks/{format}/decks/{deckId}
//
// normalizeDeck() is applied to every deck at the boundary so the rest of the
// app never sees a deck with wrong card counts regardless of source.

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
import { fetchScryfallArchetypeDecks } from './deckSources/scryfallSource';

// ---------------------------------------------------------------------------
// Format limits
// ---------------------------------------------------------------------------

export const FORMAT_LIMITS = {
  commander: 100,
  standard:   60,
  modern:     60,
  pioneer:    60,
};

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
]);

// ---------------------------------------------------------------------------
// normalizeDeck
// Applied to every deck before it leaves this module.
// Fixes:
//   1. Duplicate card names (merges or removes)
//   2. Quantity violations (singleton for commander non-basics, ≤4 for 60-card)
//   3. Total card count exceeding the format limit (trims from mainboard, then lands)
// ---------------------------------------------------------------------------

export function normalizeDeck(deck) {
  const limit = FORMAT_LIMITS[deck.format] ?? 60;
  const isCommander = deck.format === 'commander';

  // ── Step 1: deduplicate by name ──────────────────────────────────────────
  const cardMap = new Map();
  for (const card of (deck.keyCards ?? [])) {
    const key = card.name;
    if (cardMap.has(key)) {
      // Commander singleton: skip duplicates (except basic lands which stack)
      if (isCommander && !BASIC_LAND_NAMES.has(key)) continue;
      // 60-card: merge quantities
      cardMap.get(key).quantity = (cardMap.get(key).quantity ?? 1) + (card.quantity ?? 1);
    } else {
      cardMap.set(key, { ...card, quantity: card.quantity ?? 1 });
    }
  }

  // ── Step 2: enforce per-card quantity limits ─────────────────────────────
  for (const [name, card] of cardMap) {
    if (isCommander && card.section !== 'commander' && !BASIC_LAND_NAMES.has(name)) {
      card.quantity = 1;
    } else if (!isCommander && !BASIC_LAND_NAMES.has(name)) {
      card.quantity = Math.min(card.quantity, 4);
    }
    // Sanity: never let any single entry go negative or zero
    card.quantity = Math.max(1, card.quantity);
  }

  // ── Step 3: separate commander slot from everything else ─────────────────
  const all          = [...cardMap.values()];
  const commanders   = all.filter((c) => c.section === 'commander');
  const nonCommanders = all.filter((c) => c.section !== 'commander');

  const cmdCount = commanders.reduce((s, c) => s + c.quantity, 0);
  const total    = cmdCount + nonCommanders.reduce((s, c) => s + c.quantity, 0);

  if (total <= limit) {
    return { ...deck, keyCards: [...commanders, ...nonCommanders] };
  }

  // ── Step 4: trim to limit ────────────────────────────────────────────────
  // Trim order: mainboard first (easiest to lose), then lands
  const mainboard = nonCommanders.filter((c) => c.section === 'mainboard');
  const lands     = nonCommanders.filter((c) => c.section === 'land');
  const other     = nonCommanders.filter((c) => c.section !== 'mainboard' && c.section !== 'land');

  const ordered = [...mainboard, ...lands, ...other];
  const remaining = limit - cmdCount;
  const trimmed = [];
  let filled = 0;

  for (const card of ordered) {
    if (filled >= remaining) break;
    const qty = Math.min(card.quantity, remaining - filled);
    trimmed.push({ ...card, quantity: qty });
    filled += qty;
  }

  return { ...deck, keyCards: [...commanders, ...trimmed] };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const _cache = new Map(); // format → { decks, fetchedAt }
const CACHE_TTL_MS = 30 * 60 * 1000;

export const SUPPORTED_FORMATS = ['standard', 'modern', 'pioneer', 'commander'];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
 * Falls back to a live Scryfall build when Firestore is empty.
 * normalizeDeck() is applied to every deck before caching.
 */
export async function loadDecksForFormat(format) {
  const cached = _cache.get(format);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.decks;
  }

  // Try Firestore
  try {
    const snap = await getDocs(collection(db, 'meta_decks', format, 'decks'));
    if (!snap.empty) {
      const decks = snap.docs
        .map((d) => normalizeDeck({ id: d.id, ...d.data() }))
        .filter((d) => (d.keyCards ?? []).length >= 10); // drop any still-bad decks
      _cache.set(format, { decks, fetchedAt: Date.now() });
      return decks;
    }
  } catch (err) {
    console.warn('[deckCatalog] Firestore unavailable for', format, '—', err.message);
  }

  // Firestore empty — build from Scryfall
  if (format === 'commander') {
    console.log('[deckCatalog] Building Commander catalog from Scryfall (Firestore empty)');
    try {
      const raw   = await fetchScryfallCommanderDecks(12);
      const decks = raw.map(normalizeDeck).filter((d) => (d.keyCards ?? []).length >= 10);
      if (decks.length > 0) {
        _cache.set(format, { decks, fetchedAt: Date.now() });
        return decks;
      }
    } catch (err) {
      console.warn('[deckCatalog] Scryfall commander fallback failed:', err.message);
    }
  } else {
    console.log(`[deckCatalog] Building ${format} catalog from Scryfall (Firestore empty)`);
    try {
      const raw   = await fetchScryfallArchetypeDecks(format);
      const decks = raw.map(normalizeDeck).filter((d) => (d.keyCards ?? []).length >= 10);
      if (decks.length > 0) {
        _cache.set(format, { decks, fetchedAt: Date.now() });
        return decks;
      }
    } catch (err) {
      console.warn(`[deckCatalog] Scryfall ${format} fallback failed:`, err.message);
    }
  }

  return [];
}

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

export function getStrategiesForFormat(decks) {
  const strats = new Set(decks.map((d) => d.strategy).filter(Boolean));
  return ['all', ...Array.from(strats).sort()];
}

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

export async function fetchAndCacheCommanderDeck(commanderName) {
  if (!commanderName?.trim()) return null;

  const name         = commanderName.trim();
  const scryfallSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const legacySlug   = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-');
  const newDocId     = `scryfall-cmd-${scryfallSlug}`;
  const oldDocId     = `edhrec-${legacySlug}`;

  // 1. In-memory cache
  const cached = _cache.get('commander');
  if (cached) {
    const hit = cached.decks.find((d) => d.id === newDocId || d.id === oldDocId);
    if (hit) return hit;
  }

  // 2. Firestore
  for (const docId of [newDocId, oldDocId]) {
    try {
      const snap = await getDoc(doc(db, 'meta_decks', 'commander', 'decks', docId));
      if (snap.exists()) {
        const deck = normalizeDeck({ id: snap.id, ...snap.data() });
        _injectIntoCatalogCache('commander', deck);
        return deck;
      }
    } catch { /* try next */ }
  }

  // 3. Live Scryfall build
  try {
    const raw = await fetchCommanderDeckByName(name);
    if (!raw?.keyCards?.length) return null;

    const deck = normalizeDeck(raw);

    try {
      await setDoc(doc(db, 'meta_decks', 'commander', 'decks', deck.id), deck);
    } catch { /* offline / permissions — still return */ }

    _injectIntoCatalogCache('commander', deck);
    return deck;
  } catch (e) {
    console.warn('[deckCatalog] fetchAndCacheCommanderDeck failed:', e.message);
    return null;
  }
}

function _injectIntoCatalogCache(format, deck) {
  const cached = _cache.get(format);
  if (!cached) return;
  if (!cached.decks.some((d) => d.id === deck.id)) {
    cached.decks = [deck, ...cached.decks];
  }
}
