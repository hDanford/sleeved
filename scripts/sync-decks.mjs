// scripts/sync-decks.mjs
// Scrapes MTGGoldfish (standard, modern, pioneer) + EDHREC (commander)
// Writes to Firestore: meta_decks/{format}/decks/{deckId}
// Writes to Storage:   decks/all-decks.json (backup)

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

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
};

async function fetchHtml(url, extraHeaders = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          ...BASE_HEADERS,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

async function fetchJson(url, extraHeaders = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          ...BASE_HEADERS,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
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
  if (/azorius/.test(n)) add('W','U');
  if (/dimir/.test(n)) add('U','B');
  if (/rakdos/.test(n)) add('B','R');
  if (/gruul/.test(n)) add('R','G');
  if (/selesnya/.test(n)) add('G','W');
  if (/orzhov/.test(n)) add('W','B');
  if (/izzet/.test(n)) add('U','R');
  if (/simic/.test(n)) add('G','U');
  if (/boros/.test(n)) add('R','W');
  if (/golgari/.test(n)) add('B','G');
  if (/esper/.test(n)) add('W','U','B');
  if (/grixis/.test(n)) add('U','B','R');
  if (/jund/.test(n)) add('B','R','G');
  if (/naya/.test(n)) add('R','G','W');
  if (/bant/.test(n)) add('G','W','U');
  if (/abzan/.test(n)) add('W','B','G');
  if (/jeskai/.test(n)) add('U','R','W');
  if (/sultai/.test(n)) add('B','G','U');
  if (/mardu/.test(n)) add('R','W','B');
  if (/temur/.test(n)) add('G','U','R');
  if (/domain|5c|five.col/.test(n)) add('W','U','B','R','G');
  if (/white|angel/.test(n)) add('W');
  if (/blue|merfolk|wizard/.test(n)) add('U');
  if (/black|zombie|vampire/.test(n)) add('B');
  if (/red|burn|goblin/.test(n)) add('R');
  if (/green|elf|ramp|tron/.test(n)) add('G');
  return ['W','U','B','R','G'].filter((c) => colors.has(c));
}

function inferStrategy(name) {
  const n = name.toLowerCase();
  if (/burn|aggro|sligh|zoo|weenie|humans|goblins|affinity|infect/.test(n)) return 'aggro';
  if (/control|draw.go|prison/.test(n)) return 'control';
  if (/combo|storm|breach|reanimator/.test(n)) return 'combo';
  if (/ramp|tron|titan|devotion/.test(n)) return 'ramp';
  if (/tempo|delver|murktide/.test(n)) return 'tempo';
  if (/tribal|elves|merfolk|zombies|vampires/.test(n)) return 'tribal';
  return 'midrange';
}

// ── MTGGoldfish scraper ───────────────────────────────────────────────────────
// MTGGoldfish uses single-quoted HTML attributes, e.g. href='/archetype/burn'
// The regex must match BOTH single and double quotes.

function parseArchetypeLinks(html) {
  const seen = new Map();
  // Match href with single OR double quotes
  const re = /href=['"]\/archetype\/([^'"#?\/\s]{2,})['"][^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const slug = m[1].trim();
    const name = stripHtml(m[2]);
    if (
      name.length >= 3 &&
      name.length <= 80 &&
      !/^(all|budget|format|metagame|more|home)$/i.test(slug)
    ) {
      seen.set(slug, name);
    }
  }
  return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
}

function parseDeckList(html) {
  const cards = [];
  const start = html.indexOf('deck-view-deck-table');
  if (start === -1) return null;
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end + 8);
  let section = 'mainboard';

  for (const row of table.split(/<tr[\s>]/)) {
    if (row.includes('deck-category-header')) {
      const text = row.replace(/<[^>]+>/g, ' ').toLowerCase();
      if (text.includes('sideboard')) { section = 'sideboard'; continue; }
      if (text.includes('land')) { section = 'land'; continue; }
      section = 'mainboard';
      continue;
    }
    const qty = row.match(/deck-col-qty[^>]*>\s*(\d+)/);
    const nameCell = row.match(/deck-col-card[^>]*>([\s\S]*?)(?:<\/td>|$)/);
    if (qty && nameCell) {
      const name = stripHtml(nameCell[1]);
      if (name.length > 1) cards.push({ name, quantity: parseInt(qty[1]), section });
    }
  }
  return cards.length >= 4 ? cards : null;
}

