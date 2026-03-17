// src/utils/deckSources/scryfallSource.js
// Builds proper 60-card metagame archetypes using Scryfall search queries.
// Used as a fallback for Standard / Modern / Pioneer until a real sync runs.
//
// Each archetype fires three targeted queries (creatures, spells, lands) and
// fills hard slot targets so the total hits exactly 60 cards.

import { searchCards } from '../scryfallApi';

const SLEEP_MS = 110;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Slot targets by strategy — must always sum to 60
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
// Archetypes — 15–16 per format
// ---------------------------------------------------------------------------

const ARCHETYPES = {

  // ── STANDARD (16 archetypes) ─────────────────────────────────────────────
  standard: [
    {
      id: 'scryfall-std-domain-ramp', name: 'Domain Ramp', strategy: 'ramp', colors: ['W','U','B','R','G'],
      description: 'Assemble all basic land types and unleash powerful domain spells.',
      creatureQuery: 'f:standard t:creature (o:domain OR o:"basic land types") order:edhrec',
      spellQuery:    'f:standard (t:instant OR t:sorcery OR t:enchantment) (o:domain OR o:cultivate OR o:"search your library") order:edhrec',
      landQuery:     'f:standard t:land -t:basic (o:triome OR o:"enters tapped" OR o:"search your library") order:edhrec',
    },
    {
      id: 'scryfall-std-esper-midrange', name: 'Esper Midrange', strategy: 'midrange', colors: ['W','U','B'],
      description: 'Efficient threats backed by counterspells and removal.',
      creatureQuery: 'f:standard ci:wub t:creature (r:rare OR r:mythic) cmc<=4 order:edhrec',
      spellQuery:    'f:standard ci:wub (t:instant OR t:sorcery OR t:planeswalker) (o:counter OR o:destroy OR o:exile) order:edhrec',
      landQuery:     'f:standard ci:wub t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-mono-red-aggro', name: 'Mono Red Aggro', strategy: 'aggro', colors: ['R'],
      description: 'Cheap burn and haste threats to end games fast.',
      creatureQuery: 'f:standard ci:r t:creature cmc<=2 (o:haste OR o:"first strike") order:edhrec',
      spellQuery:    'f:standard ci:r (t:instant OR t:sorcery) o:damage cmc<=3 order:edhrec',
      landQuery:     'f:standard ci:r t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-azorius-soldiers', name: 'Azorius Soldiers', strategy: 'aggro', colors: ['W','U'],
      description: 'Tribal soldiers with lords and anthem effects.',
      creatureQuery: 'f:standard ci:wu t:soldier order:edhrec',
      spellQuery:    'f:standard ci:wu (t:instant OR t:sorcery OR t:enchantment) (o:soldier OR o:counter OR o:exile) order:edhrec',
      landQuery:     'f:standard ci:wu t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-golgari-midrange', name: 'Golgari Midrange', strategy: 'midrange', colors: ['B','G'],
      description: 'Value-packed threats with hand disruption and graveyard synergy.',
      creatureQuery: 'f:standard ci:bg t:creature (o:graveyard OR o:dies) (r:rare OR r:mythic) order:edhrec',
      spellQuery:    'f:standard ci:bg (t:instant OR t:sorcery) (o:discard OR o:destroy OR o:exile) order:edhrec',
      landQuery:     'f:standard ci:bg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-izzet-control', name: 'Izzet Control', strategy: 'control', colors: ['U','R'],
      description: 'Cheap interaction and card advantage finishing with big threats.',
      creatureQuery: 'f:standard ci:ur t:creature (o:prowess OR o:flash OR o:draw) cmc<=4 order:edhrec',
      spellQuery:    'f:standard ci:ur (t:instant OR t:sorcery) (o:counter OR o:damage OR o:draw) order:edhrec',
      landQuery:     'f:standard ci:ur t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-selesnya-tokens', name: 'Selesnya Tokens', strategy: 'aggro', colors: ['W','G'],
      description: 'Flood the board with tokens and buff them to lethal.',
      creatureQuery: 'f:standard ci:wg t:creature (o:token OR o:"create" OR o:convoke) order:edhrec',
      spellQuery:    'f:standard ci:wg (t:instant OR t:sorcery OR t:enchantment) (o:token OR o:"create" OR o:populate) order:edhrec',
      landQuery:     'f:standard ci:wg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-rakdos-aggro', name: 'Rakdos Aggro', strategy: 'aggro', colors: ['B','R'],
      description: 'Fast discard-fuelled aggression with menace and haste.',
      creatureQuery: 'f:standard ci:br t:creature cmc<=3 (o:haste OR o:menace OR o:"when ~ dies") order:edhrec',
      spellQuery:    'f:standard ci:br (t:instant OR t:sorcery) (o:discard OR o:damage OR o:destroy) cmc<=3 order:edhrec',
      landQuery:     'f:standard ci:br t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-dimir-control', name: 'Dimir Control', strategy: 'control', colors: ['U','B'],
      description: 'Counter, draw, and remove anything until you land a finisher.',
      creatureQuery: 'f:standard ci:ub t:creature (o:flash OR o:"when ~ enters" OR o:draw) (r:rare OR r:mythic) order:edhrec',
      spellQuery:    'f:standard ci:ub (t:instant OR t:sorcery) (o:counter OR o:destroy OR o:draw OR o:discard) order:edhrec',
      landQuery:     'f:standard ci:ub t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-gruul-stompy', name: 'Gruul Stompy', strategy: 'midrange', colors: ['R','G'],
      description: 'Ramp into oversized trample threats and run opponents over.',
      creatureQuery: 'f:standard ci:rg t:creature (o:trample OR o:haste OR cmc>=4) order:edhrec',
      spellQuery:    'f:standard ci:rg (t:instant OR t:sorcery OR t:enchantment) (o:land OR o:fight OR o:damage) order:edhrec',
      landQuery:     'f:standard ci:rg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-boros-heroic', name: 'Boros Heroic', strategy: 'aggro', colors: ['W','R'],
      description: 'Trigger heroic with cheap spells and swing for large damage.',
      creatureQuery: 'f:standard ci:wr t:creature (o:heroic OR o:"whenever you cast" OR cmc<=2) order:edhrec',
      spellQuery:    'f:standard ci:wr (t:instant OR t:sorcery) (o:"target creature" OR o:pump OR o:damage) cmc<=2 order:edhrec',
      landQuery:     'f:standard ci:wr t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-simic-ramp', name: 'Simic Ramp', strategy: 'ramp', colors: ['U','G'],
      description: 'Accelerate mana and deploy oversized threats backed by counterspells.',
      creatureQuery: 'f:standard ci:ug t:creature (o:"add {" OR cmc>=5 OR o:draw) order:edhrec',
      spellQuery:    'f:standard ci:ug (t:instant OR t:sorcery OR t:enchantment) (o:draw OR o:counter OR o:land OR o:ramp) order:edhrec',
      landQuery:     'f:standard ci:ug t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-mono-white-aggro', name: 'Mono White Aggro', strategy: 'aggro', colors: ['W'],
      description: 'Wide board of small efficient creatures backed by anthems.',
      creatureQuery: 'f:standard ci:w t:creature cmc<=3 (o:lifelink OR o:"first strike" OR o:vigilance) order:edhrec',
      spellQuery:    'f:standard ci:w (t:instant OR t:sorcery OR t:enchantment) (o:exile OR o:"gets +" OR o:token) order:edhrec',
      landQuery:     'f:standard ci:w t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-orzhov-lifegain', name: 'Orzhov Lifegain', strategy: 'midrange', colors: ['W','B'],
      description: 'Gain life for value and drain the opponent with lifegain triggers.',
      creatureQuery: 'f:standard ci:wb t:creature (o:lifelink OR o:"whenever you gain" OR o:drain) order:edhrec',
      spellQuery:    'f:standard ci:wb (t:instant OR t:sorcery OR t:enchantment) (o:lifelink OR o:drain OR o:destroy) order:edhrec',
      landQuery:     'f:standard ci:wb t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-sultai-graveyard', name: 'Sultai Graveyard', strategy: 'midrange', colors: ['U','B','G'],
      description: 'Self-mill into powerful graveyard recursion engines.',
      creatureQuery: 'f:standard ci:ubg t:creature (o:graveyard OR o:dies OR o:mill) (r:rare OR r:mythic) order:edhrec',
      spellQuery:    'f:standard ci:ubg (t:instant OR t:sorcery OR t:enchantment) (o:mill OR o:graveyard OR o:return) order:edhrec',
      landQuery:     'f:standard ci:ubg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-std-mono-black-midrange', name: 'Mono Black Midrange', strategy: 'midrange', colors: ['B'],
      description: 'Discard, removal and powerful black threats.',
      creatureQuery: 'f:standard ci:b t:creature (r:rare OR r:mythic) cmc<=5 order:edhrec',
      spellQuery:    'f:standard ci:b (t:instant OR t:sorcery) (o:discard OR o:destroy OR o:exile OR o:"pay life") order:edhrec',
      landQuery:     'f:standard ci:b t:land -t:basic order:edhrec',
    },
  ],

  // ── MODERN (16 archetypes) ───────────────────────────────────────────────
  modern: [
    {
      id: 'scryfall-mod-yawgmoth', name: 'Yawgmoth Combo', strategy: 'combo', colors: ['B','G'],
      description: 'Undying creatures plus Yawgmoth for infinite value loops.',
      creatureQuery: 'f:modern ci:bg t:creature (o:undying OR o:"enters with" OR o:"a +1/+1 counter") order:edhrec',
      spellQuery:    'f:modern ci:bg (t:instant OR t:sorcery OR t:enchantment) (o:proliferate OR o:tutor OR o:"pay 1 life") order:edhrec',
      landQuery:     'f:modern ci:bg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-izzet-murktide', name: 'Izzet Murktide', strategy: 'tempo', colors: ['U','R'],
      description: 'Cheap spells and Murktide Regent for a tempo-control hybrid.',
      creatureQuery: 'f:modern ci:ur t:creature (o:delve OR o:prowess) order:edhrec',
      spellQuery:    'f:modern ci:ur (t:instant OR t:sorcery) cmc<=2 order:edhrec',
      landQuery:     'f:modern ci:ur t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-burn', name: 'Burn', strategy: 'aggro', colors: ['R'],
      description: 'Maximum direct damage spells to race the opponent to zero.',
      creatureQuery: 'f:modern ci:r t:creature cmc<=2 (o:haste OR o:"first strike") order:edhrec',
      spellQuery:    'f:modern ci:r (t:instant OR t:sorcery) o:damage cmc<=2 order:edhrec',
      landQuery:     'f:modern ci:r t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-living-end', name: 'Living End', strategy: 'combo', colors: ['B','R','G'],
      description: 'Cycle large creatures then cascade into Living End.',
      creatureQuery: 'f:modern ci:brg t:creature (o:cycling OR o:cascade) order:edhrec',
      spellQuery:    'f:modern ci:brg (o:cascade OR o:cycling OR o:suspend) cmc<=3 order:edhrec',
      landQuery:     'f:modern ci:brg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-amulet-titan', name: 'Amulet Titan', strategy: 'ramp', colors: ['G','U','R','W'],
      description: 'Amulet of Vigor plus bounce lands to ramp into Primeval Titan.',
      creatureQuery: 'f:modern ci:g t:creature cmc>=5 (o:"search your library" OR o:"when ~ enters") order:edhrec',
      spellQuery:    'f:modern (t:artifact OR t:enchantment OR t:sorcery) (o:amulet OR o:land OR o:bounce) order:edhrec',
      landQuery:     'f:modern t:land (o:"enters the battlefield tapped" OR o:"untap") -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-rhinos', name: 'Temur Rhinos', strategy: 'combo', colors: ['U','R','G'],
      description: 'Cascade into Crashing Footfalls for 4/4 rhino tokens.',
      creatureQuery: 'f:modern ci:urg t:creature (o:cascade OR o:flash) order:edhrec',
      spellQuery:    'f:modern ci:urg (o:cascade OR o:"crashing footfalls" OR o:suspend) order:edhrec',
      landQuery:     'f:modern ci:urg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-jund-midrange', name: 'Jund Midrange', strategy: 'midrange', colors: ['B','R','G'],
      description: 'Discard, removal, and value-engine threats.',
      creatureQuery: 'f:modern ci:brg t:creature (r:rare OR r:mythic) cmc<=4 order:edhrec',
      spellQuery:    'f:modern ci:brg (t:instant OR t:sorcery) (o:discard OR o:destroy OR o:draw) order:edhrec',
      landQuery:     'f:modern ci:brg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-affinity', name: 'Affinity / Hardened Scales', strategy: 'aggro', colors: ['W','G'],
      description: 'Artifacts and modular creatures for explosive starts.',
      creatureQuery: 'f:modern t:creature (o:modular OR o:affinity OR o:"enters with" OR t:artifact) order:edhrec',
      spellQuery:    'f:modern (t:artifact OR t:sorcery OR t:instant) (o:modular OR o:proliferate OR o:counter) order:edhrec',
      landQuery:     'f:modern t:land (o:artifact OR o:"enters tapped") -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-dimir-control', name: 'Dimir Control', strategy: 'control', colors: ['U','B'],
      description: 'Counter everything, draw cards, finish with big threats.',
      creatureQuery: 'f:modern ci:ub t:creature (o:flash OR o:draw) (r:rare OR r:mythic) order:edhrec',
      spellQuery:    'f:modern ci:ub (t:instant OR t:sorcery) (o:counter OR o:destroy OR o:draw OR o:discard) order:edhrec',
      landQuery:     'f:modern ci:ub t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-gruul-aggro', name: 'Gruul Aggro', strategy: 'aggro', colors: ['R','G'],
      description: 'Fast threats with haste and trample to punch through.',
      creatureQuery: 'f:modern ci:rg t:creature cmc<=3 (o:haste OR o:trample OR o:"enters with") order:edhrec',
      spellQuery:    'f:modern ci:rg (t:instant OR t:sorcery) (o:damage OR o:fight OR o:"gets +") cmc<=3 order:edhrec',
      landQuery:     'f:modern ci:rg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-tron', name: 'Mono Green Tron', strategy: 'ramp', colors: ['G'],
      description: 'Assemble Urza lands for massive mana and game-ending threats.',
      creatureQuery: 'f:modern ci:g t:creature (cmc>=6 OR o:trample OR o:"search your library") order:edhrec',
      spellQuery:    'f:modern ci:g (t:sorcery OR t:instant OR t:artifact) (o:"urza" OR o:land OR o:scry OR o:draw) order:edhrec',
      landQuery:     'f:modern t:land (o:"urza" OR o:"add colorless" OR o:"search your library") -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-humans', name: 'Humans', strategy: 'aggro', colors: ['W','U','R','G','B'],
      description: 'Five-colour humans with lords disrupting the opponent.',
      creatureQuery: 'f:modern t:human (o:human OR o:"nonhuman" OR cmc<=3) order:edhrec',
      spellQuery:    'f:modern (t:instant OR t:sorcery OR t:enchantment) (o:human OR o:counter OR o:exile) cmc<=3 order:edhrec',
      landQuery:     'f:modern t:land (o:"any color" OR o:shockland) -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-mill', name: 'Dimir Mill', strategy: 'control', colors: ['U','B'],
      description: 'Mill the opponent out with efficient mill spells and lock pieces.',
      creatureQuery: 'f:modern ci:ub t:creature (o:mill OR o:"put the top" OR o:surveil) order:edhrec',
      spellQuery:    'f:modern ci:ub (t:instant OR t:sorcery) (o:mill OR o:"put the top" OR o:counter) order:edhrec',
      landQuery:     'f:modern ci:ub t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-grixis-shadow', name: 'Grixis Death\'s Shadow', strategy: 'tempo', colors: ['U','B','R'],
      description: 'Pay life aggressively to make Death\'s Shadow huge.',
      creatureQuery: 'f:modern ci:ubr t:creature (o:"pay" OR o:"loses life" OR o:prowess) order:edhrec',
      spellQuery:    'f:modern ci:ubr (t:instant OR t:sorcery) (o:"pay life" OR o:discard OR o:counter) cmc<=2 order:edhrec',
      landQuery:     'f:modern ci:ubr t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-hammer-time', name: 'Hammer Time', strategy: 'combo', colors: ['W'],
      description: 'Equip Colossus Hammer for free and attack for lethal.',
      creatureQuery: 'f:modern ci:w t:creature (o:"equipped" OR o:"protection" OR cmc<=2) order:edhrec',
      spellQuery:    'f:modern (t:artifact OR t:instant OR t:sorcery) (o:equip OR o:"equipment" OR o:attach) cmc<=3 order:edhrec',
      landQuery:     'f:modern ci:w t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-mod-eldrazi-tron', name: 'Eldrazi Tron', strategy: 'ramp', colors: ['B','R'],
      description: 'Colourless Eldrazi enabled by Urza lands and wastes.',
      creatureQuery: 'f:modern t:eldrazi order:edhrec',
      spellQuery:    'f:modern (t:artifact OR t:sorcery OR t:instant) (o:colorless OR o:eldrazi OR o:scry) order:edhrec',
      landQuery:     'f:modern t:land (o:urza OR o:"add colorless") -t:basic order:edhrec',
    },
  ],

  // ── PIONEER (16 archetypes) ──────────────────────────────────────────────
  pioneer: [
    {
      id: 'scryfall-pio-rakdos-midrange', name: 'Rakdos Midrange', strategy: 'midrange', colors: ['B','R'],
      description: 'Efficient discard, removal, and threats.',
      creatureQuery: 'f:pioneer ci:br t:creature (r:rare OR r:mythic) cmc<=4 order:edhrec',
      spellQuery:    'f:pioneer ci:br (t:instant OR t:sorcery OR t:planeswalker) (o:discard OR o:destroy OR o:exile) order:edhrec',
      landQuery:     'f:pioneer ci:br t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-lotus-combo', name: 'Lotus Field Combo', strategy: 'combo', colors: ['U','G'],
      description: 'Untap Lotus Field repeatedly to generate massive mana and combo off.',
      creatureQuery: 'f:pioneer ci:ug t:creature (o:scry OR o:draw OR o:tap) cmc<=3 order:edhrec',
      spellQuery:    'f:pioneer ci:ug (t:instant OR t:sorcery OR t:enchantment) (o:"lotus field" OR o:"untap target" OR o:draw) order:edhrec',
      landQuery:     'f:pioneer t:land (o:"lotus field" OR o:"enters tapped") -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-mono-green-devotion', name: 'Mono Green Devotion', strategy: 'ramp', colors: ['G'],
      description: 'Build devotion to green and generate enormous mana with Nykthos.',
      creatureQuery: 'f:pioneer ci:g t:creature (o:devotion OR cmc<=3) (r:rare OR r:uncommon) order:edhrec',
      spellQuery:    'f:pioneer ci:g (t:instant OR t:sorcery OR t:enchantment OR t:planeswalker) order:edhrec',
      landQuery:     'f:pioneer ci:g t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-azorius-control', name: 'Azorius Control', strategy: 'control', colors: ['W','U'],
      description: 'Sweepers, counterspells, and planeswalkers to answer everything.',
      creatureQuery: 'f:pioneer ci:wu t:creature (o:flash OR o:"when ~ enters") (r:rare OR r:mythic) order:edhrec',
      spellQuery:    'f:pioneer ci:wu (t:instant OR t:sorcery OR t:planeswalker) (o:counter OR o:"destroy all" OR o:exile) order:edhrec',
      landQuery:     'f:pioneer ci:wu t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-spirits', name: 'Azorius Spirits', strategy: 'aggro', colors: ['W','U'],
      description: 'Flash and flying spirits with disruptive ETB abilities.',
      creatureQuery: 'f:pioneer ci:wu t:spirit cmc<=3 order:edhrec',
      spellQuery:    'f:pioneer ci:wu (t:instant OR t:sorcery OR t:enchantment) (o:counter OR o:exile OR o:spirit) order:edhrec',
      landQuery:     'f:pioneer ci:wu t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-gruul-aggro', name: 'Gruul Aggro', strategy: 'aggro', colors: ['R','G'],
      description: 'Efficient threats and pump spells for an unstoppable beatdown.',
      creatureQuery: 'f:pioneer ci:rg t:creature cmc<=3 (o:haste OR o:trample OR o:"enters with") order:edhrec',
      spellQuery:    'f:pioneer ci:rg (t:instant OR t:sorcery) (o:damage OR o:fight OR o:pump) order:edhrec',
      landQuery:     'f:pioneer ci:rg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-mono-red-aggro', name: 'Mono Red Aggro', strategy: 'aggro', colors: ['R'],
      description: 'Pure speed — burn and haste creatures to close fast.',
      creatureQuery: 'f:pioneer ci:r t:creature cmc<=2 (o:haste OR o:"first strike") order:edhrec',
      spellQuery:    'f:pioneer ci:r (t:instant OR t:sorcery) o:damage cmc<=3 order:edhrec',
      landQuery:     'f:pioneer ci:r t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-abzan-greasefang', name: 'Abzan Greasefang', strategy: 'combo', colors: ['W','B','G'],
      description: 'Discard Parhelion II and reanimate it with Greasefang.',
      creatureQuery: 'f:pioneer ci:wbg t:creature (o:greasefang OR o:discard OR o:reanimate OR o:"when ~ enters") order:edhrec',
      spellQuery:    'f:pioneer ci:wbg (t:instant OR t:sorcery OR t:enchantment) (o:discard OR o:graveyard OR o:reanimate) order:edhrec',
      landQuery:     'f:pioneer ci:wbg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-izzet-phoenix', name: 'Izzet Phoenix', strategy: 'midrange', colors: ['U','R'],
      description: 'Three spells in a turn to recur Arclight Phoenix.',
      creatureQuery: 'f:pioneer ci:ur t:creature (o:haste OR o:prowess OR o:phoenix) order:edhrec',
      spellQuery:    'f:pioneer ci:ur (t:instant OR t:sorcery) cmc<=2 order:edhrec',
      landQuery:     'f:pioneer ci:ur t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-dimir-rogues', name: 'Dimir Rogues', strategy: 'tempo', colors: ['U','B'],
      description: 'Mill and tempo with cheap unblockable rogues.',
      creatureQuery: 'f:pioneer ci:ub t:rogue order:edhrec',
      spellQuery:    'f:pioneer ci:ub (t:instant OR t:sorcery) (o:mill OR o:counter OR o:return) order:edhrec',
      landQuery:     'f:pioneer ci:ub t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-angels', name: 'Mono White Angels', strategy: 'midrange', colors: ['W'],
      description: 'Ramp into Angels and use their ETB effects to dominate the board.',
      creatureQuery: 'f:pioneer ci:w t:angel order:edhrec',
      spellQuery:    'f:pioneer ci:w (t:instant OR t:sorcery OR t:enchantment OR t:artifact) (o:lifelink OR o:angel OR o:exile) order:edhrec',
      landQuery:     'f:pioneer ci:w t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-selesnya-company', name: 'Selesnya Company', strategy: 'midrange', colors: ['W','G'],
      description: 'Collected Company to flash in creatures and build board presence.',
      creatureQuery: 'f:pioneer ci:wg t:creature cmc<=3 (r:rare OR r:uncommon) order:edhrec',
      spellQuery:    'f:pioneer ci:wg (t:instant OR t:sorcery OR t:enchantment) (o:company OR o:token OR o:counter) order:edhrec',
      landQuery:     'f:pioneer ci:wg t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-esper-greasefang', name: 'Esper Midrange', strategy: 'control', colors: ['W','U','B'],
      description: 'Best removal and card advantage across three colours.',
      creatureQuery: 'f:pioneer ci:wub t:creature (o:flash OR o:"when ~ enters") (r:rare OR r:mythic) order:edhrec',
      spellQuery:    'f:pioneer ci:wub (t:instant OR t:sorcery OR t:planeswalker) (o:counter OR o:exile OR o:discard OR o:draw) order:edhrec',
      landQuery:     'f:pioneer ci:wub t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-niv-mizzet', name: 'Niv-Mizzet Reborn', strategy: 'goodstuff', colors: ['W','U','B','R','G'],
      description: 'Five-colour goodstuff powered by Niv-Mizzet and dual-colour spells.',
      creatureQuery: 'f:pioneer t:creature (r:mythic OR r:rare) cmc<=5 order:edhrec',
      spellQuery:    'f:pioneer (t:instant OR t:sorcery) (r:rare OR r:uncommon) order:edhrec',
      landQuery:     'f:pioneer t:land (o:"any color" OR o:"two colors") -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-orzhov-humans', name: 'Orzhov Humans', strategy: 'aggro', colors: ['W','B'],
      description: 'Tribal humans with disruptive hand attack and removal.',
      creatureQuery: 'f:pioneer ci:wb t:human cmc<=3 order:edhrec',
      spellQuery:    'f:pioneer ci:wb (t:instant OR t:sorcery OR t:enchantment) (o:exile OR o:discard OR o:lifelink) order:edhrec',
      landQuery:     'f:pioneer ci:wb t:land -t:basic order:edhrec',
    },
    {
      id: 'scryfall-pio-boros-heroic', name: 'Boros Heroic', strategy: 'aggro', colors: ['W','R'],
      description: 'Target your heroic creatures to make them unstoppably large.',
      creatureQuery: 'f:pioneer ci:wr t:creature (o:heroic OR o:"whenever you cast a spell that targets") order:edhrec',
      spellQuery:    'f:pioneer ci:wr (t:instant OR t:sorcery) (o:"target creature" OR o:indestructible OR o:pump) cmc<=2 order:edhrec',
      landQuery:     'f:pioneer ci:wr t:land -t:basic order:edhrec',
    },
  ],
};

