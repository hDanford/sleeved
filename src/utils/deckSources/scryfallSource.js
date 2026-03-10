// src/utils/deckSources/scryfallSource.js
// Builds approximate 60-card metagame archetypes using Scryfall search queries.
// Used as a fallback for Standard / Modern / Pioneer until MTGGoldfish proxy is live.

import { searchCards } from '../scryfallApi';

// ---------------------------------------------------------------------------
// Archetype definitions
// Each entry describes how to query Scryfall for its core cards.
// ---------------------------------------------------------------------------
const ARCHETYPES = {
  standard: [
    {
      id: 'scryfall-std-domain-ramp',
      name: 'Domain Ramp',
      strategy: 'ramp',
      colors: ['W', 'U', 'B', 'R', 'G'],
      description: 'Assemble all basic land types and unleash powerful domain spells.',
      queries: [
        'f:standard (o:domain OR o:"basic land types")',
        'f:standard t:land (o:"search your library" OR o:fetchland)',
      ],
    },
    {
      id: 'scryfall-std-esper-midrange',
      name: 'Esper Midrange',
      strategy: 'midrange',
      colors: ['W', 'U', 'B'],
      description: 'Efficient threats backed by counterspells and removal.',
      queries: [
        'f:standard (ci:wub) (t:creature cmc<=4 r:rare OR r:mythic)',
        'f:standard (ci:wub) (t:instant OR t:sorcery) (o:counter OR o:destroy OR o:exile)',
      ],
    },
    {
      id: 'scryfall-std-mono-red-aggro',
      name: 'Mono Red Aggro',
      strategy: 'aggro',
      colors: ['R'],
      description: 'Cheap burn and haste threats to end games fast.',
      queries: [
        'f:standard ci:r t:creature cmc<=2 (o:haste OR o:"deals damage")',
        'f:standard ci:r (t:instant OR t:sorcery) o:"deals" cmc<=2',
      ],
    },
    {
      id: 'scryfall-std-azorius-soldiers',
      name: 'Azorius Soldiers',
      strategy: 'aggro',
      colors: ['W', 'U'],
      description: 'Tribal soldiers with lords and anthem effects.',
      queries: [
        'f:standard ci:wu t:soldier (o:"soldier" OR o:lord)',
        'f:standard ci:wu t:creature o:"when ~ enters" cmc<=3',
      ],
    },
    {
      id: 'scryfall-std-golgari-midrange',
      name: 'Golgari Midrange',
      strategy: 'midrange',
      colors: ['B', 'G'],
      description: 'Value-packed threats with hand disruption and graveyard synergy.',
      queries: [
        'f:standard ci:bg t:creature (o:graveyard OR o:dies) (r:rare OR r:mythic)',
        'f:standard ci:bg t:sorcery (o:discard OR o:destroy OR o:exile) cmc<=3',
      ],
    },
  ],

  modern: [
    {
      id: 'scryfall-mod-yawgmoth',
      name: 'Yawgmoth Combo',
      strategy: 'combo',
      colors: ['B', 'G'],
      description: 'Undying creatures plus Yawgmoth for infinite value loops.',
      queries: [
        'f:modern (o:undying OR o:"enters with a +1/+1 counter") ci:bg t:creature',
        'f:modern ci:bg (o:"pay 1 life" OR o:proliferate) (r:rare OR r:mythic)',
      ],
    },
    {
      id: 'scryfall-mod-izzet-murktide',
      name: 'Izzet Murktide',
      strategy: 'control',
      colors: ['U', 'R'],
      description: 'Cheap spells and Murktide Regent for a tempo-control hybrid.',
      queries: [
        'f:modern ci:ur (t:instant OR t:sorcery) cmc<=2 (r:rare OR r:uncommon)',
        'f:modern ci:ur t:creature (o:delve OR o:prowess OR o:phyrexian)',
      ],
    },
    {
      id: 'scryfall-mod-burn',
      name: 'Burn',
      strategy: 'aggro',
      colors: ['R'],
      description: 'Maximum direct damage spells to race the opponent to zero.',
      queries: [
        'f:modern ci:r (t:instant OR t:sorcery) o:"deals 3 damage" cmc<=1',
        'f:modern ci:r t:creature cmc<=1 (o:haste OR o:"first strike") (r:uncommon OR r:rare)',
      ],
    },
    {
      id: 'scryfall-mod-living-end',
      name: 'Living End',
      strategy: 'combo',
      colors: ['B', 'R', 'G'],
      description: 'Cycle large creatures then cascade into Living End for a mass reanimation.',
      queries: [
        'f:modern ci:brg o:cycling t:creature cmc>=5',
        'f:modern ci:brg o:cascade cmc<=3',
      ],
    },
    {
      id: 'scryfall-mod-amulet-titan',
      name: 'Amulet Titan',
      strategy: 'ramp',
      colors: ['G', 'U', 'R', 'W'],
      description: 'Amulet of Vigor plus bounce lands to ramp into Primeval Titan quickly.',
      queries: [
        'f:modern (o:"enters the battlefield tapped" OR o:"untap") t:land',
        'f:modern ci:g t:creature cmc>=6 (o:"search your library" OR o:"when ~ enters")',
      ],
    },
  ],

  pioneer: [
    {
      id: 'scryfall-pio-rakdos-midrange',
      name: 'Rakdos Midrange',
      strategy: 'midrange',
      colors: ['B', 'R'],
      description: 'Efficient discard, removal, and threats across two colours.',
      queries: [
        'f:pioneer ci:br t:creature (r:rare OR r:mythic) cmc<=4',
        'f:pioneer ci:br (t:instant OR t:sorcery) (o:discard OR o:destroy OR o:exile) cmc<=3',
      ],
    },
    {
      id: 'scryfall-pio-lotus-combo',
      name: 'Lotus Field Combo',
      strategy: 'combo',
      colors: ['U', 'G'],
      description: 'Untap Lotus Field repeatedly to generate massive mana and combo off.',
      queries: [
        'f:pioneer (o:"lotus field" OR o:"untap target land" OR o:underworld-breach)',
        'f:pioneer ci:ug (o:scry OR o:draw) (t:instant OR t:sorcery) cmc<=2',
      ],
    },
    {
      id: 'scryfall-pio-mono-green-devotion',
      name: 'Mono Green Devotion',
      strategy: 'ramp',
      colors: ['G'],
      description: 'Build devotion to green and generate enormous mana with Nykthos.',
      queries: [
        'f:pioneer ci:g t:creature (o:devotion OR (cmc<=3 r:rare))',
        'f:pioneer ci:g (o:nykthos OR o:"add G" OR o:"add {G}") t:land',
      ],
    },
    {
      id: 'scryfall-pio-azorius-control',
      name: 'Azorius Control',
      strategy: 'control',
      colors: ['W', 'U'],
      description: 'Sweepers, counterspells, and planeswalkers to answer everything.',
      queries: [
        'f:pioneer ci:wu (t:instant OR t:sorcery) (o:counter OR o:"destroy all" OR o:exile) (r:rare OR r:uncommon)',
        'f:pioneer ci:wu t:planeswalker (r:rare OR r:mythic)',
      ],
    },
    {
      id: 'scryfall-pio-spirits',
      name: 'Azorius Spirits',
      strategy: 'aggro',
      colors: ['W', 'U'],
      description: 'Flash and flying spirits with disruptive ETB abilities.',
      queries: [
        'f:pioneer ci:wu t:spirit (o:flash OR o:flying OR o:counter) cmc<=3',
        'f:pioneer ci:wu t:creature o:flash (r:rare OR r:uncommon)',
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

/**
 * fetchScryfallArchetypeDecks
 * Builds a pool of archetype decklists using Scryfall search results.
 *
 * @param {string} format  "standard" | "modern" | "pioneer"
 * @returns {Promise<Array>} Deck objects ready for deckSuggestions scoring pipeline
 */
export async function fetchScryfallArchetypeDecks(format) {
  const archetypes = ARCHETYPES[format];
  if (!archetypes) return [];

  const results = [];

  for (const archetype of archetypes) {
    try {
      const cardMap = new Map(); // name → card for dedup

      for (const query of archetype.queries) {
        const data = await searchCards(query);
        for (const card of data?.data ?? []) {
          if (!cardMap.has(card.name)) {
            cardMap.set(card.name, card);
          }
          if (cardMap.size >= 30) break; // cap at ~30 non-land cards
        }
      }

      if (cardMap.size < 4) continue; // skip if Scryfall returned almost nothing

      const keyCards = [...cardMap.values()].map((card) => ({
        name: card.name,
        quantity: guessQuantity(card, archetype.strategy),
        section: card.type_line?.toLowerCase().includes('land') ? 'land' : 'mainboard',
      }));

      results.push({
        id: archetype.id,
        name: archetype.name,
        source: 'Scryfall',
        format,
        strategy: archetype.strategy,
        colors: archetype.colors,
        description: archetype.description,
        keyCards,
      });
    } catch (err) {
      console.warn(`[scryfallSource] Failed to build archetype "${archetype.name}":`, err);
    }
  }

  return results;
}

/**
 * Heuristic quantity assignment based on rarity and strategy.
 * Real deck data from MTGGoldfish will supersede this once the proxy is live.
 */
function guessQuantity(card, strategy) {
  if (card.type_line?.toLowerCase().includes('land')) return 2;
  if (card.rarity === 'mythic') return 2;
  if (card.rarity === 'rare') return strategy === 'aggro' ? 4 : 3;
  if (card.rarity === 'uncommon') return strategy === 'aggro' ? 4 : 2;
  return 4; // commons go in as 4-ofs
}