function parseMetaShare(html, slug) {
  // single or double quoted href
  const idx = html.search(new RegExp(`href=['"]\/archetype\/${slug}['"]`));
  if (idx === -1) return 0;
  const m = html.slice(idx, idx + 600).match(/([\d.]+)%/);
  return m ? parseFloat(m[1]) : 0;
}

const MTGG_FORMATS = ['standard', 'modern', 'pioneer'];
const MTGG_MAX_PER_FORMAT = 500;

async function scrapeMTGGoldfish() {
  const all = [];
  console.log('\n── MTGGoldfish ──');

  for (const format of MTGG_FORMATS) {
    console.log(`  [${format}] Fetching metagame page…`);
    let html;
    try {
      html = await fetchHtml(
        `https://www.mtggoldfish.com/metagame/${format}/full`,
        { Referer: 'https://www.mtggoldfish.com/' }
      );
    } catch (e) {
      console.warn(`  [${format}] Failed: ${e.message}`);
      continue;
    }

    const archetypes = parseArchetypeLinks(html).slice(0, MTGG_MAX_PER_FORMAT);
    console.log(`  [${format}] Found ${archetypes.length} archetypes`);

    if (archetypes.length === 0) {
      // Print a snippet that shows the area around "archetype" to debug
      const idx = html.indexOf('archetype');
      console.warn(`  [${format}] Debug — 'archetype' context in HTML:`);
      console.warn(idx === -1 ? '  (word "archetype" not found in page)' : html.slice(Math.max(0, idx - 50), idx + 200));
      continue;
    }

    let count = 0;
    for (const { slug, name } of archetypes) {
      await sleep(800);
      try {
        const deckHtml = await fetchHtml(
          `https://www.mtggoldfish.com/archetype/${slug}`,
          { Referer: `https://www.mtggoldfish.com/metagame/${format}/full` }
        );
        const keyCards = parseDeckList(deckHtml);
        if (!keyCards) continue;
        all.push({
          id: `mtgg-${format}-${slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name,
          source: 'MTGGoldfish',
          sourceUrl: `https://www.mtggoldfish.com/archetype/${slug}`,
          format,
          strategy: inferStrategy(name),
          colors: inferColors(name),
          metaShare: parseMetaShare(html, slug),
          description: `${name} — ${format} archetype from MTGGoldfish.`,
          keyCards,
          syncedAt: new Date().toISOString(),
        });
        count++;
        if (count % 25 === 0) console.log(`  [${format}] ${count}/${archetypes.length} done`);
      } catch (_) { /* skip */ }
    }
    console.log(`  [${format}] Done: ${count} decks`);
  }
  return all;
}

// ── EDHREC scraper ────────────────────────────────────────────────────────────
// json.edhrec.com is behind Cloudflare — use the main site's internal API
// endpoint instead, which is less aggressively protected.

