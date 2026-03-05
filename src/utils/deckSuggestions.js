// src/utils/deckSuggestions.js
// Generates a scored, ranked list of 10-20 deck suggestions.
// Pipeline:
//   1. Pull candidate decks from ARCHETYPE_REGISTRY (static) + Scryfall synergy search (dynamic)
//   2. Resolve card data via scryfallApi
//   3. Score each deck via deckScoring
//   4. Sort by weighted main score

import { resolveCardNames, getSynergyCards } from './scryfallApi';
import { scoreDeck, buildDeckProfile, calculateMainScore, DEFAULT_WEIGHTS } from './deckScoring';

// ---------------------------------------------------------------------------
// Archetype registry
// A curated set of well-known archetypes as seed decklists.
// Each entry has a name, format, strategy tag, color identity, and key cards.
// ---------------------------------------------------------------------------
export const ARCHETYPE_REGISTRY = [
  {
    id: 'mono-red-aggro',
    name: 'Mono Red Aggro',
    format: 'standard',
    strategy: 'aggro',
    colors: ['R'],
    description: 'Fast burn and cheap creatures to close games quickly.',
    keyCards: [
      { name: 'Lightning Bolt', quantity: 4 },
      { name: 'Monastery Swiftspear', quantity: 4 },
      { name: 'Goblin Guide', quantity: 4 },
      { name: 'Eidolon of the Great Revel', quantity: 4 },
      { name: 'Light Up the Stage', quantity: 4 },
      { name: 'Shard Volley', quantity: 2 },
      { name: 'Skullcrack', quantity: 3 },
      { name: 'Searing Blaze', quantity: 3 },
      { name: 'Inspiring Vantage', quantity: 2 },
      { name: 'Mountain', quantity: 18, section: 'land' },
    ],
  },
  {
    id: 'uw-control',
    name: 'Azorius Control',
    format: 'standard',
    strategy: 'control',
    colors: ['W', 'U'],
    description: 'Counter spells, removal, and card draw to dominate the late game.',
    keyCards: [
      { name: 'Counterspell', quantity: 4 },
      { name: 'Wrath of God', quantity: 3 },
      { name: 'Teferi, Hero of Dominaria', quantity: 3 },
      { name: 'Narset, Parter of Veils', quantity: 2 },
      { name: 'Supreme Verdict', quantity: 2 },
      { name: 'Sphinx\'s Revelation', quantity: 2 },
      { name: 'Hallowed Fountain', quantity: 4 },
      { name: 'Glacial Fortress', quantity: 4 },
      { name: 'Plains', quantity: 7 },
      { name: 'Island', quantity: 9 },
    ],
  },
  {
    id: 'golgari-midrange',
    name: 'Golgari Midrange',
    format: 'standard',
    strategy: 'midrange',
    colors: ['B', 'G'],
    description: 'Efficient threats and disruption for a grind-heavy game plan.',
    keyCards: [
      { name: 'Thoughtseize', quantity: 4 },
      { name: 'Tarmogoyf', quantity: 4 },
      { name: 'Scavenging Ooze', quantity: 3 },
      { name: 'Liliana of the Veil', quantity: 3 },
      { name: 'Fatal Push', quantity: 4 },
      { name: 'Abrupt Decay', quantity: 3 },
      { name: 'Overgrown Tomb', quantity: 4 },
      { name: 'Blooming Marsh', quantity: 4 },
      { name: 'Swamp', quantity: 5 },
      { name: 'Forest', quantity: 6 },
    ],
  },
  {
    id: 'simic-ramp',
    name: 'Simic Ramp',
    format: 'standard',
    strategy: 'ramp',
    colors: ['G', 'U'],
    description: 'Accelerate mana into powerful late-game threats.',
    keyCards: [
      { name: 'Elvish Mystic', quantity: 4 },
      { name: 'Llanowar Elves', quantity: 4 },
      { name: 'Cultivate', quantity: 3 },
      { name: 'Kodama\'s Reach', quantity: 3 },
      { name: 'Nissa, Who Shakes the World', quantity: 3 },
      { name: 'Cyclonic Rift', quantity: 2 },
      { name: 'Breeding Pool', quantity: 4 },
      { name: 'Hinterland Harbor', quantity: 4 },
      { name: 'Forest', quantity: 8 },
      { name: 'Island', quantity: 5 },
    ],
  },
  {
    id: 'rakdos-sacrifice',
    name: 'Rakdos Sacrifice',
    format: 'standard',
    strategy: 'midrange',
    colors: ['B', 'R'],
    description: 'Sacrifice synergies generate value while removing threats.',
    keyCards: [
      { name: 'Cauldron Familiar', quantity: 4 },
      { name: 'Witch\'s Oven', quantity: 4 },
      { name: 'Mayhem Devil', quantity: 4 },
      { name: 'Claim the Firstborn', quantity: 3 },
      { name: 'Korvold, Fae-Cursed King', quantity: 2 },
      { name: 'Blood Crypt', quantity: 4 },
      { name: 'Dragonskull Summit', quantity: 4 },
      { name: 'Swamp', quantity: 6 },
      { name: 'Mountain', quantity: 6 },
    ],
  },
  {
    id: 'selesnya-tokens',
    name: 'Selesnya Tokens',
    format: 'standard',
    strategy: 'aggro',
    colors: ['W', 'G'],
    description: 'Flood the board with tokens and go wide for the win.',
    keyCards: [
      { name: 'Intangible Virtue', quantity: 4 },
      { name: 'Raise the Alarm', quantity: 4 },
      { name: 'Spectral Procession', quantity: 4 },
      { name: 'Parallel Lives', quantity: 3 },
      { name: 'Emmara, Soul of the Accord', quantity: 3 },
      { name: 'Chord of Calling', quantity: 2 },
      { name: 'Temple Garden', quantity: 4 },
      { name: 'Plains', quantity: 9 },
      { name: 'Forest', quantity: 7 },
    ],
  },
  {
    id: 'dimir-mill',
    name: 'Dimir Mill',
    format: 'standard',
    strategy: 'control',
    colors: ['U', 'B'],
    description: 'Empty the opponent\'s library with mill spells and grind them out.',
    keyCards: [
      { name: 'Fractured Sanity', quantity: 4 },
      { name: 'Maddening Cacophony', quantity: 4 },
      { name: 'Tasha\'s Hideous Laughter', quantity: 4 },
      { name: 'Archive Trap', quantity: 4 },
      { name: 'Ruin Crab', quantity: 4 },
      { name: 'Watery Grave', quantity: 4 },
      { name: 'Drowned Catacomb', quantity: 4 },
      { name: 'Island', quantity: 7 },
      { name: 'Swamp', quantity: 5 },
    ],
  },
  {
    id: 'gruul-stompy',
    name: 'Gruul Stompy',
    format: 'standard',
    strategy: 'aggro',
    colors: ['R', 'G'],
    description: 'Big tramplers and haste threats to smash through defenses.',
    keyCards: [
      { name: 'Questing Beast', quantity: 4 },
      { name: 'Gruul Spellbreaker', quantity: 4 },
      { name: 'Bonecrusher Giant', quantity: 4 },
      { name: 'Embercleave', quantity: 3 },
      { name: 'Stomping Ground', quantity: 4 },
      { name: 'Rootbound Crag', quantity: 4 },
      { name: 'Forest', quantity: 7 },
      { name: 'Mountain', quantity: 7 },
    ],
  },
  {
    id: 'esper-reanimator',
    name: 'Esper Reanimator',
    format: 'standard',
    strategy: 'control',
    colors: ['W', 'U', 'B'],
    description: 'Discard fatties then cheat them into play for massive value.',
    keyCards: [
      { name: 'Unburial Rites', quantity: 4 },
      { name: 'Elesh Norn, Grand Cenobite', quantity: 2 },
      { name: 'Griselbrand', quantity: 2 },
      { name: 'Faithless Looting', quantity: 4 },
      { name: 'Thought Scour', quantity: 4 },
      { name: 'Godless Shrine', quantity: 4 },
      { name: 'Hallowed Fountain', quantity: 4 },
      { name: 'Watery Grave', quantity: 4 },
      { name: 'Plains', quantity: 2 },
      { name: 'Island', quantity: 2 },
      { name: 'Swamp', quantity: 3 },
    ],
  },
  {
    id: 'jund-midrange',
    name: 'Jund Midrange',
    format: 'modern',
    strategy: 'midrange',
    colors: ['B', 'R', 'G'],
    description: 'Classic three-colour midrange with hand disruption and efficient threats.',
    keyCards: [
      { name: 'Thoughtseize', quantity: 4 },
      { name: 'Tarmogoyf', quantity: 4 },
      { name: 'Bloodbraid Elf', quantity: 4 },
      { name: 'Liliana of the Veil', quantity: 3 },
      { name: 'Kolaghan\'s Command', quantity: 3 },
      { name: 'Inquisition of Kozilek', quantity: 3 },
      { name: 'Blackcleave Cliffs', quantity: 4 },
      { name: 'Verdant Catacombs', quantity: 3 },
      { name: 'Swamp', quantity: 3 },
      { name: 'Forest', quantity: 3 },
      { name: 'Mountain', quantity: 3 },
    ],
  },
  {
    id: 'mono-green-stompy',
    name: 'Mono Green Stompy',
    format: 'standard',
    strategy: 'aggro',
    colors: ['G'],
    description: 'Undercosted green creatures with trample to overrun opponents.',
    keyCards: [
      { name: 'Llanowar Elves', quantity: 4 },
      { name: 'Steel Leaf Champion', quantity: 4 },
      { name: 'Ghalta, Primal Hunger', quantity: 3 },
      { name: 'Territorial Allosaurus', quantity: 4 },
      { name: 'Elvish Clancaller', quantity: 4 },
      { name: 'Forest', quantity: 23 },
    ],
  },
  {
    id: 'izzet-spells',
    name: 'Izzet Spells',
    format: 'standard',
    strategy: 'control',
    colors: ['U', 'R'],
    description: 'Cast cheap instants and sorceries to trigger prowess and draw cards.',
    keyCards: [
      { name: 'Monastery Swiftspear', quantity: 4 },
      { name: 'Young Pyromancer', quantity: 4 },
      { name: 'Lightning Bolt', quantity: 4 },
      { name: 'Opt', quantity: 4 },
      { name: 'Expressive Iteration', quantity: 4 },
      { name: 'Steam Vents', quantity: 4 },
      { name: 'Spirebluff Canal', quantity: 4 },
      { name: 'Mountain', quantity: 5 },
      { name: 'Island', quantity: 5 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Suggestion pipeline
// ---------------------------------------------------------------------------

/**
 * generateSuggestions
 *
 * @param {object} params
 * @param {Map}    params.userCollection     Map<cardNameLower, qty>
 * @param {Array}  params.userDeckProfiles   buildDeckProfile() results from existing decks
 * @param {object} params.weights            Weight overrides (see DEFAULT_WEIGHTS)
 * @param {string} [params.format]           Filter to a specific format (e.g. 'standard')
 * @param {function} [params.onProgress]     (current, total) => void  progress callback
 * @returns {Promise<Array>} Sorted array of scored deck suggestions
 */
export async function generateSuggestions({
  userCollection,
  userDeckProfiles = [],
  weights = DEFAULT_WEIGHTS,
  format,
  onProgress,
}) {
  // 1. Pick candidate archetypes (optionally filtered by format)
  const candidates = format
    ? ARCHETYPE_REGISTRY.filter((a) => a.format === format || !format)
    : ARCHETYPE_REGISTRY;

  const total = candidates.length;
  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    const archetype = candidates[i];
    onProgress?.(i, total);

    try {
      // 2. Resolve card names via Scryfall (cached + rate-limited)
      const cardNames = archetype.keyCards
        .filter((c) => !['land', 'basic'].includes(c.section))
        .map((c) => c.name);

      const resolvedCards = await resolveCardNames(cardNames);

      // 3. Build a full deckList (keyCards with section defaulted to mainboard)
      const deckList = archetype.keyCards.map((c) => ({
        ...c,
        section: c.section ?? 'mainboard',
      }));

      // 4. Score
      const scored = scoreDeck({
        deckList,
        resolvedCards,
        userCollection,
        userDeckProfiles,
        weights,
      });

      results.push({
        ...archetype,
        ...scored,
        resolvedCards,
      });
    } catch (err) {
      console.warn(`Failed to score archetype "${archetype.name}":`, err);
    }
  }

  onProgress?.(total, total);

  // 5. Sort by mainScore descending
  return results.sort((a, b) => b.mainScore - a.mainScore);
}

/**
 * rescore
 * Re-apply new weights to already-fetched suggestions without hitting the API again.
 * @param {Array}  suggestions   Output of generateSuggestions()
 * @param {object} weights       New weight map
 * @returns {Array} Re-sorted suggestions
 */
export function rescore(suggestions, weights) {
  return suggestions
    .map((s) => ({
      ...s,
      mainScore: calculateMainScore(s.subscores, weights),
    }))
    .sort((a, b) => b.mainScore - a.mainScore);
}
