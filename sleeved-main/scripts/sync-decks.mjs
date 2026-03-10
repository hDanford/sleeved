// scripts/sync-decks.mjs
// Scrapes MTGGoldfish (all formats) + EDHREC (commander) and uploads
// a combined decks/all-decks.json to Firebase Storage.
//
// Runs nightly via GitHub Actions. No CORS issues server-side.
//
// Required env vars (same as sync-scryfall.mjs):
//   FIREBASE_SERVICE_ACCOUNT
//   FIREBASE_STORAGE_BUCKET

import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// ---------------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const bucket = process.env.FIREBASE_STORAGE_BUCKET;
if (!serviceAccount || !bucket) { console.error('Missing env vars.'); process.exit(1); }
initializeApp({ credential: cert(serviceAccount), storageBucket: bucket });
const storage = getStorage().bucket();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Sleeved/1.0; +https://github.com)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

async function fetchJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Sleeved/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

// Infer MTG color identity from common archetype/commander name keywords
function inferColors(name) {
  const n = name.toLowerCase();
  const colors = [];
  if (n.includes('white') || n.includes('azorius') || n.includes('orzhov') || n.includes('boros') || n.includes('selesnya') || n.includes('esper') || n.includes('abzan') || n.includes('jeskai') || n.includes('mardu') || n.includes('naya') || n.includes('domain') || n.includes('5c') || n.includes('five')) colors.push('W');
  if (n.includes('blue') || n.includes('azorius') || n.includes('dimir') || n.includes('izzet') || n.includes('simic') || n.includes('esper') || n.includes('grixis') || n.includes('sultai') || n.includes('jeskai') || n.includes('bant') || n.includes('temur') || n.includes('domain') || n.includes('5c') || n.includes('five')) colors.push('U');
  if (n.includes('black') || n.includes('dimir') || n.includes('rakdos') || n.includes('orzhov') || n.includes('golgari') || n.includes('esper') || n.includes('grixis') || n.includes('sultai') || n.includes('abzan') || n.includes('mardu') || n.includes('jund') || n.includes('5c') || n.includes('five')) colors.push('B');
  if (n.includes('red') || n.includes('rakdos') || n.includes('izzet') || n.includes('boros') || n.includes('gruul') || n.includes('grixis') || n.includes('temur') || n.includes('jeskai') || n.includes('mardu') || n.includes('jund') || n.includes('naya') || n.includes('domain') || n.includes('5c') || n.includes('five') || n.includes('burn') || n.includes('goblin')) colors.push('R');
  if (n.includes('green') || n.includes('selesnya') || n.includes('simic') || n.includes('golgari') || n.includes('gruul') || n.includes('bant') || n.includes('sultai') || n.includes('temur') || n.includes('abzan') || n.includes('naya') || n.includes('jund') || n.includes('domain') || n.includes('5c') || n.includes('five') || n.includes('ramp') || n.includes('elves')) colors.push('G');
  // Mono colors
  if (n.includes('mono-w') || n.includes('mono white')) return ['W'];
  if (n.includes('mono-u') || n.includes('mono blue')) return ['U'];
  if (n.includes('mono-b') || n.includes('mono black')) return ['B'];
  if (n.includes('mono-r') || n.includes('mono red')) return ['R'];
  if (n.includes('mono-g') || n.includes('mono green')) return ['G'];
  return [...new Set(colors)];
}

function inferStrategy(name) {
  const n = name.toLowerCase();
  if (n.includes('burn') || n.includes('aggro') || n.includes('goblin') || n.includes('sligh') || n.includes('weenie') || n.includes('zoo') || n.includes('humans')) return 'aggro';
  if (n.includes('control') || n.includes('draw-go') || n.includes('prison')) return 'control';
  if (n.includes('combo') || n.includes('storm') || n.includes('breach') || n.includes('reanimator') || n.includes('belcher') || n.includes('druid')) return 'combo';
  if (n.includes('ramp') || n.includes('tron') || n.includes('titan') || n.includes('devotion') || n.includes('big')) return 'ramp';
  return 'midrange';
}

