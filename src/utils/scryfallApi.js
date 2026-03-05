// src/utils/scryfallApi.js
// Wrapper for the Scryfall API (free, no key required)
// Docs: https://scryfall.com/docs/api
//
// Card lookups (searchCard, getCardByName, resolveCardNames) check the local
// IndexedDB bulk data first via bulkDataManager. The live API is only hit when
// bulk data is not yet available (e.g. first app load before download completes).

import { lookupCard, lookupCardExact, isBulkReady } from './bulkDataManager';

const BASE = 'https://api.scryfall.com';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — for live API fallback responses only

// ---------------------------------------------------------------------------
// Live API cache (fallback only)
// Used when bulk data isn't loaded yet. Keyed by URL.
// Falls back to in-memory Map if localStorage is unavailable.
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
// All live API requests are funnelled through here: 80ms gap between calls.
// The *.scryfall.io bulk download origin has no rate limit.
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

/**
 * searchCard
 * Fuzzy name lookup. Checks bulk data first; falls back to live API.
 */
export async function searchCard(name) {
  if (await isBulkReady()) {
    const card = await lookupCard(name);
    if (card) return card;
  }
  return cachedFetch(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
}

/**
 * getCardByName
 * Exact name lookup. Checks bulk data first; falls back to live API.
 */
export async function getCardByName(exactName) {
  if (await isBulkReady()) {
    const card = await lookupCardExact(exactName);
    if (card) return card;
  }
  return cachedFetch(`${BASE}/cards/named?exact=${encodeURIComponent(exactName)}`);
}

/**
 * searchCards
 * Query-based search. Always uses the live API — bulk data doesn't support
 * arbitrary Scryfall syntax queries locally.
 */
export async function searchCards(query, page = 1) {
  const data = await cachedFetch(
    `${BASE}/cards/search?q=${encodeURIComponent(query)}&page=${page}`
  );
  return data ?? { data: [], has_more: false, total_cards: 0 };
}

/**
 * resolveCardNames
 * Batch-resolve a list of card names to full Scryfall card objects.
 * Bulk data path skips the rate limiter entirely — pure local IndexedDB reads.
 */
export async function resolveCardNames(names) {
  const bulk = await isBulkReady();
  const results = [];

  for (const name of names) {
    if (bulk) {
      const card = await lookupCard(name);
      if (card) { results.push(card); continue; }
    }
    // Fallback to live API (rate-limited)
    const card = await cachedFetch(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
    if (card) results.push(card);
  }

  return results;
}

/**
 * getSynergyCards
 * Always uses the live API (requires Scryfall query syntax).
 */
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
