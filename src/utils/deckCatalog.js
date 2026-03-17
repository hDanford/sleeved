// src/utils/deckCatalog.js

import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';
import { fetchCommanderDeckByName, fetchScryfallCommanderDecks } from './deckSources/scryfallCommanderSource';
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
// normalizeDeck — applied at every exit point so the app never sees a bad deck
// ---------------------------------------------------------------------------

export function normalizeDeck(deck) {
  const limit       = FORMAT_LIMITS[deck.format] ?? 60;
  const isCommander = deck.format === 'commander';

  // 1. Deduplicate by name
  const cardMap = new Map();
  for (const card of (deck.keyCards ?? [])) {
    const key = card.name;
    if (cardMap.has(key)) {
      if (isCommander && !BASIC_LAND_NAMES.has(key)) continue; // singleton
      cardMap.get(key).quantity = (cardMap.get(key).quantity ?? 1) + (card.quantity ?? 1);
    } else {
      cardMap.set(key, { ...card, quantity: card.quantity ?? 1 });
    }
  }

  // 2. Enforce per-card quantity caps
  for (const [name, card] of cardMap) {
    if (isCommander && card.section !== 'commander' && !BASIC_LAND_NAMES.has(name)) {
      card.quantity = 1;
    } else if (!isCommander && !BASIC_LAND_NAMES.has(name)) {
      card.quantity = Math.min(card.quantity, 4);
    }
    card.quantity = Math.max(1, card.quantity);
  }

  // 3. Separate commander slot
  const all           = [...cardMap.values()];
  const commanders    = all.filter((c) => c.section === 'commander');
  const nonCommanders = all.filter((c) => c.section !== 'commander');
  const cmdCount      = commanders.reduce((s, c) => s + c.quantity, 0);
  const total         = cmdCount + nonCommanders.reduce((s, c) => s + c.quantity, 0);

  if (total <= limit) return { ...deck, keyCards: [...commanders, ...nonCommanders] };

  // 4. Trim to limit (mainboard first, then lands)
  const mainboard = nonCommanders.filter((c) => c.section === 'mainboard');
  const lands     = nonCommanders.filter((c) => c.section === 'land');
  const other     = nonCommanders.filter((c) => c.section !== 'mainboard' && c.section !== 'land');
  const ordered   = [...mainboard, ...lands, ...other];
  const remaining = limit - cmdCount;
  const trimmed   = [];
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

const _cache      = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

export const SUPPORTED_FORMATS = ['standard', 'modern', 'pioneer', 'commander'];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getFormatMeta(format) {
  try {
    const snap = await getDoc(doc(db, 'meta_decks', format));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

/**
 * loadDecksForFormat
 * Tries Firestore first, then falls back to a live Scryfall build.
 * normalizeDeck() applied to every deck before caching.
 * Commander builds all 31 pre-built archetypes; 60-card formats build all 16.
 */
export async function loadDecksForFormat(format) {
  const cached = _cache.get(format);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.decks;

  // Firestore
  try {
    const snap = await getDocs(collection(db, 'meta_decks', format, 'decks'));
    if (!snap.empty) {
      const decks = snap.docs
        .map((d) => normalizeDeck({ id: d.id, ...d.data() }))
        .filter((d) => (d.keyCards ?? []).length >= 10);
      _cache.set(format, { decks, fetchedAt: Date.now() });
      return decks;
    }
  } catch (err) {
    console.warn('[deckCatalog] Firestore unavailable for', format, '—', err.message);
  }

  // Scryfall fallback
  if (format === 'commander') {
    console.log('[deckCatalog] Building Commander catalog from Scryfall (31 archetypes)');
    try {
      // Pass 31 to build all pre-defined archetypes in scryfallCommanderSource
      const raw   = await fetchScryfallCommanderDecks(31);
      const decks = raw.map(normalizeDeck).filter((d) => (d.keyCards ?? []).length >= 10);
      if (decks.length > 0) { _cache.set(format, { decks, fetchedAt: Date.now() }); return decks; }
    } catch (err) { console.warn('[deckCatalog] Scryfall commander fallback failed:', err.message); }
  } else {
    console.log(`[deckCatalog] Building ${format} catalog from Scryfall (16 archetypes)`);
    try {
      const raw   = await fetchScryfallArchetypeDecks(format);
      const decks = raw.map(normalizeDeck).filter((d) => (d.keyCards ?? []).length >= 10);
      if (decks.length > 0) { _cache.set(format, { decks, fetchedAt: Date.now() }); return decks; }
    } catch (err) { console.warn(`[deckCatalog] Scryfall ${format} fallback failed:`, err.message); }
  }

  return [];
}

export async function loadAllDecks() {
  const results = await Promise.allSettled(SUPPORTED_FORMATS.map((f) => loadDecksForFormat(f)));
  const all = [];
  for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);
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

export async function fetchAndCacheCommanderDeck(commanderName) {
  if (!commanderName?.trim()) return null;
  const name         = commanderName.trim();
  const scryfallSlug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
  const legacySlug   = name.toLowerCase().replace(/[^a-z0-9\s]/g,'').trim().replace(/\s+/g,'-');
  const newDocId     = `scryfall-cmd-${scryfallSlug}`;
  const oldDocId     = `edhrec-${legacySlug}`;

  const cached = _cache.get('commander');
  if (cached) {
    const hit = cached.decks.find((d) => d.id === newDocId || d.id === oldDocId);
    if (hit) return hit;
  }

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

  try {
    const raw = await fetchCommanderDeckByName(name);
    if (!raw?.keyCards?.length) return null;
    const deck = normalizeDeck(raw);
    try { await setDoc(doc(db, 'meta_decks', 'commander', 'decks', deck.id), deck); } catch { /* offline */ }
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
  if (!cached.decks.some((d) => d.id === deck.id)) cached.decks = [deck, ...cached.decks];
}
