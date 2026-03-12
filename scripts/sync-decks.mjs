// scripts/sync-decks.mjs
// Pulls Commander recommendations from EDHREC's per-commander JSON pages
// and writes to Firestore.
//
// The top commanders list is seeded here (EDHREC's listing endpoint blocks
// server-side requests). The slugs are just lowercase hyphenated card names,
// so this list is easy to update. Card data is refreshed nightly from EDHREC.
//
// Firestore path: meta_decks/commander/decks/{deckId}
//
// Required GitHub secrets:
//   FIREBASE_SERVICE_ACCOUNT  — contents of your Firebase service account JSON
//   FIREBASE_STORAGE_BUCKET   — e.g. "your-project.firebasestorage.app"

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// ── Top commanders seed list ──────────────────────────────────────────────────
// Slugs = lowercase, hyphenated card name (same as EDHREC URL).
// Update this list occasionally as the meta shifts.
// Current top commanders as of early 2026 (EDHREC 2-year rankings).

const TOP_COMMANDERS = [
  // Tier 1 — all-time most popular
  { name: 'Atraxa, Praetors\' Voice',       slug: 'atraxa-praetors-voice' },
  { name: 'Kenrith, the Returned King',      slug: 'kenrith-the-returned-king' },
  { name: 'Edgar Markov',                    slug: 'edgar-markov' },
  { name: 'Miirym, Sentinel Wyrm',           slug: 'miirym-sentinel-wyrm' },
  { name: 'Ur-Dragon, the',                  slug: 'the-ur-dragon' },
  { name: 'Krenko, Mob Boss',                slug: 'krenko-mob-boss' },
  { name: 'Muldrotha, the Gravetide',        slug: 'muldrotha-the-gravetide' },
  { name: 'Prossh, Skyraider of Kher',       slug: 'prossh-skyraider-of-kher' },
  { name: 'Teferi, Temporal Archmage',       slug: 'teferi-temporal-archmage' },
  { name: 'Nekusar, the Mindrazer',          slug: 'nekusar-the-mindrazer' },
  { name: 'Meren of Clan Nel Toth',          slug: 'meren-of-clan-nel-toth' },
  { name: 'Yuriko, the Tiger\'s Shadow',     slug: 'yuriko-the-tigers-shadow' },
  { name: 'Oloro, Ageless Ascetic',          slug: 'oloro-ageless-ascetic' },
  { name: 'Kaalia of the Vast',              slug: 'kaalia-of-the-vast' },
  { name: 'Azusa, Lost but Seeking',         slug: 'azusa-lost-but-seeking' },
  { name: 'Zur the Enchanter',               slug: 'zur-the-enchanter' },
  { name: 'Riku of Two Reflections',         slug: 'riku-of-two-reflections' },
  { name: 'Sliver Overlord',                 slug: 'sliver-overlord' },
  { name: 'Animar, Soul of Elements',        slug: 'animar-soul-of-elements' },
  { name: 'Mizzix of the Izmagnus',          slug: 'mizzix-of-the-izmagnus' },

  // Tier 2 — consistently popular
  { name: 'Lathril, Blade of the Elves',     slug: 'lathril-blade-of-the-elves' },
  { name: 'Yennet, Cryptic Sovereign',       slug: 'yennet-cryptic-sovereign' },
  { name: 'Wilhelt, the Rotcleaver',         slug: 'wilhelt-the-rotcleaver' },
  { name: 'Shorikai, Genesis Engine',        slug: 'shorikai-genesis-engine' },
  { name: 'Chulane, Teller of Tales',        slug: 'chulane-teller-of-tales' },
  { name: 'Isshin, Two Heavens as One',      slug: 'isshin-two-heavens-as-one' },
  { name: 'Winota, Joiner of Forces',        slug: 'winota-joiner-of-forces' },
  { name: 'Veyran, Voice of Duality',        slug: 'veyran-voice-of-duality' },
  { name: 'Sefris of the Hidden Ways',       slug: 'sefris-of-the-hidden-ways' },
  { name: 'Ghave, Guru of Spores',           slug: 'ghave-guru-of-spores' },
  { name: 'Omnath, Locus of Creation',       slug: 'omnath-locus-of-creation' },
  { name: 'Omnath, Locus of Rage',           slug: 'omnath-locus-of-rage' },
  { name: 'Tergrid, God of Fright',          slug: 'tergrid-god-of-fright' },
  { name: 'Syr Konrad, the Grim',            slug: 'syr-konrad-the-grim' },
  { name: 'Korvold, Fae-Cursed King',        slug: 'korvold-fae-cursed-king' },
  { name: 'Rograkh, Son of Rohgahh',         slug: 'rograkh-son-of-rohgahh' },
  { name: 'Obeka, Brute Chronologist',       slug: 'obeka-brute-chronologist' },
  { name: 'Gallia of the Endless Dance',     slug: 'gallia-of-the-endless-dance' },
  { name: 'Scion of the Ur-Dragon',          slug: 'scion-of-the-ur-dragon' },
  { name: 'Morophon, the Boundless',         slug: 'morophon-the-boundless' },
  { name: 'Zirda, the Dawnwaker',            slug: 'zirda-the-dawnwaker' },
  { name: 'Inalla, Archmage Ritualist',      slug: 'inalla-archmage-ritualist' },
  { name: 'Nicol Bolas, the Ravager',        slug: 'nicol-bolas-the-ravager' },
  { name: 'Xenagos, God of Revels',          slug: 'xenagos-god-of-revels' },
  { name: 'Ezuri, Claw of Progress',         slug: 'ezuri-claw-of-progress' },
  { name: 'Brago, King Eternal',             slug: 'brago-king-eternal' },
  { name: 'Breya, Etherium Shaper',          slug: 'breya-etherium-shaper' },
  { name: 'Marrow-Gnawer',                   slug: 'marrow-gnawer' },
  { name: 'Sliver Hivelord',                 slug: 'sliver-hivelord' },
  { name: 'Child of Alara',                  slug: 'child-of-alara' },

  // Recent meta commanders
  { name: 'Elminster',                       slug: 'elminster' },
  { name: 'Tameshi, Reality Architect',      slug: 'tameshi-reality-architect' },
  { name: 'Tasha, the Witch Queen',          slug: 'tasha-the-witch-queen' },
  { name: 'Lolth, Spider Queen',             slug: 'lolth-spider-queen' },
  { name: 'Raphael, Fiendish Savior',        slug: 'raphael-fiendish-savior' },
  { name: 'Jarad, Golgari Lich Lord',        slug: 'jarad-golgari-lich-lord' },
  { name: 'Niv-Mizzet, Parun',              slug: 'niv-mizzet-parun' },
  { name: 'Niv-Mizzet Reborn',              slug: 'niv-mizzet-reborn' },
  { name: 'Zaxara, the Exemplary',           slug: 'zaxara-the-exemplary' },
  { name: 'Otrimi, the Ever-Playful',        slug: 'otrimi-the-ever-playful' },
  { name: 'Araumi of the Dead Tide',         slug: 'araumi-of-the-dead-tide' },
  { name: 'Livio, Oathsworn Sentinel',       slug: 'livio-oathsworn-sentinel' },
  { name: 'Liesa, Shroud of Dusk',           slug: 'liesa-shroud-of-dusk' },
  { name: 'Shanid, Sleepers\' Scourge',      slug: 'shanid-sleepers-scourge' },
  { name: 'Sheoldred, the Apocalypse',       slug: 'sheoldred-the-apocalypse' },
  { name: 'Baral, Chief of Compliance',      slug: 'baral-chief-of-compliance' },
  { name: 'Gishath, Sun\'s Avatar',          slug: 'gishath-suns-avatar' },
  { name: 'Imoti, Celebrant of Bounty',      slug: 'imoti-celebrant-of-bounty' },
  { name: 'Hamza, Guardian of Arashin',      slug: 'hamza-guardian-of-arashin' },
  { name: 'Alaundo the Seer',               slug: 'alaundo-the-seer' },
  { name: 'Narset, Enlightened Master',      slug: 'narset-enlightened-master' },
  { name: 'Tasigur, the Golden Fang',        slug: 'tasigur-the-golden-fang' },
  { name: 'Marchesa, the Black Rose',        slug: 'marchesa-the-black-rose' },
  { name: 'Sidisi, Brood Tyrant',            slug: 'sidisi-brood-tyrant' },
  { name: 'Oona, Queen of the Fae',          slug: 'oona-queen-of-the-fae' },
  { name: 'Grenzo, Dungeon Warden',          slug: 'grenzo-dungeon-warden' },
  { name: 'Siona, Captain of the Pyleas',    slug: 'siona-captain-of-the-pyleas' },
  { name: 'Yawgmoth, Thran Physician',       slug: 'yawgmoth-thran-physician' },
  { name: 'Kozilek, Butcher of Truth',       slug: 'kozilek-butcher-of-truth' },
  { name: 'Kykar, Wind\'s Fury',             slug: 'kykar-winds-fury' },
  { name: 'Yarok, the Desecrated',           slug: 'yarok-the-desecrated' },
  { name: 'Golos, Tireless Pilgrim',         slug: 'golos-tireless-pilgrim' },
  { name: 'Kenrith, the Returned King',      slug: 'kenrith-the-returned-king' },
  { name: 'Tymna the Weaver',               slug: 'tymna-the-weaver' },
  { name: 'Thrasios, Triton Hero',           slug: 'thrasios-triton-hero' },
  { name: 'Codie, Vociferous Codex',         slug: 'codie-vociferous-codex' },
  { name: 'Tevesh Szat, Doom of Fools',      slug: 'tevesh-szat-doom-of-fools' },
  { name: 'Kodama of the East Tree',         slug: 'kodama-of-the-east-tree' },
  { name: 'Dargo, the Shipwrecker',          slug: 'dargo-the-shipwrecker' },
  { name: 'Prosper, Tome-Bound',             slug: 'prosper-tome-bound' },
  { name: 'Burakos, Party Leader',           slug: 'burakos-party-leader' },
  { name: 'Lonis, Cryptozoologist',          slug: 'lonis-cryptozoologist' },
  { name: 'Silvar, Danse Macabre',           slug: 'silvar-danse-macabre' },
  { name: 'Pako, Arcane Retriever',          slug: 'pako-arcane-retriever' },
  { name: 'Haldan, Avid Arcanist',           slug: 'haldan-avid-arcanist' },
  { name: 'Magda, Brazen Outlaw',            slug: 'magda-brazen-outlaw' },
  { name: 'Rebbec, Architect of Ascension',  slug: 'rebbec-architect-of-ascension' },
  { name: 'Tormod, the Desecrator',          slug: 'tormod-the-desecrator' },
  { name: 'Blex, Vexing Pest',              slug: 'blex-vexing-pest' },
  { name: 'Strefan, Maurer Progenitor',      slug: 'strefan-maurer-progenitor' },
  { name: 'Runo Stromkirk',                  slug: 'runo-stromkirk' },
  { name: 'Toxrill, the Corrosive',          slug: 'toxrill-the-corrosive' },
  { name: 'Olivia, Crimson Bride',           slug: 'olivia-crimson-bride' },
];

