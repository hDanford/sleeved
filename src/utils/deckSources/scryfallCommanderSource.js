// src/utils/deckSources/scryfallCommanderSource.js
//
// Builds Commander decks entirely from Scryfall — no EDHREC dependency.
//
// Two modes:
//  1. Pre-built archetypes  — 31 hardcoded commanders with targeted keyword filters.
//     Used by fetchScryfallCommanderDecks() as a Firestore catalog fallback.
//  2. On-demand search      — any commander by name, queries derived dynamically
//     from the card's color identity + oracle text.
//     Used by fetchCommanderDeckByName().
//
// Archidekt integration is stubbed (TODO) and falls through to mode 2.

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SCRYFALL_BASE = 'https://api.scryfall.com';
const SLEEP_MS = 120; // stay well under Scryfall's 10 req/s guideline
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Basic land card name keyed by WUBRG colour letter. */
const BASIC_LANDS = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};

/**
 * Target slot counts for a 99-card Commander deck (commander card is separate).
 * creature(27) + instant(8) + sorcery(8) + manaArtifact(8) + artifact(4) +
 * enchantment(5) + planeswalker(1) + land(38) = 99
 */
const SLOT_TARGETS = {
  creature:     27,
  instant:       8,
  sorcery:       8,
  manaArtifact:  8,  // artifacts whose oracle text generates mana (cmc ≤ 4)
  artifact:      4,  // everything else artifact
  enchantment:   5,
  planeswalker:  1,
  land:         38,  // 13 utility/dual + 25 basics (exact split varies per CI)
};

const UTILITY_LAND_TARGET = 13;

// ---------------------------------------------------------------------------
// Scryfall fetch wrapper — sorted by EDHREC popularity
// ---------------------------------------------------------------------------

/**
 * Run a Scryfall card search, sorted by EDHREC popularity so the most
 * played cards surface first. Returns the first page (up to 175 cards).
 */
