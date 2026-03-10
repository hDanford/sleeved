// src/utils/deckScoring.js
// Scoring engine for deck suggestions.
// Every sub-score returns a value in [0, 100].
// calculateMainScore() combines them using caller-supplied weights.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a value to [0, 100]. */
const clamp = (v) => Math.max(0, Math.min(100, v));

/** Normalise a cost (USD) to a 0-100 score where $0 remaining → 100, $500+ → 0. */
const costToScore = (usd, ceiling = 500) => clamp(100 - (usd / ceiling) * 100);

/** Return the set of non-basic card names in a deck list. */
function deckCardNames(deckList) {
  return new Set(
    deckList
      .filter((c) => c.section !== 'sideboard')
      .map((c) => c.name.toLowerCase())
  );
}

// ---------------------------------------------------------------------------
// Sub-scores
// ---------------------------------------------------------------------------

/**
 * Ownership Score
 * How many of the deck's cards does the user already own?
 * userCollection: Map<cardNameLower, quantityOwned>
 */
export function ownershipScore(deckList, userCollection) {
  if (!deckList.length) return 0;
  const mainboard = deckList.filter((c) => c.section !== 'sideboard');
  if (!mainboard.length) return 0;

  let owned = 0;
  let total = 0;
  for (const card of mainboard) {
    const key = card.name.toLowerCase();
    const need = card.quantity ?? 1;
    const have = userCollection?.get(key) ?? 0;
    owned += Math.min(have, need);
    total += need;
  }
  return clamp((owned / total) * 100);
}

/**
 * Style Match Score
 * How closely does this deck match the user's existing deck history?
 * Compares: color identity, dominant card types, average CMC.
 * userDeckProfiles: Array<{ colors: string[], avgCmc: number, typeCounts: Record<string,number> }>
 */
export function styleMatchScore(deckProfile, userDeckProfiles) {
  if (!userDeckProfiles?.length) return 50; // neutral if no history

  const scores = userDeckProfiles.map((prev) => {
    // Color overlap (Jaccard)
    const a = new Set(deckProfile.colors);
    const b = new Set(prev.colors);
    const intersection = [...a].filter((c) => b.has(c)).length;
    const union = new Set([...a, ...b]).size;
    const colorSim = union === 0 ? 1 : intersection / union;

    // CMC similarity (within 1.5 is close)
    const cmcDiff = Math.abs((deckProfile.avgCmc ?? 3) - (prev.avgCmc ?? 3));
    const cmcSim = Math.max(0, 1 - cmcDiff / 3);

    // Card type overlap (Jaccard over type buckets)
    const allTypes = new Set([
      ...Object.keys(deckProfile.typeCounts ?? {}),
      ...Object.keys(prev.typeCounts ?? {}),
    ]);
    let typeIntersection = 0;
    let typeUnion = 0;
    for (const t of allTypes) {
      const da = deckProfile.typeCounts?.[t] ?? 0;
      const db = prev.typeCounts?.[t] ?? 0;
      typeIntersection += Math.min(da, db);
      typeUnion += Math.max(da, db);
    }
    const typeSim = typeUnion === 0 ? 1 : typeIntersection / typeUnion;

    return (colorSim * 0.5 + cmcSim * 0.25 + typeSim * 0.25) * 100;
  });

  // Return the best match against any prior deck (user likely repeats styles)
  return clamp(Math.max(...scores));
}

/**
 * Completion Cost Score
 * Lower remaining purchase price → higher score.
 * missingCards: Array<{ name, quantity, price_usd }>
 * ceiling: USD amount that maps to score 0 (default $500)
 */
export function completionCostScore(missingCards, ceiling = 500) {
  const total = missingCards.reduce((sum, c) => {
    const price = parseFloat(c.price_usd ?? 0);
    return sum + price * (c.quantity ?? 1);
  }, 0);
  return costToScore(total, ceiling);
}

/**
 * Deck Strength Score
 * Proxy for power level using card data from Scryfall.
 * Factors: rarity distribution, average CMC efficiency, % non-basic lands.
 * resolvedCards: Array of Scryfall card objects for the deck.
 */
export function deckStrengthScore(resolvedCards) {
  if (!resolvedCards.length) return 50;

  const rarityWeights = { mythic: 1, rare: 0.75, uncommon: 0.4, common: 0.15 };
  let raritySum = 0;
  let cmcSum = 0;
  let nonBasicLands = 0;
  let landCount = 0;

  for (const card of resolvedCards) {
    raritySum += rarityWeights[card.rarity] ?? 0.2;

    const cmc = card.cmc ?? 0;
    const types = (card.type_line ?? '').toLowerCase();
    if (types.includes('land')) {
      landCount++;
      if (!types.includes('basic')) nonBasicLands++;
    } else {
      // Efficient non-lands score higher (sweet spot CMC 1-3)
      cmcSum += cmc <= 3 ? 1 : cmc <= 5 ? 0.6 : 0.3;
    }
  }

  const n = resolvedCards.length;
  const rarityScore = (raritySum / n) * 100;                          // 0-100
  const efficiencyScore = (cmcSum / Math.max(n - landCount, 1)) * 100; // 0-100
  const manabaseScore = landCount > 0 ? (nonBasicLands / landCount) * 100 : 50;

  return clamp(rarityScore * 0.4 + efficiencyScore * 0.4 + manabaseScore * 0.2);
}

/**
 * Synergy Score
 * Measures how many cards share keywords, tribes, or mechanics.
 * Higher shared-keyword density = tighter synergy.
 * resolvedCards: Array of Scryfall card objects.
 */