async function scrapeEDHREC(limit = 1000) {
  const all = [];
  console.log('\n── EDHREC ──');

  const edhHeaders = {
    Referer: 'https://edhrec.com/commanders',
    Origin:  'https://edhrec.com',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  };

  // Try both the JSON subdomain and the main site API path
  const COMMANDERS_URLS = [
    'https://json.edhrec.com/pages/commanders.json',
    'https://edhrec.com/api/commanders/',
  ];

  let data = null;
  for (const url of COMMANDERS_URLS) {
    try {
      data = await fetchJson(url, edhHeaders);
      if (data) { console.log(`  Using commanders data from: ${url}`); break; }
    } catch (e) {
      console.warn(`  ${url} failed: ${e.message}`);
    }
  }

  if (!data) {
    console.warn('  Could not fetch EDHREC commanders — skipping.');
    return [];
  }

  // Parse commander list — handle both API shapes
  const commanders = [];
  const cardlists = data?.container?.json_dict?.cardlists   // json.edhrec.com shape
    ?? data?.commanders                                       // possible API shape
    ?? [];

  for (const list of Array.isArray(cardlists) ? cardlists : []) {
    const items = list?.cardviews ?? (Array.isArray(list) ? list : []);
    for (const card of items) {
      if (!card?.name) continue;
      commanders.push({
        name: card.name,
        slug: card.sanitized ?? card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        colorIdentity: card.color_identity ?? [],
        rank: card.rank ?? 9999,
      });
    }
  }

  commanders.sort((a, b) => a.rank - b.rank);
  const target = commanders.slice(0, limit);
  console.log(`  Fetching ${target.length} commander decks…`);

  for (let i = 0; i < target.length; i++) {
    const commander = target[i];
    await sleep(450);
    try {
      let deckData = null;
      for (const base of ['https://json.edhrec.com/pages/commanders/', 'https://edhrec.com/api/commanders/']) {
        try {
          deckData = await fetchJson(`${base}${commander.slug}.json`, edhHeaders);
          if (deckData) break;
        } catch (_) { /* try next */ }
      }
      if (!deckData) continue;

      const dict = deckData?.container?.json_dict;
      if (!dict) continue;

      const keyCards = [];
      for (const list of dict?.cardlists ?? []) {
        const section = (list?.tag ?? '').toLowerCase().includes('land') ? 'land' : 'mainboard';
        for (const card of list?.cardviews ?? []) {
          if (card?.name) keyCards.push({ name: card.name, quantity: 1, section });
        }
      }
      const commanderName = dict?.card?.name ?? commander.name;
      keyCards.unshift({ name: commanderName, quantity: 1, section: 'commander' });
      if (keyCards.length < 10) continue;

      all.push({
        id: `edhrec-${commander.slug}`,
        name: commanderName,
        source: 'EDHREC',
        sourceUrl: `https://edhrec.com/commanders/${commander.slug}`,
        format: 'commander',
        strategy: inferStrategy(commanderName),
        colors: dict?.card?.color_identity ?? commander.colorIdentity ?? [],
        description: dict?.container?.meta?.description ?? `EDHREC recommended build for ${commanderName}.`,
        keyCards,
        syncedAt: new Date().toISOString(),
      });
    } catch (_) { /* skip */ }

    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${target.length} (${all.length} decks)`);
  }

  console.log(`  Done: ${all.length} commander decks`);
  return all;
}

// ── Write to Firestore ────────────────────────────────────────────────────────

async function writeToFirestore(allDecks) {
  console.log('\n── Writing to Firestore ──');
  const today = new Date().toISOString().split('T')[0];
  const byFormat = {};
  for (const deck of allDecks) {
    const f = deck.format ?? 'unknown';
    (byFormat[f] = byFormat[f] ?? []).push(deck);
  }
  for (const [format, decks] of Object.entries(byFormat)) {
    console.log(`  ${format}: writing ${decks.length} decks…`);
    await db.collection('meta_decks').doc(format).set(
      { format, deckCount: decks.length, syncDate: today, lastUpdated: new Date() },
      { merge: true }
    );
    for (let i = 0; i < decks.length; i += 400) {
      const batch = db.batch();
      for (const deck of decks.slice(i, i + 400)) {
        const ref = db.collection('meta_decks').doc(format).collection('decks').doc(deck.id);
        batch.set(ref, { ...deck, syncDate: today });
      }
      await batch.commit();
    }
    console.log(`  ${format}: done`);
  }
}

// ── Write to Firebase Storage ─────────────────────────────────────────────────

async function writeToStorage(allDecks) {
  console.log('\n── Writing backup to Storage ──');
  const json = JSON.stringify(allDecks);
  console.log(`  Size: ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(1)} MB`);
  const file = storageBucket.file('decks/all-decks.json');
  await file.save(json, {
    contentType: 'application/json',
    metadata: { cacheControl: 'public, max-age=86400', generatedAt: new Date().toISOString() },
  });
  await file.makePublic();
  console.log(`  Uploaded to gs://${bucketName}/decks/all-decks.json`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Deck sync started at ${new Date().toISOString()}`);

  const [mtggDecks, edhrecDecks] = await Promise.all([
    scrapeMTGGoldfish(),
    scrapeEDHREC(1000),
  ]);

  const allDecks = [...mtggDecks, ...edhrecDecks];
  console.log(`\nTotal: ${allDecks.length} decks (${mtggDecks.length} MTGGoldfish + ${edhrecDecks.length} EDHREC)`);

  if (allDecks.length === 0) {
    console.error('No decks collected — aborting.');
    process.exit(1);
  }

  await writeToFirestore(allDecks);
  await writeToStorage(allDecks);
  console.log('\nDeck sync complete.');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
