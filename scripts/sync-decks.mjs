// scripts/sync-decks.mjs
// Pulls top Commander decks from Archidekt, enriches each with EDHREC
// card suggestions for that commander, and writes to Firestore.
//
// Firestore path: meta_decks/commander/decks/{deckId}
//
// Each stored deck has:
//   keyCards[]        - actual cards from the Archidekt deck
//   edhrecSuggestions[] - EDHREC-recommended cards NOT already in the deck
//   commander         - commander card name
//   source            - 'Archidekt'
//   sourceUrl         - link to the Archidekt deck

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

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

// Archidekt needs a realistic User-Agent; EDHREC works plain
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function fetchJson(url, headers = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', ...headers },
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

function inferColors(name) {
  const n = name.toLowerCase();
  if (/mono[- ]?white/.test(n)) return ['W'];
  if (/mono[- ]?blue/.test(n)) return ['U'];
  if (/mono[- ]?black/.test(n)) return ['B'];
  if (/mono[- ]?red/.test(n)) return ['R'];
  if (/mono[- ]?green/.test(n)) return ['G'];
  const colors = new Set();
  const add = (...cs) => cs.forEach((c) => colors.add(c));
  if (/azorius/.test(n)) add('W','U'); if (/dimir/.test(n)) add('U','B');
  if (/rakdos/.test(n)) add('B','R'); if (/gruul/.test(n)) add('R','G');
  if (/selesnya/.test(n)) add('G','W'); if (/orzhov/.test(n)) add('W','B');
  if (/izzet/.test(n)) add('U','R'); if (/simic/.test(n)) add('G','U');
  if (/boros/.test(n)) add('R','W'); if (/golgari/.test(n)) add('B','G');
  if (/esper/.test(n)) add('W','U','B'); if (/grixis/.test(n)) add('U','B','R');
  if (/jund/.test(n)) add('B','R','G'); if (/naya/.test(n)) add('R','G','W');
  if (/bant/.test(n)) add('G','W','U'); if (/abzan/.test(n)) add('W','B','G');
  if (/jeskai/.test(n)) add('U','R','W'); if (/sultai/.test(n)) add('B','G','U');
  if (/mardu/.test(n)) add('R','W','B'); if (/temur/.test(n)) add('G','U','R');
  if (/domain|5c|five.col/.test(n)) add('W','U','B','R','G');
  if (/white|angel/.test(n)) add('W'); if (/blue|merfolk|wizard/.test(n)) add('U');
  if (/black|zombie|vampire/.test(n)) add('B'); if (/red|burn|goblin/.test(n)) add('R');
  if (/green|elf|ramp|tron/.test(n)) add('G');
  return ['W','U','B','R','G'].filter((c) => colors.has(c));
}

function inferStrategy(name) {
  const n = name.toLowerCase();
  if (/burn|aggro|weenie|goblins|affinity|infect/.test(n)) return 'aggro';
  if (/control|stax|prison/.test(n)) return 'control';
  if (/combo|storm|breach|reanimator/.test(n)) return 'combo';
  if (/ramp|landfall|devotion/.test(n)) return 'ramp';
  if (/tribal|elves|merfolk|zombies|vampires|dragons/.test(n)) return 'tribal';
  return 'midrange';
}

// ── Archidekt scraper ─────────────────────────────────────────────────────────

// Safely extract the commander name from a deck listing result.
// The API may put it in different places depending on endpoint version.
function extractCommanderFromListing(result) {
  // Try commanders array (present in newer API)
  const cmdrs = result.commanders ?? result.featured?.commanders ?? [];
  if (Array.isArray(cmdrs) && cmdrs.length > 0) {
    const name = cmdrs[0]?.oracleCard?.name
      ?? cmdrs[0]?.card?.oracleCard?.name
      ?? cmdrs[0]?.name
      ?? null;
    if (name) return name;
  }
  return null;
}

// Parse a full deck response into a keyCards array.
// Handles both old (categories[].cards[]) and new (cards[]) shapes.
function parseDeckCards(deckData) {
  const cards = [];

  // Shape 1: categories array (pyrchidekt-confirmed structure)
  if (Array.isArray(deckData.categories)) {
    for (const cat of deckData.categories) {
      const catName = (cat.name ?? cat.includedInDeck ?? '').toLowerCase();
      let section = 'mainboard';
      if (catName === 'commander' || catName === 'commanders') section = 'commander';
      else if (catName === 'sideboard') section = 'sideboard';
      else if (catName.includes('land')) section = 'land';

      for (const entry of cat.cards ?? []) {
        const name = entry.card?.oracleCard?.name
          ?? entry.card?.oracle_card?.name
          ?? entry.card?.name
          ?? entry.oracleCard?.name
          ?? null;
        if (name) {
          cards.push({ name, quantity: entry.quantity ?? 1, section });
        }
      }
    }
    if (cards.length >= 10) return cards;
  }

  // Shape 2: flat cards array (some API versions)
  if (Array.isArray(deckData.cards)) {
    for (const entry of deckData.cards) {
      const name = entry.card?.oracleCard?.name
        ?? entry.card?.oracle_card?.name
        ?? entry.card?.name
        ?? null;
      const catName = (entry.categories?.[0]?.name ?? '').toLowerCase();
      let section = 'mainboard';
      if (catName === 'commander') section = 'commander';
      else if (catName === 'sideboard') section = 'sideboard';
      else if (catName.includes('land')) section = 'land';
      if (name) cards.push({ name, quantity: entry.quantity ?? 1, section });
    }
    if (cards.length >= 10) return cards;
  }

  return null;
}

// Fetch the top N commander deck listings from Archidekt, then fetch each
// deck's full card list. Returns: Array<{ id, name, viewCount, commander, keyCards }>.
async function fetchArchidektCommanderDecks(maxDecks = 500) {
  const archidektHeaders = { 'User-Agent': BROWSER_UA };
  const allListings = [];

  console.log('  Fetching deck listings from Archidekt…');

  // Page through results (max pageSize seems to be 100)
  const pageSize = 100;
  let page = 1;
  let total = Infinity;

  while (allListings.length < maxDecks && allListings.length < total) {
    const url = `https://archidekt.com/api/decks/cards/?formats=3&orderBy=-viewCount&pageSize=${pageSize}&page=${page}`;
    let data;
    try {
      data = await fetchJson(url, archidektHeaders);
    } catch (e) {
      console.warn(`  Archidekt listings page ${page} failed: ${e.message}`);
      break;
    }

    // Log shape of first page for debugging
    if (page === 1) {
      total = data?.count ?? data?.total ?? Infinity;
      const sample = data?.results?.[0];
      console.log(`  Total available: ${total}`);
      console.log(`  Sample result keys: ${sample ? Object.keys(sample).join(', ') : '(none)'}`);
      if (sample?.commanders !== undefined) {
        console.log(`  Commander field: commanders[0] =`, JSON.stringify(sample.commanders?.[0])?.slice(0, 120));
      }
    }

    const results = data?.results ?? data?.decks ?? [];
    if (!results.length) break;

    for (const r of results) {
      if (allListings.length >= maxDecks) break;
      allListings.push(r);
    }

    page++;
    await sleep(500);
  }

  console.log(`  Got ${allListings.length} deck listings`);

  // Now fetch each deck's full card list
  const decks = [];
  let fetched = 0;
  let failed = 0;

  for (const listing of allListings) {
    await sleep(600);
    const id = listing.id;
    if (!id) continue;

    try {
      const deckData = await fetchJson(
        `https://archidekt.com/api/decks/${id}/`,
        archidektHeaders
      );

      const keyCards = parseDeckCards(deckData);
      if (!keyCards) {
        // Log the shape of a failing deck once
        if (failed === 0) {
          console.warn(`  Debug: deck ${id} failed parsing. Top-level keys: ${Object.keys(deckData).join(', ')}`);
        }
        failed++;
        continue;
      }

      // Extract commander from the full deck response (more reliable than listing)
      const commanderCard = keyCards.find((c) => c.section === 'commander');
      const commanderName = commanderCard?.name
        ?? extractCommanderFromListing(listing)
        ?? deckData.name; // fallback to deck name

      decks.push({
        id,
        name: listing.name ?? deckData.name ?? `Deck ${id}`,
        viewCount: listing.viewCount ?? 0,
        commander: commanderName,
        keyCards,
        owner: listing.owner?.username ?? listing.createdByUser ?? null,
      });

      fetched++;
      if (fetched % 50 === 0) console.log(`  ${fetched}/${allListings.length} decks fetched`);
    } catch (e) {
      failed++;
    }
  }

  console.log(`  Fetched ${fetched} decks (${failed} failed)`);
  return decks;
}

// ── EDHREC enrichment ─────────────────────────────────────────────────────────

function formatCommanderSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');
}

