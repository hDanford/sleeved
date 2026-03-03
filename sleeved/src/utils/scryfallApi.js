// src/utils/scryfallApi.js
// Wrapper for the Scryfall API (free, no key required)
// Docs: https://scryfall.com/docs/api

const BASE = 'https://api.scryfall.com';

// Respect Scryfall's rate limit guidance: 50-100ms between requests
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function searchCard(name) {
  const res = await fetch(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function searchCards(query, page = 1) {
  const res = await fetch(`${BASE}/cards/search?q=${encodeURIComponent(query)}&page=${page}`);
  if (!res.ok) return { data: [], has_more: false, total_cards: 0 };
  return res.json();
}

export async function getCardByName(exactName) {
  const res = await fetch(`${BASE}/cards/named?exact=${encodeURIComponent(exactName)}`);
  if (!res.ok) return null;
  return res.json();
}

// Batch-resolve a list of card names into full card objects
// Respects rate limits automatically
export async function resolveCardNames(names) {
  const results = [];
  for (const name of names) {
    const card = await searchCard(name);
    if (card) results.push(card);
    await delay(80);
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
