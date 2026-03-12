// scripts/sync-decks.mjs
// Pulls top Commander data from EDHREC's static JSON files and writes to Firestore.
//
// Strategy:
//   1. Fetch https://json.edhrec.com/pages/commanders.json
//      → find the cardlist with tag "topcommanders" → list of commander slugs
//   2. For each commander slug, fetch
//      https://json.edhrec.com/pages/commanders/{slug}.json
//      → extract recommended cards (keyCards) + commander metadata
//   3. Write each result as a deck doc to Firestore at:
//      meta_decks/commander/decks/{deckId}
//
// Required GitHub secrets:
//   FIREBASE_SERVICE_ACCOUNT  — contents of your Firebase service account JSON
//   FIREBASE_STORAGE_BUCKET   — e.g. "your-project.firebasestorage.app"

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

// Convert EDHREC color_identity strings to W/U/B/R/G symbols
const COLOR_MAP = { W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' };
function normalizeColors(colorIdentity) {
  if (!Array.isArray(colorIdentity)) return [];
  return colorIdentity.map((c) => COLOR_MAP[c?.toUpperCase()] ?? c).filter(Boolean);
}

// ── EDHREC fetching ───────────────────────────────────────────────────────────

// Fetch the top commanders list from EDHREC.
// Returns Array<{ name, slug, numDecks }>
async function fetchTopCommanders(limit = 100) {
  console.log('  Fetching top commanders from EDHREC...');
  const data = await fetchJson('https://json.edhrec.com/pages/commanders.json');

  const cardlists = data?.container?.json_dict?.cardlists ?? [];
  const topList = cardlists.find((cl) => cl.tag === 'topcommanders');

  if (!topList) {
    // Fallback: use first cardlist if tag structure differs
    console.warn('  Warning: no "topcommanders" tag found, using first cardlist');
    const fallback = cardlists[0]?.cardviews ?? [];
    return fallback.slice(0, limit).map((c) => ({
      name: c.name,
      slug: c.sanitized ?? c.sanitized_wo,
      numDecks: c.num_decks ?? 0,
    }));
  }

  return topList.cardviews.slice(0, limit).map((c) => ({
    name: c.name,
    slug: c.sanitized ?? c.sanitized_wo,
    numDecks: c.num_decks ?? 0,
  }));
}

// Fetch a single commander's EDHREC page and extract their recommended cards.
// Returns { keyCards, colors, numDecks } or null on failure.
async function fetchCommanderPage(slug) {
  const url = `https://json.edhrec.com/pages/commanders/${slug}.json`;
  try {
    const data = await fetchJson(url);
    const jsonDict = data?.container?.json_dict ?? {};
    const cardlists = jsonDict?.cardlists ?? [];

    // Commander's own metadata (color identity etc.)
    const commanderCard = jsonDict?.card ?? {};
    const colors = normalizeColors(commanderCard?.color_identity);
    const numDecks = commanderCard?.num_decks ?? 0;

    // Collect all recommended cards across every cardlist section
    // (High Synergy, Creatures, Instants, Lands, etc.)
    const keyCards = [];
    const seen = new Set();

    for (const list of cardlists) {
      for (const card of list?.cardviews ?? []) {
        if (!card?.name || seen.has(card.name)) continue;
        seen.add(card.name);
        keyCards.push({
          name: card.name,
          quantity: 1,
          section: 'mainboard',
          inclusion: card.inclusion ?? 0,
          synergy: card.synergy ?? 0,
        });
      }
    }

    return { keyCards, colors, numDecks };
  } catch (e) {
    console.warn(`  Failed to fetch commander page for "${slug}": ${e.message}`);
    return null;
  }
}

// ── Main sync ─────────────────────────────────────────────────────────────────

async function syncCommander(limit = 100) {
  console.log('\n-- EDHREC Commander Sync --');

  const topCommanders = await fetchTopCommanders(limit);
  console.log(`  Found ${topCommanders.length} top commanders`);

  if (!topCommanders.length) {
    console.error('  No commanders found -- aborting.');
    return [];
  }

  const allDecks = [];
  let fetched = 0;
  let failed = 0;

  for (const commander of topCommanders) {
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
      viewCount: result.numDecks ?? commander.numDecks,
      owner: null,
      description: `Top recommended cards for ${commander.name} commander decks, based on EDHREC data.`,
      keyCards: result.keyCards,
      edhrecSuggestions: [],
      syncedAt: new Date().toISOString(),
    });

    fetched++;
    if (fetched % 25 === 0) {
      console.log(`  ${fetched}/${topCommanders.length} commanders fetched`);
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

  const allDecks = await syncCommander(100);

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
