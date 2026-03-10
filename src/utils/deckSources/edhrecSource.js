// src/utils/deckSources/edhrecSource.js
// Pulls Commander deck data from EDHREC's unofficial public JSON API.
// Base: https://json.edhrec.com
// No auth required. CORS-friendly for browser use.

const EDHREC_BASE = 'https://json.edhrec.com';
const FETCH_TIMEOUT_MS = 6000; // give up on a single EDHREC request after 6s

const pageCache = new Map();

/** Fetch with a timeout so a stalled request doesn't hang forever. */
async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEDHRECPage(path) {
  if (pageCache.has(path)) return pageCache.get(path);
  try {
    const res = await fetchWithTimeout(`${EDHREC_BASE}${path}`);
    if (!res.ok) return null;
    const data = await res.json();
    pageCache.set(path, data);
    return data;
  } catch {
    return null;
  }
}

/**
 * getTopCommanders
 * Returns a list of popular commanders from EDHREC's top commanders page.
 */
export async function getTopCommanders(limit = 20) {
  const data = await fetchEDHRECPage('/pages/commanders.json');
  if (!data) return [];

  const cardlists = data?.container?.json_dict?.cardlists ?? [];
  const commanders = [];

  for (const list of cardlists) {
    for (const card of list?.cardviews ?? []) {
      if (!card?.name) continue;
      commanders.push({
        name: card.name,
        slug: card.sanitized ?? card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        colorIdentity: card.color_identity ?? [],
        salt: card.salt ?? 0,
        rank: card.rank ?? 9999,
      });
      if (commanders.length >= limit) break;
    }
    if (commanders.length >= limit) break;
  }

  return commanders;
}

/**
 * getCommanderDeck
 * Fetches the recommended decklist for a specific commander by slug.
 */
export async function getCommanderDeck(slug) {
  const data = await fetchEDHRECPage(`/pages/commanders/${slug}.json`);
  if (!data) return null;

  const dict = data?.container?.json_dict;
  if (!dict) return null;

  const deckList = [];

  for (const list of dict?.cardlists ?? []) {
    const section = (list?.tag ?? '').toLowerCase().includes('land') ? 'land' : 'mainboard';
    for (const card of list?.cardviews ?? []) {
      if (!card?.name) continue;
      deckList.push({
        name: card.name,
        quantity: 1,
        section,
        inclusion: card.inclusion ?? 0,
        synergy: card.synergy ?? 0,
      });
    }
  }

  const commanderName = dict?.card?.name;
  if (commanderName) {
    deckList.unshift({ name: commanderName, quantity: 1, section: 'commander' });
  }

  const colors = dict?.card?.color_identity ?? [];
  const description = dict?.container?.meta?.description ?? '';

  return { deckList, colors, description };
}

/**
 * fetchEDHRECDecks
 * Fetches all commander deck pages in parallel with Promise.allSettled
 * so a single failing/slow page doesn't block the rest.
 */
export async function fetchEDHRECDecks(count = 10) {
  const commanders = await getTopCommanders(count);
  if (!commanders.length) return [];

  // Fetch all commander pages in parallel
  const settled = await Promise.allSettled(
    commanders.map((commander) =>
      getCommanderDeck(commander.slug).then((result) => ({ commander, result }))
    )
  );

  const decks = [];
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    const { commander, result } = outcome.value;
    if (!result) continue;

    decks.push({
      id: `edhrec-${commander.slug}`,
      name: commander.name,
      source: 'EDHREC',
      format: 'commander',
      strategy: inferStrategy(result.colors),
      colors: result.colors,
      description: result.description || `EDHREC recommended build for ${commander.name}.`,
      keyCards: result.deckList,
    });
  }

  return decks;
}

function inferStrategy(colors) {
  if (!colors?.length) return 'midrange';
  if (colors.includes('R') && !colors.includes('U') && !colors.includes('B')) return 'aggro';
  if (colors.includes('U') && colors.includes('B')) return 'control';
  if (colors.includes('G') && colors.length <= 2) return 'ramp';
  if (colors.length >= 4) return 'goodstuff';
  return 'midrange';
}