// ---------------------------------------------------------------------------
// Builder — fills slots to exactly 60
// ---------------------------------------------------------------------------

function guessQuantity(card, strategy) {
  if (card.rarity === 'mythic')    return 2;
  if (card.rarity === 'rare')      return strategy === 'aggro' ? 4 : 3;
  if (card.rarity === 'uncommon')  return strategy === 'aggro' ? 4 : 2;
  return 4;
}

async function build60CardDeck(archetype) {
  const targets = SLOT_TARGETS[archetype.strategy] ?? SLOT_TARGETS.midrange;
  const seen    = new Set();

  const fetchPool = async (query, typeFilter) => {
    const pool = [];
    try {
      const res = await searchCards(query);
      for (const card of res?.data ?? []) {
        if (!seen.has(card.name) && typeFilter(card)) {
          seen.add(card.name);
          pool.push(card);
        }
      }
    } catch { /* skip */ }
    await sleep(SLEEP_MS);
    return pool;
  };

  const isCreature  = (c) => !!c.type_line?.toLowerCase().includes('creature');
  const isNonLand   = (c) => !c.type_line?.toLowerCase().includes('land') && !isCreature(c);
  const isNonBasic  = (c) =>  c.type_line?.toLowerCase().includes('land');

  const creaturePool    = await fetchPool(archetype.creatureQuery, isCreature);
  const spellPool       = await fetchPool(archetype.spellQuery,    isNonLand);
  const nonBasicLandPool = await fetchPool(archetype.landQuery,    isNonBasic);

  const keyCards = [];

  // Creatures
  let filled = 0;
  for (const card of creaturePool) {
    if (filled >= targets.creature) break;
    const qty = Math.min(guessQuantity(card, archetype.strategy), targets.creature - filled);
    keyCards.push({ name: card.name, quantity: qty, section: 'mainboard' });
    filled += qty;
  }

  // Spells
  filled = 0;
  for (const card of spellPool) {
    if (filled >= targets.spell) break;
    const qty = Math.min(guessQuantity(card, archetype.strategy), targets.spell - filled);
    keyCards.push({ name: card.name, quantity: qty, section: 'mainboard' });
    filled += qty;
  }

  // Non-basics (up to half the land slots)
  const nonBasicTarget = Math.min(nonBasicLandPool.length, Math.floor(targets.land / 2));
  let landFilled = 0;
  for (const card of nonBasicLandPool) {
    if (landFilled >= nonBasicTarget) break;
    keyCards.push({ name: card.name, quantity: 1, section: 'land' });
    landFilled++;
  }

  // Basics
  const basicsNeeded = targets.land - landFilled;
  const colors       = archetype.colors.filter((c) => BASIC_LANDS[c]);
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

  // Hard-cap at 60
  let total = keyCards.reduce((s, c) => s + c.quantity, 0);
  let idx   = keyCards.length - 1;
  while (total > 60 && idx >= 0) {
    if (keyCards[idx].quantity > 1) { keyCards[idx].quantity--; total--; }
    else { keyCards.splice(idx, 1); total--; }
    idx--;
  }

  return keyCards;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchScryfallArchetypeDecks(format) {
  const archetypes = ARCHETYPES[format];
  if (!archetypes) return [];

  const results = [];
  for (const archetype of archetypes) {
    try {
      const keyCards = await build60CardDeck(archetype);
      if (keyCards.length >= 10) {
        results.push({
          id:          archetype.id,
          name:        archetype.name,
          source:      'Scryfall',
          format,
          strategy:    archetype.strategy,
          colors:      archetype.colors,
          description: archetype.description,
          keyCards,
          swapIns: [],
        });
      }
    } catch (err) {
      console.warn(`[scryfallSource] Failed "${archetype.name}":`, err.message);
    }
  }
  return results;
}