export function synergyScore(resolvedCards) {
  if (!resolvedCards.length) return 0;

  // Extract keywords + notable oracle-text tokens
  const SYNERGY_TOKENS = [
    'flying', 'trample', 'haste', 'deathtouch', 'lifelink', 'vigilance',
    'hexproof', 'indestructible', 'flash', 'reach', 'menace', 'first strike',
    'double strike', 'token', 'counter', '+1/+1', '-1/-1', 'sacrifice',
    'graveyard', 'exile', 'draw', 'discard', 'tutor', 'copy',
    'tribal', 'elf', 'goblin', 'zombie', 'human', 'dragon', 'merfolk',
    'vampire', 'wizard', 'warrior', 'knight',
  ];

  const tokenCounts = {};
  for (const card of resolvedCards) {
    const text = `${card.type_line ?? ''} ${card.oracle_text ?? ''}`.toLowerCase();
    for (const token of SYNERGY_TOKENS) {
      if (text.includes(token)) {
        tokenCounts[token] = (tokenCounts[token] ?? 0) + 1;
      }
    }
  }

  // A token appearing in ≥3 cards is a real synergy thread
  const n = resolvedCards.length;
  const synergyThreads = Object.values(tokenCounts).filter((c) => c >= 3);
  const totalSynergyCards = synergyThreads.reduce((a, b) => a + b, 0);

  // Normalise: if every card participates in at least one thread, score = 100
  return clamp((totalSynergyCards / (n * 1.5)) * 100);
}

// ---------------------------------------------------------------------------
// Weighted composite
// ---------------------------------------------------------------------------

/**
 * Weights shape: { ownership, styleMatch, completionCost, strength, synergy }
 * Each weight is a non-negative number; they don't need to sum to 1.
 */
export const DEFAULT_WEIGHTS = {
  ownership:      1.0,  // tier 1 — highest priority
  completionCost: 1.0,  // tier 1 — highest priority
  styleMatch:     0.7,  // tier 2
  strength:       0.4,  // tier 3
  synergy:        0.2,  // tier 4
};

export const SCORE_META = {
  ownership:      { label: 'Cards You Own',     color: '#22c55e', icon: '🃏' },
  styleMatch:     { label: 'Matches Your Style', color: '#818cf8', icon: '🎯' },
  completionCost: { label: 'Affordable to Build', color: '#f59e0b', icon: '💰' },
  strength:       { label: 'Deck Power',          color: '#ef4444', icon: '⚔️' },
  synergy:        { label: 'Internal Synergy',    color: '#06b6d4', icon: '🔗' },
};

/**
 * calculateMainScore
 * @param {Record<string, number>} subscores  Each value in [0,100]
 * @param {Record<string, number>} weights
 * @returns {number} Weighted average in [0,100]
 */
export function calculateMainScore(subscores, weights = DEFAULT_WEIGHTS) {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (weight > 0 && subscores[key] != null) {
      weightedSum += subscores[key] * weight;
      totalWeight += weight;
    }
  }
  return totalWeight === 0 ? 0 : clamp(weightedSum / totalWeight);
}

/**
 * scoreDeck — convenience wrapper that runs all sub-scores and returns a full result.
 *
 * @param {object} p
 * @param {Array}  p.deckList         Parsed card list [{ name, quantity, section }]
 * @param {Array}  p.resolvedCards    Scryfall card objects for the deck
 * @param {Map}    p.userCollection   Map<nameLower, qty>
 * @param {Array}  p.userDeckProfiles Array of profile objects from buildDeckProfile()
 * @param {object} p.weights          Optional weight overrides
 * @returns {{ subscores, mainScore, missingCards, totalCost }}
 */
export function scoreDeck({ deckList, resolvedCards, userCollection, userDeckProfiles, weights }) {
  // Determine missing cards
  const missingCards = [];
  for (const card of deckList.filter((c) => c.section !== 'sideboard')) {
    const key = card.name.toLowerCase();
    const have = userCollection?.get(key) ?? 0;
    const need = card.quantity ?? 1;
    if (have < need) {
      const scryfallCard = resolvedCards.find(
        (rc) => rc.name.toLowerCase() === key
      );
      missingCards.push({
        name: card.name,
        quantity: need - have,
        price_usd: scryfallCard?.prices?.usd ?? 0,
      });
    }
  }

  const profile = buildDeckProfile(resolvedCards);

  const subscores = {
    ownership:      ownershipScore(deckList, userCollection),
    styleMatch:     styleMatchScore(profile, userDeckProfiles),
    completionCost: completionCostScore(missingCards),
    strength:       deckStrengthScore(resolvedCards),
    synergy:        synergyScore(resolvedCards),
  };

  const mainScore = calculateMainScore(subscores, weights ?? DEFAULT_WEIGHTS);

  const totalCost = missingCards.reduce(
    (sum, c) => sum + parseFloat(c.price_usd ?? 0) * c.quantity,
    0
  );

  return { subscores, mainScore, missingCards, totalCost };
}

/**
 * buildDeckProfile — extract a lightweight profile from resolved Scryfall cards.
 * Used for styleMatch comparisons.
 */
export function buildDeckProfile(resolvedCards) {
  const colors = new Set();
  let cmcSum = 0;
  let cmcCount = 0;
  const typeCounts = {};

  for (const card of resolvedCards) {
    (card.color_identity ?? []).forEach((c) => colors.add(c));
    if (card.cmc != null && !card.type_line?.toLowerCase().includes('land')) {
      cmcSum += card.cmc;
      cmcCount++;
    }
    for (const type of ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'planeswalker', 'land']) {
      if ((card.type_line ?? '').toLowerCase().includes(type)) {
        typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      }
    }
  }

  return {
    colors: [...colors],
    avgCmc: cmcCount > 0 ? cmcSum / cmcCount : 0,
    typeCounts,
  };
}