// ---------------------------------------------------------------------------
// MTGGoldfish scraper
// ---------------------------------------------------------------------------

function parseArchetypeLinks(html) {
  const results = new Map();
  // Extract all /archetype/ links with their text
  for (const m of html.matchAll(/href="\/archetype\/([^"#?]+)"[^>]*>([^<]+)</g)) {
    const slug = m[1].trim();
    const name = m[2].trim();
    // Filter out navigation/UI links (too short or clearly not deck names)
    if (name.length > 3 && !name.includes('%') && !slug.includes('/')) {
      results.set(slug, name);
    }
  }
  return [...results.entries()].map(([slug, name]) => ({ slug, name }));
}

function parseDeckTable(html) {
  const cards = [];
  // Find the deck table section
  const tableStart = html.indexOf('deck-view-deck-table');
  if (tableStart === -1) return null;

  const tableHtml = html.slice(tableStart, html.indexOf('</table>', tableStart) + 8);
  let section = 'mainboard';

  // Split by rows
  const rows = tableHtml.split(/<tr[\s>]/);
  for (const row of rows) {
    // Section header
    if (row.includes('deck-category-header')) {
      const text = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.includes('sideboard')) { section = 'sideboard'; continue; }
      if (text.includes('land')) { section = 'land'; continue; }
      section = 'mainboard';
      continue;
    }
    // Card row
    const qtyMatch = row.match(/deck-col-qty[^>]*>\s*(\d+)/);
    const nameMatch = row.match(/deck-col-card[^>]*>[\s\S]*?href="[^"]*">([^<]+)</);
    if (qtyMatch && nameMatch) {
      cards.push({ name: nameMatch[1].trim(), quantity: parseInt(qtyMatch[1]), section });
    }
  }
  return cards.length >= 4 ? cards : null;
}

function parseMetaShare(html, slug) {
  // Try to find a percentage near the archetype link
  const idx = html.indexOf(`/archetype/${slug}`);
  if (idx === -1) return 0;
  const nearby = html.slice(idx, idx + 400);
  const m = nearby.match(/([\d.]+)%/);
  return m ? parseFloat(m[1]) : 0;
}

const MTGG_FORMATS = ['standard', 'modern', 'pioneer', 'legacy', 'pauper', 'commander'];

async function scrapeMTGGoldfish() {
  const allDecks = [];
  console.log('\n── MTGGoldfish ──');

  for (const format of MTGG_FORMATS) {
    console.log(`  Fetching ${format} metagame…`);
    let metagameHtml;
    try {
      metagameHtml = await fetchHtml(`https://www.mtggoldfish.com/metagame/${format}/full`);
    } catch (e) {
      console.warn(`  ✗ Failed to fetch ${format} metagame: ${e.message}`);
      continue;
    }

    const archetypes = parseArchetypeLinks(metagameHtml);
    console.log(`  Found ${archetypes.length} archetypes in ${format}`);

    for (const { slug, name } of archetypes.slice(0, 60)) {
      await sleep(800); // be polite
      try {
        const deckHtml = await fetchHtml(`https://www.mtggoldfish.com/archetype/${slug}`);
        const keyCards = parseDeckTable(deckHtml);
        if (!keyCards) { console.log(`    ✗ No decklist: ${name}`); continue; }

        const metaShare = parseMetaShare(metagameHtml, slug);
        allDecks.push({
          id: `mtgg-${format}-${slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name,
          source: 'MTGGoldfish',
          sourceUrl: `https://www.mtggoldfish.com/archetype/${slug}`,
          format,
          strategy: inferStrategy(name),
          colors: inferColors(name),
          metaShare,
          description: `${name} — ${format.charAt(0).toUpperCase() + format.slice(1)} archetype from MTGGoldfish.`,
          keyCards,
        });
        console.log(`    ✓ ${name} (${keyCards.length} cards)`);
      } catch (e) {
        console.warn(`    ✗ ${name}: ${e.message}`);
      }
    }
  }

  return allDecks;
}

// ---------------------------------------------------------------------------
// EDHREC scraper (server-side — no CORS)
// ---------------------------------------------------------------------------

