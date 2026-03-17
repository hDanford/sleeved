// src/utils/deckSources/scryfallSource.js
// Builds proper 60-card metagame archetypes using Scryfall search queries.
// Used as a fallback for Standard / Modern / Pioneer until MTGGoldfish proxy is live.
//
// Each archetype fires three targeted queries (creatures, spells, lands) and
// fills hard slot targets to hit exactly 60 cards, matching real deck structure.

import { searchCards } from '../scryfallApi';

const SLEEP_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Slot targets by strategy — must sum to exactly 60
// ---------------------------------------------------------------------------
const SLOT_TARGETS = {
  aggro:    { creature: 24, spell: 12, land: 24 },
  midrange: { creature: 20, spell: 16, land: 24 },
  control:  { creature:  6, spell: 30, land: 24 },
  combo:    { creature: 16, spell: 20, land: 24 },
  ramp:     { creature: 14, spell: 18, land: 28 },
  tempo:    { creature: 20, spell: 16, land: 24 },
  tribal:   { creature: 26, spell: 10, land: 24 },
};

const BASIC_LANDS = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

// ---------------------------------------------------------------------------
// Archetype definitions
// Each entry has three query fields:
//   creatureQuery — Scryfall query for the creature base
//   spellQuery    — Scryfall query for instants, sorceries, enchantments, PW, artifacts
//   landQuery     — Scryfall query for non-basic lands (basics filled in automatically)
// ---------------------------------------------------------------------------
const ARCHETYPES = {
  standard: [
    {
      id: 'scryfall-std-domain-ramp',
      name: 'Domain Ramp',
      strategy: 'ramp',
      colors: ['W', 'U', 'B', 'R', 'G'],
      description: 'Assemble all basic land types and unleash powerful domain spells.',
      creatureQuery: 'f:standard t:creature (o:domain OR o:"basic land types" OR o:"domain —") order:edhrec',
      spellQuery:    'f:standard (t:instant OR t:sorcery OR t:enchantment) (o:domain OR o:"search your library" OR o:cultivate) order:edhrec',
      landQuery:     'f:standard t:land -t:basic (o:"search your library" OR o:"enters tapped" OR o:triome) order:edhrec',
    },
    {
      id: 'scryfall-std-esper-midrange',
      name: 'Esper Midrange',
      strategy: 'midrange',
      colors: ['W', 'U', 'B'],
      description: 'Efficient threats backed by counterspells and removal.',
      creatureQuery: 'f:standard ci:wub t:creature (r:rare OR r:mythic) cmc<=4 order:edhrec',
      spellQuery:    'f:standard ci:wub (t:instant OR t:sorcery OR t:planeswalker) (o:counter OR o:destroy OR o:exile) order:edhrec',
      landQuery:     'f:standard ci:wub t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-mono-red-aggro',
      name: 'Mono Red Aggro',
      strategy: 'aggro',
      colors: ['R'],
      description: 'Cheap burn and haste threats to end games fast.',
      creatureQuery: 'f:standard ci:r t:creature cmc<=2 (o:haste OR o:"deals damage" OR o:"first strike") order:edhrec',
      spellQuery:    'f:standard ci:r (t:instant OR t:sorcery) (o:"deals" OR o:damage OR o:burn) cmc<=3 order:edhrec',
      landQuery:     'f:standard ci:r t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-azorius-soldiers',
      name: 'Azorius Soldiers',
      strategy: 'aggro',
      colors: ['W', 'U'],
      description: 'Tribal soldiers with lords and anthem effects.',
      creatureQuery: 'f:standard ci:wu t:soldier order:edhrec',
      spellQuery:    'f:standard ci:wu (t:instant OR t:sorcery OR t:enchantment) (o:soldier OR o:counter OR o:exile) order:edhrec',
      landQuery:     'f:standard ci:wu t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-golgari-midrange',
      name: 'Golgari Midrange',
      strategy: 'midrange',
      colors: ['B', 'G'],
      description: 'Value-packed threats with hand disruption and graveyard synergy.',
      creatureQuery: 'f:standard ci:bg t:creature (o:graveyard OR o:dies OR o:"enters") (r:rare OR r:mythic) order:edhrec',
      spellQuery:    'f:standard ci:bg (t:instant OR t:sorcery OR t:enchantment) (o:discard OR o:destroy OR o:exile) order:edhrec',
      landQuery:     'f:standard ci:bg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-izzet-control',
      name: 'Izzet Control',
      strategy: 'control',
      colors: ['U', 'R'],
      description: 'Cheap interaction and card advantage finishing with big threats.',
      creatureQuery: 'f:standard ci:ur t:creature (o:prowess OR o:flash OR o:draw) cmc<=4 order:edhrec',
      spellQuery:    'f:standard ci:ur (t:instant OR t:sorcery) (o:counter OR o:deal OR o:draw) order:edhrec',
      landQuery:     'f:standard ci:ur t:land -t:basic order:edhrec',
    },
  ],

  modern: [
    {
      id: 'scryfall-mod-yawgmoth',
      name: 'Yawgmoth Combo',
      strategy: 'combo',
      colors: ['B', 'G'],
      description: 'Undying creatures plus Yawgmoth for infinite value loops.',
      creatureQuery: 'f:modern ci:bg t:creature (o:undying OR o:"enters with" OR o:"a +1/+1 counter") order:edhrec',
      spellQuery:    'f:modern ci:bg (t:instant OR t:sorcery OR t:enchantment) (o:"pay 1 life" OR o:proliferate OR o:tutor) order:edhrec',
      landQuery:     'f:modern ci:bg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-izzet-murktide',
      name: 'Izzet Murktide',
      strategy: 'tempo',
      colors: ['U', 'R'],
      description: 'Cheap spells and Murktide Regent for a tempo-control hybrid.',
      creatureQuery: 'f:modern ci:ur t:creature (o:delve OR o:prowess OR o:phyrexian) order:edhrec',
      spellQuery:    'f:modern ci:ur (t:instant OR t:sorcery) cmc<=2 order:edhrec',
      landQuery:     'f:modern ci:ur t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-burn',
      name: 'Burn',
      strategy: 'aggro',
      colors: ['R'],
      description: 'Maximum direct damage spells to race the opponent to zero.',
      creatureQuery: 'f:modern ci:r t:creature cmc<=2 (o:haste OR o:"first strike" OR o:"deals damage") order:edhrec',
      spellQuery:    'f:modern ci:r (t:instant OR t:sorcery) o:"deals" cmc<=2 order:edhrec',
      landQuery:     'f:modern ci:r t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-living-end',
      name: 'Living End',
      strategy: 'combo',
      colors: ['B', 'R', 'G'],
      description: 'Cycle large creatures then cascade into Living End for a mass reanimation.',
      creatureQuery: 'f:modern ci:brg t:creature (o:cycling OR o:cascade) order:edhrec',
      spellQuery:    'f:modern ci:brg (o:cascade OR o:cycling OR o:suspend) cmc<=3 order:edhrec',
      landQuery:     'f:modern ci:brg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-amulet-titan',
      name: 'Amulet Titan',
      strategy: 'ramp',
      colors: ['G', 'U', 'R', 'W'],
      description: 'Amulet of Vigor plus bounce lands to ramp into Primeval Titan quickly.',
      creatureQuery: 'f:modern ci:g t:creature cmc>=5 (o:"search your library" OR o:"when ~ enters") order:edhrec',
      spellQuery:    'f:modern ci:g (t:artifact OR t:enchantment OR t:sorcery) (o:amulet OR o:land OR o:bounce) order:edhrec',
      landQuery:     'f:modern t:land (o:"enters the battlefield tapped" OR o:"bounces" OR o:"untap") -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-rhinos',
      name: 'Temur Rhinos',
      strategy: 'combo',
      colors: ['U', 'R', 'G'],
      description: 'Cascade into Crashing Footfalls to ambush with 4/4 rhino tokens.',
      creatureQuery: 'f:modern ci:urg t:creature (o:cascade OR o:suspend OR o:flash) order:edhrec',
      spellQuery:    'f:modern ci:urg (o:cascade OR o:"crashing footfalls" OR o:suspend) order:edhrec',
      landQuery:     'f:modern ci:urg t:land -t:basic order:edhrec',
    },
  ],

  pioneer: [
    {
      id: 'scryfall-pio-rakdos-midrange',
      name: 'Rakdos Midrange',
      strategy: 'midrange',
      colors: ['B', 'R'],
      description: 'Efficient discard, removal, and threats across two colours.',
      creatureQuery: 'f:pioneer ci:br t:creature (r:rare OR r:mythic) cmc<=4 order:edhrec',
      spellQuery:    'f:pioneer ci:br (t:instant OR t:sorcery OR t:planeswalker) (o:discard OR o:destroy OR o:exile) order:edhrec',
      landQuery:     'f:pioneer ci:br t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-lotus-combo',
      name: 'Lotus Field Combo',
      strategy: 'combo',
      colors: ['U', 'G'],
      description: 'Untap Lotus Field repeatedly to generate massive mana and combo off.',
      creatureQuery: 'f:pioneer ci:ug t:creature (o:scry OR o:draw OR o:tap) cmc<=3 order:edhrec',
      spellQuery:    'f:pioneer ci:ug (t:instant OR t:sorcery OR t:enchantment) (o:"lotus field" OR o:"untap target" OR o:draw) order:edhrec',
      landQuery:     'f:pioneer t:land (o:"lotus field" OR o:"enters tapped") -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-mono-green-devotion',
      name: 'Mono Green Devotion',
      strategy: 'ramp',
      colors: ['G'],
      description: 'Build devotion to green and generate enormous mana with Nykthos.',
      creatureQuery: 'f:pioneer ci:g t:creature (o:devotion OR cmc<=3) (r:rare OR r:uncommon) order:edhrec',
      spellQuery:    'f:pioneer ci:g (t:instant OR t:sorcery OR t:enchantment OR t:planeswalker) order:edhrec',
      landQuery:     'f:pioneer ci:g t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-azorius-control',
      name: 'Azorius Control',
      strategy: 'control',
      colors: ['W', 'U'],
      description: 'Sweepers, counterspells, and planeswalkers to answer everything.',
      creatureQuery: 'f:pioneer ci:wu t:creature (o:flash OR o:"when ~ enters") (r:rare OR r:mythic) order:edhrec',
      spellQuery:    'f:pioneer ci:wu (t:instant OR t:sorcery OR t:planeswalker) (o:counter OR o:"destroy all" OR o:exile) order:edhrec',
      landQuery:     'f:pioneer ci:wu t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-spirits',
      name: 'Azorius Spirits',
      strategy: 'aggro',
      colors: ['W', 'U'],
      description: 'Flash and flying spirits with disruptive ETB abilities.',
      creatureQuery: 'f:pioneer ci:wu t:spirit cmc<=3 order:edhrec',
      spellQuery:    'f:pioneer ci:wu (t:instant OR t:sorcery OR t:enchantment) (o:counter OR o:exile OR o:spirit) order:edhrec',
      landQuery:     'f:pioneer ci:wu t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-gruul-aggro',
      name: 'Gruul Aggro',
      strategy: 'aggro',
      colors: ['R', 'G'],
      description: 'Efficient threats and pump spells for an unstoppable beatdown.',
      creatureQuery: 'f:pioneer ci:rg t:creature cmc<=3 (o:haste OR o:trample OR o:"enters with") order:edhrec',
      spellQuery:    'f:pioneer ci:rg (t:instant OR t:sorcery) (o:damage OR o:fight OR o:pump) order:edhrec',
      landQuery:     'f:pioneer ci:rg t:land -t:basic order:edhrec',
    },
  ],
};