// ── Firebase init ─────────────────────────────────────────────────────────────

const rawSA = process.env.FIREBASE_SERVICE_ACCOUNT;
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

if (!rawSA) { console.error('ERROR: FIREBASE_SERVICE_ACCOUNT not set.'); process.exit(1); }
if (!bucketName) { console.error('ERROR: FIREBASE_STORAGE_BUCKET not set.'); process.exit(1); }

let serviceAccount;
try { serviceAccount = JSON.parse(rawSA); }
catch (e) { console.error('ERROR: Bad FIREBASE_SERVICE_ACCOUNT JSON:', e.message); process.exit(1); }

initializeApp({ credential: cert(serviceAccount), storageBucket: bucketName });
const db = getFirestore();
const storageBucket = getStorage().bucket();

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

// ── Color / strategy inference ────────────────────────────────────────────────

function inferStrategy(name) {
  const n = (name ?? '').toLowerCase();
  if (/burn|aggro|weenie|goblins|affinity|infect/.test(n)) return 'aggro';
  if (/control|stax|prison/.test(n)) return 'control';
  if (/combo|storm|breach|reanimator/.test(n)) return 'combo';
  if (/ramp|landfall|devotion/.test(n)) return 'ramp';
  if (/tribal|elves|merfolk|zombies|vampires|dragons/.test(n)) return 'tribal';
  return 'midrange';
}

