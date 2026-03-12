// src/utils/edhrecDeckBuilder.js
//
// Converts raw EDHREC cardlists (250+ cards) into a proper 99-card
// Commander deck plus a "swap in" bench of overflow recommendations.
//
// Usage:
//   import { buildCommanderDeck } from './edhrecDeckBuilder';
//   const { keyCards, swapIns } = buildCommanderDeck(cardlists, averageDeck);

// ---------------------------------------------------------------------------
// Map EDHREC cardlist header → internal type key
// ---------------------------------------------------------------------------
const HEADER_TYPE_MAP = {
  'Creatures':         'creatures',
  'Instants':          'instants',
  'Sorceries':         'sorceries',
  'Mana Artifacts':    'manaArtifacts',
  'Utility Artifacts': 'artifacts',
  'Enchantments':      'enchantments',
  'Planeswalkers':     'planeswalkers',
  'Battles':           'battles',
  'Utility Lands':     'lands',
  'Lands':             'lands',
};

// Cardlists that are cross-type "bonus" pools — cards here supplement the
// typed lists but don't belong to a single type on their own.
const BONUS_HEADERS = new Set([
  'High Synergy Cards',
  'Top Cards',
  'Game Changers',
  'New Cards',
]);

// ---------------------------------------------------------------------------
// Default 99-card distribution (1 commander slot is separate)
// Tuned to the EDHREC average across all Commander decks.
// ---------------------------------------------------------------------------
const DEFAULT_DISTRIBUTION = {
  creatures:      27,
  instants:       10,
  sorceries:       7,
  manaArtifacts:   6,
  artifacts:       5,
  enchantments:    5,
  planeswalkers:   2,
  battles:         0,
  lands:          37,
  // total: 99
};

// ---------------------------------------------------------------------------
// buildCommanderDeck
// ---------------------------------------------------------------------------

/**
 * @param {Array}  cardlists   — raw EDHREC cardlists array from json_dict
 * @param {object} averageDeck — optional EDHREC average counts per type
 *                               { creature, instant, sorcery, artifact,
 *                                 enchantment, land, planeswalker, battle }
 * @returns {{ keyCards: Array, swapIns: Array }}
 *   keyCards — up to 99 cards forming the main deck
 *   swapIns  — remaining high-inclusion cards labelled as bench suggestions
 */
export function buildCommanderDeck(cardlists, averageDeck = {}) {
  // ── 1. Build target distribution ──────────────────────────────────────────
  // Use EDHREC's per-commander averages when available, fall back to defaults.
  const dist = {
    creatures:     averageDeck.creature      ?? DEFAULT_DISTRIBUTION.creatures,
    instants:      averageDeck.instant       ?? DEFAULT_DISTRIBUTION.instants,
    sorceries:     averageDeck.sorcery       ?? DEFAULT_DISTRIBUTION.sorceries,
    manaArtifacts: Math.round((averageDeck.artifact ?? 11) * 0.55), // ~55% are mana rocks
    artifacts:     Math.round((averageDeck.artifact ?? 11) * 0.45), // ~45% utility
    enchantments:  averageDeck.enchantment   ?? DEFAULT_DISTRIBUTION.enchantments,
    planeswalkers: averageDeck.planeswalker  ?? DEFAULT_DISTRIBUTION.planeswalkers,
    battles:       averageDeck.battle        ?? DEFAULT_DISTRIBUTION.battles,
    lands:         averageDeck.land          ?? DEFAULT_DISTRIBUTION.lands,
  };

  // Clamp total to 99 (rounding can push it over)
  const total = Object.values(dist).reduce((s, n) => s + n, 0);
  if (total > 99) dist.lands -= (total - 99);

  // ── 2. Bucket cards by type from their cardlist header ────────────────────
  const pools = {}; // type → Map<name, cardview> (Map preserves insertion order, dedupes)
  const bonusPool = new Map(); // cross-type cards sorted by inclusion

  for (const list of cardlists) {
    const header = list.header ?? '';
    const type = HEADER_TYPE_MAP[header];

    for (const card of list.cardviews ?? []) {
      if (!card?.name) continue;

      if (type) {
        if (!pools[type]) pools[type] = new Map();
        if (!pools[type].has(card.name)) pools[type].set(card.name, card);
      } else if (BONUS_HEADERS.has(header)) {
        if (!bonusPool.has(card.name)) bonusPool.set(card.name, card);
      }
    }
  }

  // Sort each pool by inclusion descending
  const sorted = {};
  for (const [type, map] of Object.entries(pools)) {
    sorted[type] = [...map.values()].sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));
  }
  const sortedBonus = [...bonusPool.values()].sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  // ── 3. Pick top N per type ─────────────────────────────────────────────────
  const selected = new Set(); // track names already in main deck
  const keyCards = [];
  const overflow = []; // cards not selected for main deck

  function pick(type, section = 'mainboard') {
    const target = dist[type] ?? 0;
    const pool = sorted[type] ?? [];

    let taken = 0;
    for (const card of pool) {
      if (selected.has(card.name)) continue;
      if (taken < target) {
        keyCards.push(makeCard(card, section));
        selected.add(card.name);
        taken++;
      } else {
        overflow.push(card);
      }
    }

    // If we came up short, note the gap (will be filled from bonus pool below)
    return target - taken; // shortfall
  }

  // Pick typed cards in priority order
  let shortfall = 0;
  shortfall += pick('creatures');
  shortfall += pick('instants');
  shortfall += pick('sorceries');
  shortfall += pick('manaArtifacts');
  shortfall += pick('artifacts');
  shortfall += pick('enchantments');
  shortfall += pick('planeswalkers');
  shortfall += pick('battles');
  shortfall += pick('lands', 'land');

  // ── 4. Fill shortfalls from bonus pool ────────────────────────────────────
  if (shortfall > 0) {
    for (const card of sortedBonus) {
      if (shortfall <= 0) break;
      if (selected.has(card.name)) continue;
      keyCards.push(makeCard(card, 'mainboard'));
      selected.add(card.name);
      shortfall--;
    }
  }

  // ── 5. Build swapIns from overflow + unused bonus pool ────────────────────
  // Sort combined overflow by inclusion descending, cap at 30
  const allOverflow = [
    ...overflow,
    ...sortedBonus.filter((c) => !selected.has(c.name)),
  ].sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  // Dedupe by name
  const swapInsSeen = new Set();
  const swapIns = [];
  for (const card of allOverflow) {
    if (swapInsSeen.has(card.name)) continue;
    swapInsSeen.add(card.name);
    swapIns.push(makeCard(card, 'mainboard'));
    if (swapIns.length >= 30) break;
  }

  return { keyCards, swapIns };
}

function makeCard(cardview, section) {
  return {
    name:      cardview.name,
    quantity:  1,
    section,
    inclusion: cardview.inclusion ?? 0,
    synergy:   cardview.synergy   ?? 0,
  };
}