// ---------------------------------------------------------------------------
// Deck builder
// ---------------------------------------------------------------------------

/**
 * Build a proper 60-card deck from Scryfall query results.
 * Fires three queries (creatures, spells, lands) and fills slots to hit exactly 60.
 */
async function build60CardDeck(archetype) {
  const targets = SLOT_TARGETS[archetype.strategy] ?? SLOT_TARGETS.midrange;
  const seen = new Set();

  // ── Fetch creatures ────────────────────────────────────────────────────────
  const creaturePool = [];
  try {
    const res = await searchCards(archetype.creatureQuery);
    for (const card of res?.data ?? []) {
      if (!seen.has(card.name) && card.type_line?.toLowerCase().includes('creature')) {
        seen.add(card.name);
        creaturePool.push(card);
      }
    }
  } catch { /* skip */ }
  await sleep(SLEEP_MS);

  // ── Fetch spells ───────────────────────────────────────────────────────────
  const spellPool = [];
  try {
    const res = await searchCards(archetype.spellQuery);
    for (const card of res?.data ?? []) {
      if (!seen.has(card.name) && !card.type_line?.toLowerCase().includes('land')) {
        seen.add(card.name);
        spellPool.push(card);
      }
    }
  } catch { /* skip */ }
  await sleep(SLEEP_MS);

  // ── Fetch non-basic lands ──────────────────────────────────────────────────
  const nonBasicLandPool = [];
  try {
    const res = await searchCards(archetype.landQuery);
    for (const card of res?.data ?? []) {
      if (!seen.has(card.name)) {
        seen.add(card.name);
        nonBasicLandPool.push(card);
      }
    }
  } catch { /* skip */ }
  await sleep(SLEEP_MS);

  // ── Fill creature slots ────────────────────────────────────────────────────
  const keyCards = [];
  let creaturesFilled = 0;

  for (const card of creaturePool) {
    if (creaturesFilled >= targets.creature) break;
    const qty = guessQuantity(card, archetype.strategy);
    const slots = Math.min(qty, targets.creature - creaturesFilled);
    keyCards.push({ name: card.name, quantity: slots, section: 'mainboard' });
    creaturesFilled += slots;
  }

  // ── Fill spell slots ───────────────────────────────────────────────────────
  let spellsFilled = 0;

  for (const card of spellPool) {
    if (spellsFilled >= targets.spell) break;
    // Avoid double-counting creatures that slipped into spell pool
    if (card.type_line?.toLowerCase().includes('creature')) continue;
    const qty = guessQuantity(card, archetype.strategy);
    const slots = Math.min(qty, targets.spell - spellsFilled);
    keyCards.push({ name: card.name, quantity: slots, section: 'mainboard' });
    spellsFilled += slots;
  }

  // ── Fill land slots ────────────────────────────────────────────────────────
  // Use up to half land slots for non-basics, rest basics
  const nonBasicTarget = Math.min(nonBasicLandPool.length, Math.floor(targets.land / 2));
  let nonBasicFilled = 0;

  for (const card of nonBasicLandPool) {
    if (nonBasicFilled >= nonBasicTarget) break;
    keyCards.push({ name: card.name, quantity: 1, section: 'land' });
    nonBasicFilled++;
  }

  const basicsNeeded = targets.land - nonBasicFilled;
  const colors = archetype.colors.filter((c) => BASIC_LANDS[c]);

  if (colors.length === 0) {
    keyCards.push({ name: 'Wastes', quantity: basicsNeeded, section: 'land' });
  } else {
    const perColor = Math.floor(basicsNeeded / colors.length);
    const remainder = basicsNeeded % colors.length;
    colors.forEach((c, i) => {
      const count = perColor + (i < remainder ? 1 : 0);
      if (count > 0) keyCards.push({ name: BASIC_LANDS[c], quantity: count, section: 'land' });
    });
  }

  // ── Hard-cap at 60 ─────────────────────────────────────────────────────────
  // Sum quantities and trim from the end if we somehow went over
  let total = keyCards.reduce((s, c) => s + c.quantity, 0);
  while (total > 60 && keyCards.length > 0) {
    const last = keyCards[keyCards.length - 1];
    if (last.quantity > 1) {
      last.quantity--;
    } else {
      keyCards.pop();
    }
    total--;
  }

  return keyCards;
}