const COLOR_MAP = { W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' };
function normalizeColors(colorIdentity) {
  if (!Array.isArray(colorIdentity)) return [];
  return colorIdentity.map((c) => COLOR_MAP[c?.toUpperCase()] ?? c).filter(Boolean);
}

// ── Deck builder (mirrors src/utils/edhrecDeckBuilder.js) ────────────────────
// Kept inline so this script has no local dependencies.

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

const BONUS_HEADERS = new Set(['High Synergy Cards', 'Top Cards', 'Game Changers', 'New Cards']);

const DEFAULT_DIST = {
  creatures: 27, instants: 10, sorceries: 7,
  manaArtifacts: 6, artifacts: 5, enchantments: 5,
  planeswalkers: 2, battles: 0, lands: 37,
};

function buildCommanderDeck(cardlists, averageDeck = {}) {
  const dist = {
    creatures:     averageDeck.creature     ?? DEFAULT_DIST.creatures,
    instants:      averageDeck.instant      ?? DEFAULT_DIST.instants,
    sorceries:     averageDeck.sorcery      ?? DEFAULT_DIST.sorceries,
    manaArtifacts: Math.round((averageDeck.artifact ?? 11) * 0.55),
    artifacts:     Math.round((averageDeck.artifact ?? 11) * 0.45),
    enchantments:  averageDeck.enchantment  ?? DEFAULT_DIST.enchantments,
    planeswalkers: averageDeck.planeswalker ?? DEFAULT_DIST.planeswalkers,
    battles:       averageDeck.battle       ?? DEFAULT_DIST.battles,
    lands:         averageDeck.land         ?? DEFAULT_DIST.lands,
  };
  const total = Object.values(dist).reduce((s, n) => s + n, 0);
  if (total > 99) dist.lands -= (total - 99);

  const pools = {};
  const bonusPool = new Map();

  for (const list of cardlists) {
    const type = HEADER_TYPE_MAP[list.header ?? ''];
    for (const card of list.cardviews ?? []) {
      if (!card?.name) continue;
      if (type) {
        if (!pools[type]) pools[type] = new Map();
        if (!pools[type].has(card.name)) pools[type].set(card.name, card);
      } else if (BONUS_HEADERS.has(list.header)) {
        if (!bonusPool.has(card.name)) bonusPool.set(card.name, card);
      }
    }
  }

  const sorted = {};
  for (const [type, map] of Object.entries(pools)) {
    sorted[type] = [...map.values()].sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));
  }
  const sortedBonus = [...bonusPool.values()].sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  const selected = new Set();
  const keyCards = [];
  const overflow = [];

  function pick(type, section = 'mainboard') {
    const target = dist[type] ?? 0;
    const pool = sorted[type] ?? [];
    let taken = 0;
    for (const card of pool) {
      if (selected.has(card.name)) continue;
      if (taken < target) {
        keyCards.push({ name: card.name, quantity: 1, section, inclusion: card.inclusion ?? 0, synergy: card.synergy ?? 0 });
        selected.add(card.name);
        taken++;
      } else {
        overflow.push(card);
      }
    }
    return target - taken;
  }

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

  for (const card of sortedBonus) {
    if (shortfall <= 0) break;
    if (selected.has(card.name)) continue;
    keyCards.push({ name: card.name, quantity: 1, section: 'mainboard', inclusion: card.inclusion ?? 0, synergy: card.synergy ?? 0 });
    selected.add(card.name);
    shortfall--;
  }

  const swapInsSeen = new Set();
  const swapIns = [];
  for (const card of [...overflow, ...sortedBonus.filter(c => !selected.has(c.name))].sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0))) {
    if (swapInsSeen.has(card.name)) continue;
    swapInsSeen.add(card.name);
    swapIns.push({ name: card.name, quantity: 1, section: 'mainboard', inclusion: card.inclusion ?? 0, synergy: card.synergy ?? 0 });
    if (swapIns.length >= 30) break;
  }

  return { keyCards, swapIns };
}