// Fetch EDHREC recommendations for a commander.
// Returns a Set of card names that EDHREC recommends.
async function fetchEdhrecPool(commanderName) {
  const slug = formatCommanderSlug(commanderName);
  try {
    const data = await fetchJson(`https://json.edhrec.com/pages/commanders/${slug}.json`);
    const dict = data?.container?.json_dict;
    if (!dict) return new Set();

    const pool = new Set();
    for (const list of dict?.cardlists ?? []) {
      for (const card of list?.cardviews ?? []) {
        if (card?.name) pool.add(card.name);
      }
    }
    // Also add the commander itself
    const commanderCardName = dict?.card?.name ?? commanderName;
    pool.add(commanderCardName);

    return pool;
  } catch (_) {
    return new Set();
  }
}

// ── Main sync logic ───────────────────────────────────────────────────────────

async function syncCommander(maxDecks = 500) {
  console.log('\n── Archidekt Commander Sync ──');

  const archidektDecks = await fetchArchidektCommanderDecks(maxDecks);
  if (!archidektDecks.length) {
    console.warn('  No decks fetched from Archidekt — aborting commander sync.');
    return [];
  }

  // Build a map of commander → EDHREC pool (fetch once per unique commander)
  const uniqueCommanders = [...new Set(archidektDecks.map((d) => d.commander).filter(Boolean))];
  console.log(`\n  ${uniqueCommanders.length} unique commanders — fetching EDHREC pools…`);

  const edhrecPools = new Map(); // commanderName → Set<cardName>
  for (let i = 0; i < uniqueCommanders.length; i++) {
    const name = uniqueCommanders[i];
    await sleep(400);
    const pool = await fetchEdhrecPool(name);
    edhrecPools.set(name, pool);
    if ((i + 1) % 50 === 0) console.log(`  EDHREC: ${i + 1}/${uniqueCommanders.length} done`);
  }
  console.log(`  EDHREC pools fetched`);

  // Build the final deck objects
  const allDecks = [];
  for (const deck of archidektDecks) {
    const pool = edhrecPools.get(deck.commander) ?? new Set();
    const deckCardNames = new Set(deck.keyCards.map((c) => c.name));

    // EDHREC suggestions = cards EDHREC recommends that are NOT already in the deck
    const edhrecSuggestions = [...pool]
      .filter((name) => !deckCardNames.has(name))
      .map((name) => ({ name, quantity: 1, section: 'mainboard' }));

    allDecks.push({
      id: `archidekt-${deck.id}`,
      name: deck.name,
      commander: deck.commander ?? null,
      source: 'Archidekt',
      sourceUrl: `https://archidekt.com/decks/${deck.id}`,
      format: 'commander',
      strategy: inferStrategy(deck.commander ?? deck.name),
      colors: inferColors(deck.commander ?? deck.name),
      viewCount: deck.viewCount,
      owner: deck.owner ?? null,
      description: deck.commander
        ? `${deck.commander} commander deck from Archidekt${deck.owner ? ` by ${deck.owner}` : ''}.`
        : `Commander deck from Archidekt.`,
      keyCards: deck.keyCards,
      edhrecSuggestions,
      syncedAt: new Date().toISOString(),
    });
  }

  console.log(`\n  Built ${allDecks.length} enriched commander decks`);
  return allDecks;
}

// ── Write to Firestore ────────────────────────────────────────────────────────

async function writeToFirestore(allDecks) {
  console.log('\n── Writing to Firestore ──');
  const today = new Date().toISOString().split('T')[0];

  // All decks are commander format
  const format = 'commander';
  console.log(`  commander: writing ${allDecks.length} decks…`);

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
  console.log(`  commander: done`);
}

// ── Write to Firebase Storage (optional) ─────────────────────────────────────

async function writeToStorage(allDecks) {
  console.log('\n── Writing backup to Storage ──');
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

  const allDecks = await syncCommander(500);

  if (!allDecks.length) {
    console.error('No decks collected — aborting.');
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
