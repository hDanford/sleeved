// src/utils/scryfallApi.js
// Wrapper for the Scryfall API (free, no key required)
// Docs: https://scryfall.com/docs/api

const BASE = 'https://api.scryfall.com';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Cache
// Keyed by a string (e.g. card name or full URL). Stores { value, expiresAt }.
// Falls back to a plain in-memory Map if localStorage is unavailable.
// ---------------------------------------------------------------------------
const memoryCache = new Map();

function cacheGet(key) {
  // Try localStorage first
  try {
    const raw = localStorage.getItem(`scryfall:${key}`);
    if (raw) {
      const { value, expiresAt } = JSON.parse(raw);
      if (Date.now() < expiresAt) return value;
      localStorage.removeItem(`scryfall:${key}`);
    }
  } catch {
    // localStorage unavailable — fall through to memory cache
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
// Rate-limit queue
// All requests are funnelled through here to enforce a minimum 80ms gap
// between calls, satisfying Scryfall's 50–100ms guidance globally.
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

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
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
  return cachedFetch(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
}

export async function searchCards(query, page = 1) {
  const data = await cachedFetch(
    `${BASE}/cards/search?q=${encodeURIComponent(query)}&page=${page}`
  );
  return data ?? { data: [], has_more: false, total_cards: 0 };
}

export async function getCardByName(exactName) {
  return cachedFetch(`${BASE}/cards/named?exact=${encodeURIComponent(exactName)}`);
}

// Batch-resolve a list of card names into full card objects.
// Rate limiting is handled globally by rateLimitedFetch — no extra delay needed here.
export async function resolveCardNames(names) {
  const results = [];
  for (const name of names) {
    const card = await searchCard(name);
    if (card) results.push(card);
  }
  return results;
}

// Get cards that synergize with a given color identity and format
export async function getSynergyCards({ colors, format, strategy, excludeNames = [] }) {
  const colorQuery = colors.length > 0 ? `color<=${colors.join('')}` : '';
  const formatQuery = format ? `legal:${format}` : '';
  let strategyQuery = '';
  if (strategy === 'aggro') strategyQuery = '(t:creature cmc<=3)';
  else if (strategy === 'control') strategyQuery = '(t:instant OR t:sorcery OR t:enchantment)';
  else if (strategy === 'ramp') strategyQuery = '(o:add OR t:land o:search)';
  else if (strategy === 'midrange') strategyQuery = '(t:creature cmc>=3 cmc<=5)';
  const parts = [colorQuery, formatQuery, strategyQuery, '-is:digital', '-t:basic'].filter(Boolean);
  const query = parts.join(' ');
  try {
    const data = await searchCards(query);
    return (data.data || []).filter((c) => !excludeNames.includes(c.name));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Display helpers (unchanged)
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