function parseEDHRECCommanders(data) {
  const commanders = [];
  const cardlists = data?.container?.json_dict?.cardlists ?? [];
  for (const list of cardlists) {
    for (const card of list?.cardviews ?? []) {
      if (!card?.name) continue;
      commanders.push({
        name: card.name,
        slug: card.sanitized ?? card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        colorIdentity: card.color_identity ?? [],
        rank: card.rank ?? 9999,
      });
    }
  }
  return commanders.sort((a, b) => a.rank - b.rank);
}

function parseEDHRECDeck(data, commander) {
  const dict = data?.container?.json_dict;
  if (!dict) return null;

  const keyCards = [];
  for (const list of dict?.cardlists ?? []) {
    const isLand = (list?.tag ?? '').toLowerCase().includes('land');
    const section = isLand ? 'land' : 'mainboard';
    for (const card of list?.cardviews ?? []) {
      if (!card?.name) continue;
      keyCards.push({ name: card.name, quantity: 1, section });
    }
  }

  // Add the commander itself
  const commanderName = dict?.card?.name ?? commander.name;
  keyCards.unshift({ name: commanderName, quantity: 1, section: 'commander' });

  if (keyCards.length < 10) return null;

  const colors = dict?.card?.color_identity ?? commander.colorIdentity ?? [];
  const description = dict?.container?.meta?.description ?? `EDHREC recommended build for ${commanderName}.`;

  return {
    id: `edhrec-${commander.slug}`,
    name: commanderName,
    source: 'EDHREC',
    sourceUrl: `https://edhrec.com/commanders/${commander.slug}`,
    format: 'commander',
    strategy: inferStrategy(commanderName),
    colors,
    description,
    keyCards,
  };
}

async function scrapeEDHREC(limit = 500) {
  const allDecks = [];
  console.log('\n── EDHREC ──');

  let commandersData;
  try {
    commandersData = await fetchJson('https://json.edhrec.com/pages/commanders.json');
  } catch (e) {
    console.warn(`  ✗ Failed to fetch commanders list: ${e.message}`);
    return [];
  }

  const commanders = parseEDHRECCommanders(commandersData).slice(0, limit);
  console.log(`  Fetching ${commanders.length} commander decks…`);

  for (let i = 0; i < commanders.length; i++) {
    const commander = commanders[i];
    await sleep(400);
    try {
      const deckData = await fetchJson(
        `https://json.edhrec.com/pages/commanders/${commander.slug}.json`
      );
      const deck = parseEDHRECDeck(deckData, commander);
      if (!deck) { console.log(`    ✗ No deck: ${commander.name}`); continue; }
      allDecks.push(deck);
      if ((i + 1) % 50 === 0) console.log(`  … ${i + 1}/${commanders.length} done (${allDecks.length} decks)`);
    } catch (e) {
      console.warn(`    ✗ ${commander.name}: ${e.message}`);
    }
  }

  console.log(`  ✓ ${allDecks.length} commander decks collected`);
  return allDecks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('Starting deck sync…');
const [mtggDecks, edhrecDecks] = await Promise.all([
  scrapeMTGGoldfish(),
  scrapeEDHREC(500),
]);

const allDecks = [...mtggDecks, ...edhrecDecks];
console.log(`\nTotal decks: ${allDecks.length} (${mtggDecks.length} MTGGoldfish + ${edhrecDecks.length} EDHREC)`);

if (allDecks.length === 0) {
  console.error('No decks collected — aborting upload.');
  process.exit(1);
}

const json = JSON.stringify(allDecks);
const mb = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
console.log(`Payload size: ${mb} MB`);

const destPath = 'decks/all-decks.json';
const file = storage.file(destPath);
await file.save(json, {
  contentType: 'application/json',
  metadata: { cacheControl: 'public, max-age=86400', generatedAt: new Date().toISOString() },
});
await file.makePublic();
console.log(`\n✓ Uploaded to gs://${bucket}/${destPath}`);
console.log(`Public URL: https://storage.googleapis.com/${bucket}/${destPath}`);