async function scryfallSearch(query) {
  try {
    const url = `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data ?? [];
  } catch {
    return [];
  }
}

/** Fetch a single card by fuzzy name from Scryfall. */
async function scryfallNamedFuzzy(name) {
  try {
    const url = `${SCRYFALL_BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.object === 'error') return null;
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Card categorisation
// ---------------------------------------------------------------------------

/**
 * Assign a card to a slot bucket based on its type_line and oracle_text.
 * Creatures with any extra type take priority as 'creature'.
 */
function categorizeCard(card) {
  const tl = (card.type_line ?? '').toLowerCase();
  const oracle = (card.oracle_text ?? '').toLowerCase();
  const cmc = card.cmc ?? 0;

  if (tl.includes('land')) return 'land';
  if (tl.includes('creature')) return 'creature';
  if (tl.includes('planeswalker')) return 'planeswalker';
  if (tl.includes('artifact')) {
    const producesMana =
      oracle.includes('add {') ||
      oracle.includes('add one mana') ||
      oracle.includes(': add');
    return producesMana && cmc <= 4 ? 'manaArtifact' : 'artifact';
  }
  if (tl.includes('enchantment')) return 'enchantment';
  if (tl.includes('instant')) return 'instant';
  if (tl.includes('sorcery')) return 'sorcery';
  return null; // battle, dungeon, etc. — skip
}

// ---------------------------------------------------------------------------
// Deck assembly from query results
// ---------------------------------------------------------------------------

/**
 * Given a query map, fetch Scryfall results for each slot, deduplicate,
 * fill buckets up to SLOT_TARGETS, and top off with basic lands.
 *
 * @param {object} queries  Keys: creatures | spells | manaArtifacts | artifacts | enchantments | lands
 * @param {string[]} colors Color identity array e.g. ['W','U','B','G']
 * @returns {{ keyCards: object[], swapIns: object[] }}
 */
async function buildDeckFromQueries(queries, colors) {
  const seen = new Set();
  const buckets = {
    creature: [], instant: [], sorcery: [],
    manaArtifact: [], artifact: [], enchantment: [],
    planeswalker: [], land: [],
  };
  const overflowCards = [];

  const processResults = (cards) => {
    for (const card of cards) {
      if (seen.has(card.name)) continue;
      seen.add(card.name);
      const cat = categorizeCard(card);
      if (!cat) continue;
      if (buckets[cat].length < SLOT_TARGETS[cat]) {
        buckets[cat].push(card);
      } else {
        overflowCards.push(card);
      }
    }
  };

  // Creatures
  if (queries.creatures) {
    processResults(await scryfallSearch(queries.creatures));
    await sleep(SLEEP_MS);
  }
  // Spells (instants + sorceries)
  if (queries.spells) {
    processResults(await scryfallSearch(queries.spells));
    await sleep(SLEEP_MS);
  }
  // Mana rocks
  if (queries.manaArtifacts) {
    processResults(await scryfallSearch(queries.manaArtifacts));
    await sleep(SLEEP_MS);
  }
  // Other artifacts
  if (queries.artifacts) {
    processResults(await scryfallSearch(queries.artifacts));
    await sleep(SLEEP_MS);
  }
  // Enchantments (also catches any planeswalkers tagged in the query)
  if (queries.enchantments) {
    processResults(await scryfallSearch(queries.enchantments));
    await sleep(SLEEP_MS);
  }
  // Utility / dual lands
  if (queries.lands) {
    processResults(await scryfallSearch(queries.lands));
    await sleep(SLEEP_MS);
  }

  // ── Assemble keyCards ──────────────────────────────────────────────────────

  const keyCards = [];

  // Non-land slots (each card is a singleton in Commander)
  const nonLandSlots = ['creature', 'instant', 'sorcery', 'manaArtifact', 'artifact', 'enchantment', 'planeswalker'];
  for (const slot of nonLandSlots) {
    for (const card of buckets[slot]) {
      keyCards.push({ name: card.name, quantity: 1, section: 'mainboard' });
    }
  }

  // Utility lands (individually, quantity 1 each)
  const utilityLands = buckets.land.slice(0, UTILITY_LAND_TARGET);
  for (const land of utilityLands) {
    keyCards.push({ name: land.name, quantity: 1, section: 'land' });
  }

  // Fill remaining land slots with basic lands split across colours
  const basicsNeeded = SLOT_TARGETS.land - utilityLands.length;
  if (colors.length === 0) {
    // Colourless commander
    keyCards.push({ name: 'Wastes', quantity: basicsNeeded, section: 'land' });
  } else {
    const perColor = Math.floor(basicsNeeded / colors.length);
    const remainder = basicsNeeded % colors.length;
    colors.forEach((c, i) => {
      const count = perColor + (i < remainder ? 1 : 0);
      if (count > 0) {
        keyCards.push({ name: BASIC_LANDS[c] ?? 'Forest', quantity: count, section: 'land' });
      }
    });
  }

  // SwapIns bench — top overflow cards the player might want to consider
  const swapIns = overflowCards
    .slice(0, 25)
    .map((card) => ({ name: card.name, quantity: 1, section: 'mainboard' }));

  return { keyCards, swapIns };
}

// ---------------------------------------------------------------------------
// Query builder for pre-built archetypes
// ---------------------------------------------------------------------------

function buildQueriesForArchetype(archetype) {
  const ci = archetype.colors.join('').toLowerCase() || 'c';
  return {
    creatures:
      `ci:${ci} t:creature (${archetype.creatureFilter}) -t:land`,
    spells:
      `ci:${ci} (t:instant OR t:sorcery) (${archetype.spellFilter})`,
    manaArtifacts:
      `ci:${ci} t:artifact (o:"add {" OR o:"add one mana" OR o:": add") cmc<=4`,
    artifacts:
      `ci:${ci} t:artifact (${archetype.artifactFilter}) -o:"add {" -t:creature cmc>=2`,
    enchantments:
      `ci:${ci} (t:enchantment OR t:planeswalker) (${archetype.enchantFilter})`,
    lands:
      `ci:${ci} t:land -t:basic`,
  };
}

// ---------------------------------------------------------------------------
// Build a deck object from a pre-built archetype definition
// ---------------------------------------------------------------------------

async function buildDeckFromArchetype(archetype) {
  const queries = buildQueriesForArchetype(archetype);
  const { keyCards, swapIns } = await buildDeckFromQueries(queries, archetype.colors);

  // Prepend commander card
  keyCards.unshift({ name: archetype.commander, quantity: 1, section: 'commander' });

  return {
    id:          archetype.id,
    name:        archetype.name,
    commander:   archetype.commander,
    source:      'Scryfall',
    sourceUrl:   `https://scryfall.com/search?q=commander%3A${encodeURIComponent(archetype.commander)}+order%3Aedhrec`,
    format:      'commander',
    strategy:    archetype.strategy,
    colors:      archetype.colors,
    description: archetype.description,
    keyCards,
    swapIns,
    syncedAt:    new Date().toISOString(),
    syncDate:    new Date().toISOString().split('T')[0],
  };
}

// ---------------------------------------------------------------------------
// Dynamic query derivation for arbitrary commanders
// ---------------------------------------------------------------------------

const TRIBES = [
  'goblin', 'elf', 'zombie', 'vampire', 'dragon', 'angel', 'demon',
  'warrior', 'ninja', 'sliver', 'merfolk', 'human', 'beast', 'knight',
  'wizard', 'cat', 'faerie', 'dwarf', 'shapeshifter', 'soldier', 'cleric',
  'pirate', 'dinosaur', 'elemental', 'spirit',
];

function detectTribe(typeLine, oracle) {
  const combined = `${typeLine} ${oracle}`.toLowerCase();
  return TRIBES.find((t) => combined.includes(t)) ?? null;
}

function detectStrategy(oracle, typeLine, colors) {
  const o = oracle.toLowerCase();
  if (/proliferate|infect|poison/.test(o)) return 'goodstuff';
  if (/ninjutsu|ninja/.test(o)) return 'tempo';
  if (/landfall/.test(o)) return 'ramp';
  if (/wheel|each player draws/.test(o)) return 'control';
  if (
    /sacrifice|dies/.test(o) &&
    (/return.*graveyard|reanimate|graveyard.*play/.test(o))
  ) return 'reanimator';
  if (/sacrifice|dies/.test(o)) return 'combo';
  if (/token/.test(o) && colors.some((c) => ['W', 'G'].includes(c))) return 'aggro';
  if (TRIBES.some((t) => typeLine.toLowerCase().includes(t))) return 'tribal';
  if (colors.length >= 4) return 'goodstuff';
  if (colors.length === 1 && colors[0] === 'R') return 'aggro';
  return 'midrange';
}

/** Derive archetype-style keyword filters from a Scryfall card object. */
function deriveFiltersFromCard(commanderCard) {
  const oracle   = (commanderCard.oracle_text ?? '').toLowerCase();
  const typeLine = (commanderCard.type_line ?? '').toLowerCase();
  const colors   = commanderCard.color_identity ?? [];

  const tribe = detectTribe(typeLine, oracle);

  // Creature filter parts — prioritise the commander's own keywords
  const creatureParts = [];
  if (tribe)                              creatureParts.push(`t:${tribe}`);
  if (/proliferate/.test(oracle))         creatureParts.push('o:proliferate');
  if (/sacrifice|dies/.test(oracle))      creatureParts.push('o:sacrifice', 'o:dies');
  if (/landfall/.test(oracle))            creatureParts.push('o:landfall');
  if (/flicker|blink/.test(oracle))       creatureParts.push('o:"when ~ enters"');
  if (/ninjutsu|ninja/.test(oracle))      creatureParts.push('t:ninja', 'o:ninjutsu');
  if (/graveyard/.test(oracle))           creatureParts.push('o:graveyard');
  if (/artifact/.test(oracle))            creatureParts.push('t:artifact');
  if (/counter|proliferate/.test(oracle)) creatureParts.push('o:counter');
  if (creatureParts.length === 0)         creatureParts.push('r:rare', 'r:uncommon', 'r:mythic');
  const creatureFilter = [...new Set(creatureParts)].slice(0, 4).join(' OR ');

  // Spell filter
  const spellParts = ['o:draw', 'o:tutor'];
  if (tribe)                                                     spellParts.push(`o:${tribe}`);
  if (/counter/.test(oracle) && colors.includes('U'))            spellParts.push('o:counter');
  if (/destroy|exile/.test(oracle))                              spellParts.push('o:destroy', 'o:exile');
  if (/token/.test(oracle))                                      spellParts.push('o:token');
  if (/graveyard|reanimate/.test(oracle))                        spellParts.push('o:reanimate');
  if (/landfall|land/.test(oracle))                              spellParts.push('o:land');
  if (/wheel|each player draws/.test(oracle))                    spellParts.push('o:wheel');
  const spellFilter = [...new Set(spellParts)].slice(0, 5).join(' OR ');

  const artifactFilter = tribe ? `o:${tribe} OR o:draw` : 'o:draw OR o:creature OR o:sacrifice';
  const enchantFilter  = tribe ? `o:${tribe} OR o:creature` : 'o:creature OR o:draw OR o:trigger';

  const strategy = detectStrategy(oracle, typeLine, colors);

  return { creatureFilter, spellFilter, artifactFilter, enchantFilter, strategy };
}

// ---------------------------------------------------------------------------
// 31 pre-built Commander archetypes
// ---------------------------------------------------------------------------

export const COMMANDER_ARCHETYPES = [
  // ── 4-colour ────────────────────────────────────────────────────────────────
  {
    id: 'scryfall-cmd-atraxa',
    name: 'Atraxa Proliferate',
    commander: "Atraxa, Praetors' Voice",
    colors: ['W', 'U', 'B', 'G'],
    strategy: 'goodstuff',
    description: 'Use proliferate to maximise counters on planeswalkers, creatures, and poison.',
    creatureFilter: 'o:proliferate OR o:infect OR o:poison OR o:counter OR o:"enters with"',
    spellFilter:    'o:proliferate OR o:draw OR o:counter OR o:exile OR o:wrath',
    artifactFilter: 'o:counter OR o:proliferate OR o:planeswalker',
    enchantFilter:  'o:proliferate OR o:counter OR o:planeswalker',
  },
  {
    id: 'scryfall-cmd-omnath-creation',
    name: 'Omnath Landfall',
    commander: 'Omnath, Locus of Creation',
    colors: ['W', 'U', 'R', 'G'],
    strategy: 'ramp',
    description: 'Play extra lands for landfall triggers generating life, mana, and damage.',
    creatureFilter: 'o:landfall OR o:"land enters" OR o:"put a land" OR o:fetch',
    spellFilter:    'o:land OR o:fetch OR o:counter OR o:draw OR o:wrath',
    artifactFilter: 'o:land OR o:creature',
    enchantFilter:  'o:landfall OR o:land OR o:creature',
  },
  // ── 5-colour ────────────────────────────────────────────────────────────────
  {
    id: 'scryfall-cmd-ur-dragon',
    name: 'The Ur-Dragon',
    commander: 'The Ur-Dragon',
    colors: ['W', 'U', 'B', 'R', 'G'],
    strategy: 'tribal',
    description: "Fill the board with powerful dragons using the Ur-Dragon's Eminence ability.",
    creatureFilter: 't:dragon',
    spellFilter:    'o:dragon OR o:counter OR o:exile OR o:wrath OR o:tutor',
    artifactFilter: 'o:dragon OR o:flying',
    enchantFilter:  'o:dragon OR o:flying OR o:creature',
  },
  {
    id: 'scryfall-cmd-najeela',
    name: 'Najeela Warriors',
    commander: 'Najeela, the Blade-Blossom',
    colors: ['W', 'U', 'B', 'R', 'G'],
    strategy: 'tribal',
    description: 'Untap and attack repeatedly with Najeela to overwhelm opponents with warrior tokens.',
    creatureFilter: 't:warrior',
    spellFilter:    'o:warrior OR o:untap OR o:combat OR o:counter OR o:exile',
    artifactFilter: 'o:warrior OR o:attack OR o:untap',
    enchantFilter:  'o:warrior OR o:attack OR o:combat',
  },
  {
    id: 'scryfall-cmd-sisay',
    name: 'Sisay Legends',
    commander: 'Sisay, Weatherlight Captain',
    colors: ['W', 'U', 'B', 'R', 'G'],
    strategy: 'goodstuff',
    description: 'Tutor legendary permanents with Sisay, building an unstoppable board of legends.',
    creatureFilter: 't:legendary t:creature',
    spellFilter:    'o:legendary OR o:counter OR o:exile OR o:wrath OR o:tutor',
    artifactFilter: 't:legendary t:artifact',
    enchantFilter:  't:legendary',
  },
  {
    id: 'scryfall-cmd-sliver-overlord',
    name: 'Sliver Overlord',
    commander: 'Sliver Overlord',
    colors: ['W', 'U', 'B', 'R', 'G'],
    strategy: 'tribal',
    description: 'Tutor any sliver and give your hive-mind army overwhelming abilities.',
    creatureFilter: 't:sliver',
    spellFilter:    'o:sliver OR o:counter OR o:exile OR o:draw OR o:wrath',
    artifactFilter: 'o:sliver OR o:creature OR o:draw',
    enchantFilter:  'o:sliver OR o:creature OR o:draw',
  },
  // ── 3-colour ────────────────────────────────────────────────────────────────
  {
    id: 'scryfall-cmd-breya',
    name: 'Breya Artifacts',
    commander: 'Breya, Etherium Shaper',
    colors: ['W', 'U', 'B', 'R'],
    strategy: 'combo',
    description: "Generate artifact tokens and sacrifice them for value with Breya's activated ability.",
    creatureFilter: 't:artifact OR o:"artifact creature" OR o:thopter',
    spellFilter:    'o:artifact OR o:counter OR o:draw OR o:exile OR o:wrath',
    artifactFilter: 'o:sacrifice OR o:combo OR o:thopter OR o:"artifact token"',
    enchantFilter:  'o:artifact OR o:treasure',
  },
  {
    id: 'scryfall-cmd-kaalia',
    name: 'Kaalia Angels/Demons/Dragons',
    commander: 'Kaalia of the Vast',
    colors: ['W', 'B', 'R'],
    strategy: 'aggro',
    description: 'Attack with Kaalia to cheat powerful angels, demons, and dragons into play.',
    creatureFilter: 't:angel OR t:demon OR t:dragon',
    spellFilter:    'o:angel OR o:demon OR o:dragon OR o:destroy OR o:exile OR o:tutor',
    artifactFilter: 'o:creature OR o:haste',
    enchantFilter:  'o:creature OR o:angel OR o:attack',
  },
  {
    id: 'scryfall-cmd-edgar',
    name: 'Edgar Markov Vampires',
    commander: 'Edgar Markov',
    colors: ['W', 'B', 'R'],
    strategy: 'tribal',
    description: "Cast vampires to trigger Edgar's eminence, flooding the board with vampire tokens.",
    creatureFilter: 't:vampire',
    spellFilter:    'o:vampire OR o:destroy OR o:exile OR o:draw OR o:lifelink',
    artifactFilter: 'o:vampire OR o:lifelink OR o:creature',
    enchantFilter:  'o:vampire OR o:blood OR o:lifelink',
  },
  {
    id: 'scryfall-cmd-isshin',
    name: 'Isshin Attack Triggers',
    commander: 'Isshin, Two Heavens as One',
    colors: ['W', 'B', 'R'],
    strategy: 'aggro',
    description: 'Double attack triggers with Isshin to generate overwhelming combat value.',
    creatureFilter: 'o:"when ~ attacks" OR o:"whenever ~ attacks" OR o:attack OR o:haste',
    spellFilter:    'o:attack OR o:combat OR o:destroy OR o:exile OR o:tutor',
    artifactFilter: 'o:attack OR o:combat OR o:treasure',
    enchantFilter:  'o:attack OR o:combat OR o:creature',
  },
  {
    id: 'scryfall-cmd-korvold',
    name: 'Korvold Sacrifice',
    commander: 'Korvold, Fae-Cursed King',
    colors: ['B', 'R', 'G'],
    strategy: 'combo',
    description: 'Sacrifice permanents to draw cards and grow Korvold into a massive threat.',
    creatureFilter: 'o:sacrifice OR o:dies OR o:treasure OR o:"food token" OR o:"clue token"',
    spellFilter:    'o:sacrifice OR o:treasure OR o:draw OR o:destroy OR o:tutor',
    artifactFilter: 'o:sacrifice OR o:treasure',
    enchantFilter:  'o:sacrifice OR o:dies OR o:treasure',
  },
  {
    id: 'scryfall-cmd-animar',
    name: 'Animar Creatures',
    commander: 'Animar, Soul of Elements',
    colors: ['U', 'R', 'G'],
    strategy: 'combo',
    description: 'Build counters on Animar to cast large creatures for free.',
    creatureFilter: 'o:morph OR o:manifest OR o:cascade OR cmc>=6',
    spellFilter:    'o:counter OR o:draw OR o:bounce OR o:creature OR o:tutor',
    artifactFilter: 'o:creature OR o:draw OR o:morph',
    enchantFilter:  'o:creature OR o:draw',
  },
  {
    id: 'scryfall-cmd-nekusar',
    name: 'Nekusar Wheels',
    commander: 'Nekusar, the Mindrazer',
    colors: ['U', 'B', 'R'],
    strategy: 'control',
    description: 'Force opponents to draw cards while Nekusar punishes each draw.',
    creatureFilter: 'o:"when a player draws" OR o:wheel OR o:punish',
    spellFilter:    'o:wheel OR o:"each player draws" OR o:draw OR o:counter OR o:wrath',
    artifactFilter: 'o:wheel OR o:draw OR o:discard',
    enchantFilter:  'o:draw OR o:wheel OR o:damage',
  },
  {
    id: 'scryfall-cmd-marchesa',
    name: 'Marchesa Persist Combo',
    commander: 'Marchesa, the Black Rose',
    colors: ['U', 'B', 'R'],
    strategy: 'combo',
    description: "Give creatures +1/+1 counters and recur them infinitely with Marchesa.",
    creatureFilter: 'o:persist OR o:undying OR o:counter OR o:dethrone OR o:dies',
    spellFilter:    'o:counter OR o:draw OR o:exile OR o:bounce OR o:tutor',
    artifactFilter: 'o:sacrifice OR o:creature OR o:counter',
    enchantFilter:  'o:counter OR o:sacrifice OR o:creature',
  },
  {
    id: 'scryfall-cmd-muldrotha',
    name: 'Muldrotha Graveyard',
    commander: 'Muldrotha, the Gravetide',
    colors: ['U', 'B', 'G'],
    strategy: 'midrange',
    description: 'Fill the graveyard and replay one permanent of each type every turn.',
    creatureFilter: 'o:graveyard OR o:mill OR o:dies OR o:"self-mill"',
    spellFilter:    'o:graveyard OR o:mill OR o:reanimate OR o:draw OR o:tutor',
    artifactFilter: 'o:graveyard OR o:mill OR o:draw',
    enchantFilter:  'o:graveyard OR o:mill OR o:creature',
  },
  {
    id: 'scryfall-cmd-chulane',
    name: 'Chulane Blink ETB',
    commander: 'Chulane, Teller of Tales',
    colors: ['W', 'U', 'G'],
    strategy: 'midrange',
    description: "Cast creatures to draw cards and bounce them for repeated ETB triggers.",
    creatureFilter: 'o:"when ~ enters" OR o:blink OR o:bounce OR o:flicker',
    spellFilter:    'o:blink OR o:flicker OR o:bounce OR o:counter OR o:draw',
    artifactFilter: 'o:blink OR o:creature OR o:draw',
    enchantFilter:  'o:blink OR o:creature OR o:draw OR o:land',
  },
  {
    id: 'scryfall-cmd-roon',
    name: 'Roon Flicker',
    commander: 'Roon of the Hidden Realm',
    colors: ['W', 'U', 'G'],
    strategy: 'midrange',
    description: "Flicker creatures with Roon to abuse ETB abilities for repeated value.",
    creatureFilter: 'o:"when ~ enters" OR o:"enters the battlefield" OR o:blink OR o:flicker',
    spellFilter:    'o:blink OR o:counter OR o:draw OR o:exile OR o:wrath',
    artifactFilter: 'o:blink OR o:flicker OR o:creature OR o:draw',
    enchantFilter:  'o:blink OR o:creature OR o:draw',
  },
  {
    id: 'scryfall-cmd-prosper',
    name: 'Prosper Treasure',
    commander: 'Prosper, Tome-Bound',
    colors: ['B', 'R'],
    strategy: 'midrange',
    description: 'Exile cards for impulse draw and generate treasure tokens from each one played.',
    creatureFilter: 'o:treasure OR o:impulse OR o:exile',
    spellFilter:    'o:exile OR o:treasure OR o:draw OR o:discard OR o:tutor',
    artifactFilter: 'o:treasure OR o:impulse OR o:exile',
    enchantFilter:  'o:treasure OR o:exile OR o:impulse',
  },
  {
    id: 'scryfall-cmd-wilhelt',
    name: 'Wilhelt Zombies',
    commander: 'Wilhelt, the Rotcleaver',
    colors: ['U', 'B'],
    strategy: 'tribal',
    description: 'Generate zombie tokens from dying zombies and sacrifice them for massive card draw.',
    creatureFilter: 't:zombie',
    spellFilter:    'o:zombie OR o:draw OR o:counter OR o:reanimate OR o:wrath',
    artifactFilter: 'o:zombie OR o:draw OR o:graveyard',
    enchantFilter:  'o:zombie OR o:graveyard OR o:draw',
  },
  // ── 2-colour ────────────────────────────────────────────────────────────────
  {
    id: 'scryfall-cmd-meren',
    name: 'Meren Reanimator',
    commander: 'Meren of Clan Nel Toth',
    colors: ['B', 'G'],
    strategy: 'reanimator',
    description: 'Sacrifice creatures to gain experience counters, then reanimate your best threats.',
    creatureFilter: 'o:sacrifice OR o:dies OR o:graveyard OR o:"when ~ dies"',
    spellFilter:    'o:reanimate OR o:graveyard OR o:destroy OR o:draw OR o:tutor',
    artifactFilter: 'o:sacrifice OR o:graveyard',
    enchantFilter:  'o:sacrifice OR o:graveyard OR o:dies',
  },
  {
    id: 'scryfall-cmd-lathril',
    name: 'Lathril Elves',
    commander: 'Lathril, Blade of the Elves',
    colors: ['B', 'G'],
    strategy: 'tribal',
    description: "Flood the board with elves and drain each opponent for ten with Lathril.",
    creatureFilter: 't:elf',
    spellFilter:    'o:elf OR o:draw OR o:destroy OR o:exile OR o:tutor',
    artifactFilter: 'o:elf OR o:creature OR o:draw',
    enchantFilter:  'o:elf OR o:creature OR o:draw',
  },
  {
    id: 'scryfall-cmd-kinnan',
    name: 'Kinnan Mana Dorks',
    commander: 'Kinnan, Bonder Prodigy',
    colors: ['U', 'G'],
    strategy: 'combo',
    description: 'Produce enormous mana with buffed mana dorks and spend it on game-winning haymakers.',
    creatureFilter: 'o:"add {" OR cmc>=6',
    spellFilter:    'o:counter OR o:draw OR o:bounce OR o:tutor OR o:creature',
    artifactFilter: 'o:draw OR o:creature OR o:mana',
    enchantFilter:  'o:mana OR o:draw OR o:creature',
  },
  {
    id: 'scryfall-cmd-yuriko',
    name: 'Yuriko Ninjas',
    commander: "Yuriko, the Tiger's Shadow",
    colors: ['U', 'B'],
    strategy: 'tempo',
    description: 'Ninjutsu cheap creatures and reveal high-CMC cards to drain opponents.',
    creatureFilter: 't:ninja OR o:ninjutsu OR o:"can\'t be blocked" OR o:skulk OR o:shadow',
    spellFilter:    'o:counter OR o:bounce OR o:draw OR o:exile OR o:reanimate',
    artifactFilter: 'o:ninja OR o:draw OR o:creature',
    enchantFilter:  'o:ninja OR o:draw OR o:creature',
  },
  {
    id: 'scryfall-cmd-teysa',
    name: 'Teysa Karlov Death Triggers',
    commander: 'Teysa Karlov',
    colors: ['W', 'B'],
    strategy: 'midrange',
    description: 'Double death triggers with Teysa for infinite value from dying creatures.',
    creatureFilter: 'o:"when ~ dies" OR o:"whenever a creature dies" OR o:lifelink OR o:token',
    spellFilter:    'o:destroy OR o:exile OR o:draw OR o:sacrifice OR o:wrath',
    artifactFilter: 'o:sacrifice OR o:dies OR o:token',
    enchantFilter:  'o:dies OR o:sacrifice OR o:token',
  },
  {
    id: 'scryfall-cmd-brago',
    name: 'Brago Stax Blink',
    commander: 'Brago, King Eternal',
    colors: ['W', 'U'],
    strategy: 'control',
    description: 'Blink nonland permanents with Brago to lock opponents and generate card advantage.',
    creatureFilter: 'o:"when ~ enters" OR o:blink OR o:flicker OR o:"tap target"',
    spellFilter:    'o:blink OR o:counter OR o:draw OR o:exile OR o:wrath',
    artifactFilter: 'o:blink OR o:flicker OR o:stax OR o:draw',
    enchantFilter:  'o:blink OR o:stax OR o:draw OR o:counter',
  },
  {
    id: 'scryfall-cmd-rhys',
    name: 'Rhys the Redeemed Tokens',
    commander: 'Rhys the Redeemed',
    colors: ['W', 'G'],
    strategy: 'aggro',
    description: "Double all tokens on the battlefield with Rhys's activated ability.",
    creatureFilter: 'o:token OR o:populate OR o:saproling OR o:convoke OR t:elf',
    spellFilter:    'o:token OR o:populate OR o:draw OR o:wrath',
    artifactFilter: 'o:token OR o:creature OR o:draw',
    enchantFilter:  'o:token OR o:"gets +" OR o:populate',
  },
  {
    id: 'scryfall-cmd-xenagos',
    name: 'Xenagos Stompy',
    commander: 'Xenagos, God of Revels',
    colors: ['R', 'G'],
    strategy: 'aggro',
    description: "Double the power and give haste to your biggest creature each combat.",
    creatureFilter: 'cmc>=4 OR o:trample OR o:haste OR o:"double strike"',
    spellFilter:    'o:draw OR o:land OR o:fight OR o:creature OR o:wrath',
    artifactFilter: 'o:creature OR o:haste OR o:trample',
    enchantFilter:  'o:creature OR o:haste OR o:trample OR o:attack',
  },
  // ── Mono-colour ──────────────────────────────────────────────────────────────
  {
    id: 'scryfall-cmd-krenko',
    name: 'Krenko Goblins',
    commander: 'Krenko, Mob Boss',
    colors: ['R'],
    strategy: 'aggro',
    description: 'Exponentially multiply goblin tokens with Krenko and swing for the win.',
    creatureFilter: 't:goblin',
    spellFilter:    'o:goblin OR o:damage OR o:haste OR o:draw OR o:wheel',
    artifactFilter: 'o:goblin OR o:haste OR o:"untap"',
    enchantFilter:  'o:goblin OR o:haste OR o:attack',
  },
  {
    id: 'scryfall-cmd-daretti',
    name: 'Daretti Artifact Reanimator',
    commander: 'Daretti, Scrap Savant',
    colors: ['R'],
    strategy: 'reanimator',
    description: "Discard artifacts and reanimate them with Daretti's -2 ability.",
    creatureFilter: 't:artifact OR o:artifact',
    spellFilter:    'o:artifact OR o:wheel OR o:discard OR o:draw',
    artifactFilter: 'o:sacrifice OR o:graveyard OR o:untap OR o:draw',
    enchantFilter:  'o:artifact OR o:draw OR o:discard',
  },
  {
    id: 'scryfall-cmd-omnath-mana',
    name: 'Omnath Mono Green Ramp',
    commander: 'Omnath, Locus of Mana',
    colors: ['G'],
    strategy: 'ramp',
    description: 'Generate absurd amounts of green mana and spend it on enormous creatures.',
    creatureFilter: 'o:"add {G" OR cmc>=6 OR o:trample',
    spellFilter:    'o:land OR o:draw OR o:creature OR o:"search your library"',
    artifactFilter: 'o:mana OR o:creature OR o:draw',
    enchantFilter:  'o:mana OR o:creature OR o:draw OR o:land',
  },
  {
    id: 'scryfall-cmd-urza',
    name: 'Urza Artifacts',
    commander: 'Urza, Lord High Artificer',
    colors: ['U'],
    strategy: 'combo',
    description: 'Generate massive mana from artifacts and power out game-winning combos.',
    creatureFilter: 't:artifact OR o:artifact',
    spellFilter:    'o:counter OR o:draw OR o:artifact OR o:bounce OR o:tutor',
    artifactFilter: 'o:draw OR o:untap OR o:combo OR o:tutor',
    enchantFilter:  'o:artifact OR o:draw OR o:untap',
  },
  // ── WBG ──────────────────────────────────────────────────────────────────────
  {
    id: 'scryfall-cmd-ghave',
    name: 'Ghave Token Combo',
    commander: 'Ghave, Guru of Spores',
    colors: ['W', 'B', 'G'],
    strategy: 'combo',
    description: "Generate saproling tokens and use counters to fuel Ghave's infinite loops.",
    creatureFilter: 'o:counter OR o:token OR o:sacrifice OR o:saproling OR o:dies',
    spellFilter:    'o:counter OR o:token OR o:wrath OR o:draw OR o:tutor',
    artifactFilter: 'o:counter OR o:token OR o:sacrifice',
    enchantFilter:  'o:counter OR o:token OR o:sacrifice',
  },
  {
    id: 'scryfall-cmd-karador',
    name: 'Karador Graveyard Value',
    commander: 'Karador, Ghost Chieftain',
    colors: ['W', 'B', 'G'],
    strategy: 'reanimator',
    description: "Recast creatures from your graveyard each turn with Karador's cost reduction.",
    creatureFilter: 'o:dies OR o:graveyard OR o:"when ~ enters" OR o:sacrifice',
    spellFilter:    'o:reanimate OR o:graveyard OR o:wrath OR o:draw OR o:tutor',
    artifactFilter: 'o:graveyard OR o:sacrifice OR o:draw',
    enchantFilter:  'o:graveyard OR o:sacrifice OR o:dies',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * fetchScryfallCommanderDecks
 *
 * Build up to `count` pre-built Commander decks from Scryfall.
 * Used as a live fallback when the Firestore catalog is empty.
 * Archetypes are built sequentially to avoid rate-limiting Scryfall.
 *
 * @param {number} count Maximum number of decks to build (default 8)
 * @returns {Promise<object[]>} Array of deck objects
 */
export async function fetchScryfallCommanderDecks(count = 8) {
  const selected = COMMANDER_ARCHETYPES.slice(0, count);
  const results = [];

  for (const archetype of selected) {
    try {
      const deck = await buildDeckFromArchetype(archetype);
      if (deck.keyCards.length > 10) results.push(deck);
    } catch (err) {
      console.warn(`[scryfallCommanderSource] Failed to build "${archetype.name}":`, err.message);
    }
  }

  return results;
}

/**
 * fetchCommanderDeckByName
 *
 * On-demand search. Resolves a commander by name and builds a Scryfall deck.
 *   1. Checks pre-built archetypes for an exact commander name match.
 *   2. Falls back to a fuzzy Scryfall card lookup + dynamic query derivation.
 *
 * Archidekt integration is planned (TODO) and will slot in as step 1.5.
 *
 * @param {string} commanderName  e.g. "Atraxa, Praetors' Voice"
 * @returns {Promise<object|null>}  Deck object, or null if not found
 */
export async function fetchCommanderDeckByName(commanderName) {
  if (!commanderName?.trim()) return null;

  // ── 1. Pre-built archetype match ───────────────────────────────────────────
  const canonicalName = commanderName.trim().toLowerCase();
  const archetype = COMMANDER_ARCHETYPES.find(
    (a) => a.commander.toLowerCase() === canonicalName
  );
  if (archetype) {
    try {
      return await buildDeckFromArchetype(archetype);
    } catch (err) {
      console.warn('[scryfallCommanderSource] Pre-built build failed, falling through:', err.message);
    }
  }

  // ── TODO: Archidekt step (future) ─────────────────────────────────────────
  // const archidektDeck = await fetchArchidektDeckForCommander(commanderName);
  // if (archidektDeck) return archidektDeck;

  // ── 2. Dynamic Scryfall build ──────────────────────────────────────────────
  const commanderCard = await scryfallNamedFuzzy(commanderName);
  if (!commanderCard || commanderCard.object === 'error') {
    console.warn(`[scryfallCommanderSource] Card not found: "${commanderName}"`);
    return null;
  }

  const colors = commanderCard.color_identity ?? [];
  const ci = colors.join('').toLowerCase() || 'c';

  const { creatureFilter, spellFilter, artifactFilter, enchantFilter, strategy } =
    deriveFiltersFromCard(commanderCard);

  const queries = {
    creatures:     `ci:${ci} t:creature (${creatureFilter}) -t:land`,
    spells:        `ci:${ci} (t:instant OR t:sorcery) (${spellFilter})`,
    manaArtifacts: `ci:${ci} t:artifact (o:"add {" OR o:"add one mana" OR o:": add") cmc<=4`,
    artifacts:     `ci:${ci} t:artifact (${artifactFilter}) -o:"add {" -t:creature cmc>=2`,
    enchantments:  `ci:${ci} (t:enchantment OR t:planeswalker) (${enchantFilter})`,
    lands:         `ci:${ci} t:land -t:basic`,
  };

  const { keyCards, swapIns } = await buildDeckFromQueries(queries, colors);

  // Prepend commander
  keyCards.unshift({ name: commanderCard.name, quantity: 1, section: 'commander' });

  const slug = commanderCard.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return {
    id:          `scryfall-cmd-${slug}`,
    name:        `${commanderCard.name} Commander`,
    commander:   commanderCard.name,
    source:      'Scryfall',
    sourceUrl:   `https://scryfall.com/search?q=commander%3A${encodeURIComponent(commanderCard.name)}+order%3Aedhrec`,
    format:      'commander',
    strategy,
    colors,
    description: `Scryfall-generated deck for ${commanderCard.name}.`,
    keyCards,
    swapIns,
    syncedAt:    new Date().toISOString(),
    syncDate:    new Date().toISOString().split('T')[0],
  };
}
