// src/utils/scryfallApi.js
// Wrapper for the Scryfall API (free, no key required)
// Docs: https://scryfall.com/docs/api
//
// Card lookups check local IndexedDB bulk data first via bulkDataManager.
// The live API is only hit when bulk data isn't available yet.

import { lookupCard, lookupCardExact, isBulkReady } from './bulkDataManager';

const BASE = 'https://api.scryfall.com';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Memoised bulk-ready check
// isBulkReady() hits IndexedDB every call — cache the result in memory so
// we only pay that cost once per session, not once per card lookup.
// ---------------------------------------------------------------------------
let _bulkReadyCache = null;

async function bulkReady() {
  if (_bulkReadyCache !== null) return _bulkReadyCache;
  _bulkReadyCache = await isBulkReady();
  return _bulkReadyCache;
}

/** Call this after initBulkData() completes so the memo is invalidated. */
export function invalidateBulkReadyCache() {
  _bulkReadyCache = null;
}

// ---------------------------------------------------------------------------
// Live API cache (fallback only)
// ---------------------------------------------------------------------------
const memoryCache = new Map();

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(`scryfall:${key}`);
    if (raw) {
      const { value, expiresAt } = JSON.parse(raw);
      if (Date.now() < expiresAt) return value;
      localStorage.removeItem(`scryfall:${key}`);
    }
  } catch {
    const entry = memoryCache.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.value;
    if (entry) memoryCache.delete(key);
  }
  return null;
}

function cacheSet(key, value) {
  const expiresAt = Date.now() + CACHE_TTL_MS;
  try {
    localStorage.setItem(`scryfall:${key}`, JSON.stringify({ value, expiresAt }));
  } catch {
    memoryCache.set(key, { value, expiresAt });
  }
}

// ---------------------------------------------------------------------------
// Rate-limit queue (live API fallback only)
// ---------------------------------------------------------------------------
let lastRequestAt = 0;
const RATE_LIMIT_MS = 80;

async function rateLimitedFetch(url) {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  return fetch(url);
}

async function cachedFetch(url) {
  const cached = cacheGet(url);
  if (cached !== null) return cached;
  const res = await rateLimitedFetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  cacheSet(url, data);
  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchCard(name) {
  if (await bulkReady()) {
    const card = await lookupCard(name);
    if (card) return card;
  }
  return cachedFetch(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
}

export async function getCardByName(exactName) {
  if (await bulkReady()) {
    const card = await lookupCardExact(exactName);
    if (card) return card;
  }
  return cachedFetch(`${BASE}/cards/named?exact=${encodeURIComponent(exactName)}`);
}

export async function searchCards(query, page = 1) {
  const data = await cachedFetch(
    `${BASE}/cards/search?q=${encodeURIComponent(query)}&page=${page}`
  );
  return data ?? { data: [], has_more: false, total_cards: 0 };
}

/**
 * resolveCardNames
 * Bulk path: parallel IndexedDB reads (no rate limit needed).
 * Live API path: sequential with rate limiting.
 */
export async function resolveCardNames(names) {
  const bulk = await bulkReady();

  if (bulk) {
    // All lookups are local — fire them all in parallel
    const results = await Promise.all(names.map((name) => lookupCard(name)));
    return results.filter(Boolean);
  }

  // Fallback: live API must stay sequential (rate limit)
  const results = [];
  for (const name of names) {
    const card = await cachedFetch(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
    if (card) results.push(card);
  }
  return results;
}

export async function getSynergyCards({ colors, format, strategy, excludeNames = [] }) {
  const colorQuery = colors.length > 0 ? `color<=${colors.join('')}` : '';
  const formatQuery = format ? `legal:${format}` : '';
  let strategyQuery = '';
  if (strategy === 'aggro') strategyQuery = '(t:creature cmc<=3)';
  else if (strategy === 'control') strategyQuery = '(t:instant OR t:sorcery OR t:enchantment)';
  else if (strategy === 'ramp') strategyQuery = '(o:add OR t:land o:search)';
  else if (strategy === 'midrange') strategyQuery = '(t:creature cmc>=3 cmc<=5)';
  const parts = [colorQuery, formatQuery, strategyQuery, '-is:digital', '-t:basic'].filter(Boolean);
  try {
    const data = await searchCards(parts.join(' '));
    return (data.data ?? []).filter((c) => !excludeNames.includes(c.name));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
export function getColorSymbol(color) {
  const map = { W: '☀', U: '💧', B: '💀', R: '🔥', G: '🌿' };
  return map[color] || color;
}

export function getManaCostIcons(manaCost) {
  if (!manaCost) return '';
  return manaCost.replace(/\{([^}]+)\}/g, (_, s) => {
    if (s === 'W') return '☀';
    if (s === 'U') return '💧';
    if (s === 'B') return '💀';
    if (s === 'R') return '🔥';
    if (s === 'G') return '🌿';
    return s;
  });
}