// ── EDHREC per-commander fetch ────────────────────────────────────────────────

async function fetchCommanderPage(slug) {
  const url = `https://json.edhrec.com/pages/commanders/${slug}.json`;
  try {
    const data = await fetchJson(url);
    const jsonDict = data?.container?.json_dict ?? {};
    const commanderCard = jsonDict?.card ?? {};
    const colors = normalizeColors(commanderCard?.color_identity);
    const numDecks = commanderCard?.num_decks ?? 0;

    const { keyCards, swapIns } = buildCommanderDeck(
      jsonDict?.cardlists ?? [],
      jsonDict?.average ?? {}
    );

    return { keyCards, swapIns, colors, numDecks };
  } catch (e) {
    console.warn(`  Failed "${slug}": ${e.message}`);
    return null;
  }
}

// ── Main sync ─────────────────────────────────────────────────────────────────

async function syncCommander() {
  console.log('\n-- EDHREC Commander Sync --');
  console.log(`  Processing ${TOP_COMMANDERS.length} commanders from seed list...`);

  // Deduplicate seed list by slug
  const seen = new Set();
  const commanders = TOP_COMMANDERS.filter(({ slug }) => {
    if (seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });

  const allDecks = [];
  let fetched = 0;
  let failed = 0;

  for (const commander of commanders) {
    await sleep(400);

    const result = await fetchCommanderPage(commander.slug);
    if (!result || !result.keyCards.length) {
      failed++;
      continue;
    }

    allDecks.push({
      id: `edhrec-${commander.slug}`,
      name: `${commander.name} Commander`,
      commander: commander.name,
      source: 'EDHREC',
      sourceUrl: `https://edhrec.com/commanders/${commander.slug}`,
      format: 'commander',
      strategy: inferStrategy(commander.name),
      colors: result.colors,
      viewCount: result.numDecks,
      owner: null,
      description: `Top recommended cards for ${commander.name} commander decks, based on EDHREC data.`,
      keyCards: result.keyCards,
      swapIns: result.swapIns,
      edhrecSuggestions: [],
      syncedAt: new Date().toISOString(),
    });

    fetched++;
    if (fetched % 25 === 0) {
      console.log(`  ${fetched}/${commanders.length} done`);
    }
  }

  console.log(`  Done: ${fetched} succeeded, ${failed} failed`);
  return allDecks;
}

// ── Write to Firestore ────────────────────────────────────────────────────────

async function writeToFirestore(allDecks) {
  console.log('\n-- Writing to Firestore --');
  const today = new Date().toISOString().split('T')[0];
  const format = 'commander';

  await db.collection('meta_decks').doc(format).set(
    { format, deckCount: allDecks.length, syncDate: today, lastUpdated: new Date() },
    { merge: true }
  );

  for (let i = 0; i < allDecks.length; i += 400) {
    const batch = db.batch();
    for (const deck of allDecks.slice(i, i + 400)) {
      const ref = db.collection('meta_decks').doc(format).collection('decks').doc(deck.id);
      batch.set(ref, { ...deck, syncDate: today });
    }
    await batch.commit();
    console.log(`  Written ${Math.min(i + 400, allDecks.length)}/${allDecks.length}`);
  }

  console.log('  Firestore write complete');
}

// ── Write backup to Storage (optional) ───────────────────────────────────────

async function writeToStorage(allDecks) {
  console.log('\n-- Writing backup to Storage --');
  try {
    const json = JSON.stringify(allDecks);
    console.log(`  Size: ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(1)} MB`);
    const file = storageBucket.file('decks/commander.json');
    await file.save(json, { contentType: 'application/json' });
    await file.makePublic();
    console.log(`  Uploaded to gs://${bucketName}/decks/commander.json`);
  } catch (e) {
    console.warn(`  Storage upload skipped: ${e.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Deck sync started at ${new Date().toISOString()}`);

  const allDecks = await syncCommander();

  if (!allDecks.length) {
    console.error('No decks collected -- aborting.');
    process.exit(1);
  }

  console.log(`\nTotal: ${allDecks.length} commander decks`);
  await writeToFirestore(allDecks);
  await writeToStorage(allDecks);
  console.log('\nDeck sync complete.');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