function guessQuantity(card, strategy) {
  if (card.rarity === 'mythic') return 2;
  if (card.rarity === 'rare')   return strategy === 'aggro' ? 4 : 3;
  if (card.rarity === 'uncommon') return strategy === 'aggro' ? 4 : 2;
  return 4; // commons go as 4-ofs
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * fetchScryfallArchetypeDecks
 * Builds proper 60-card decks for each archetype in the given format.
 *
 * @param {string} format  "standard" | "modern" | "pioneer"
 * @returns {Promise<Array>} Deck objects
 */
export async function fetchScryfallArchetypeDecks(format) {
  const archetypes = ARCHETYPES[format];
  if (!archetypes) return [];

  const results = [];

  for (const archetype of archetypes) {
    try {
      const keyCards = await build60CardDeck(archetype);
      if (keyCards.length < 10) continue; // skip if Scryfall returned almost nothing

      results.push({
        id:          archetype.id,
        name:        archetype.name,
        source:      'Scryfall',
        format,
        strategy:    archetype.strategy,
        colors:      archetype.colors,
        description: archetype.description,
        keyCards,
        swapIns:     [], // non-commander formats don't have a bench list
      });
    } catch (err) {
      console.warn(`[scryfallSource] Failed to build archetype "${archetype.name}":`, err);
    }
  }

  return results;
}
