// src/utils/deckSources/edhrecSource.js
// Pulls Commander deck data from EDHREC's unofficial public JSON API.
// Base: https://json.edhrec.com
// No auth required. CORS-friendly for browser use.

const EDHREC_BASE = 'https://json.edhrec.com';

// Cache fetched EDHREC pages for the session (separate from scryfallApi cache
// since these are larger payloads and change less frequently).
const pageCache = new Map();

async function fetchEDHRECPage(path) {
  if (pageCache.has(path)) return pageCache.get(path);
  try {
    const res = await fetch(`${EDHREC_BASE}${path}`);
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
 * @param {number} limit  How many commanders to return (default 20)
 * @returns {Promise<Array<{ name, slug, colorIdentity, salt, rank }>>}
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
 * Returns cards as { name, quantity, section } — compatible with scoreDeck().
 *
 * @param {string} slug  e.g. "atraxa-praetors-voice"
 * @returns {Promise<{ deckList, colors, description } | null>}
 */
export async function getCommanderDeck(slug) {
  const data = await fetchEDHRECPage(`/pages/commanders/${slug}.json`);
  if (!data) return null;

  const dict = data?.container?.json_dict;
  if (!dict) return null;

  const deckList = [];

  // EDHREC returns card recommendations grouped in cardlists
  for (const list of dict?.cardlists ?? []) {
    const section = (list?.tag ?? '').toLowerCase().includes('land') ? 'land' : 'mainboard';
    for (const card of list?.cardviews ?? []) {
      if (!card?.name) continue;
      deckList.push({
        name: card.name,
        quantity: 1, // Commander decks are 1-of (except basic lands)
        section,
        inclusion: card.inclusion ?? 0,    // % of decks that include this card
        synergy: card.synergy ?? 0,        // EDHREC synergy score
      });
    }
  }

  // Add the commander itself
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
 * Top-level function used by deckSuggestions.js.
 * Returns an array of deck objects ready for scoring.
 *
 * @param {number} count  Number of commander decks to return
 * @returns {Promise<Array>}
 */
export async function fetchEDHRECDecks(count = 10) {
  const commanders = await getTopCommanders(count);
  if (!commanders.length) return [];

  const decks = [];

  for (const commander of commanders) {
    const result = await getCommanderDeck(commander.slug);
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

/** Very rough strategy tag based on color identity. */
function inferStrategy(colors) {
  if (!colors?.length) return 'midrange';
  if (colors.includes('R') && !colors.includes('U') && !colors.includes('B')) return 'aggro';
  if (colors.includes('U') && colors.includes('B')) return 'control';
  if (colors.includes('G') && colors.length <= 2) return 'ramp';
  if (colors.length >= 4) return 'goodstuff';
  return 'midrange';
}
