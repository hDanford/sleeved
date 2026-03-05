// src/utils/deckSources/mtgGoldfishSource.js
// Placeholder for MTGGoldfish metagame deck data.
//
// MTGGoldfish does not have a public API and their metagame pages require
// server-side scraping due to CORS restrictions. This module is a stub that
// returns an empty result until a backend proxy is wired up.
//
// TODO: Implement a backend proxy endpoint (e.g. /api/mtggoldfish/metagame?format=standard)
//       that scrapes https://www.mtggoldfish.com/metagame/{format}/full and returns
//       JSON in the shape below. Then replace fetchMTGGoldfishDecks() with a real fetch
//       to that proxy.
//
// Expected proxy response shape:
// [
//   {
//     id: string,           // e.g. "mtgg-4-color-omnath"
//     name: string,         // e.g. "4-Color Omnath"
//     source: "MTGGoldfish",
//     format: string,       // "standard" | "modern" | "pioneer"
//     strategy: string,     // "aggro" | "control" | "midrange" | "combo" | "ramp"
//     colors: string[],     // e.g. ["W","U","R","G"]
//     metaShare: number,    // % of metagame e.g. 12.4
//     description: string,
//     keyCards: [
//       { name: string, quantity: number, section: "mainboard"|"sideboard" }
//     ]
//   }
// ]

const PROXY_URL = '/api/mtggoldfish/metagame'; // Set this when your proxy is ready

const SUPPORTED_FORMATS = ['standard', 'modern', 'pioneer'];

/**
 * fetchMTGGoldfishDecks
 * @param {string} format   "standard" | "modern" | "pioneer"
 * @param {number} limit    Max decks to return
 * @returns {Promise<Array>}
 */
export async function fetchMTGGoldfishDecks(format = 'standard', limit = 10) {
  if (!SUPPORTED_FORMATS.includes(format)) return [];

  // TODO: Remove this guard and uncomment the fetch below once proxy is live.
  console.info(
    `[MTGGoldfish] Proxy not yet implemented for format "${format}". ` +
    `Set up ${PROXY_URL}?format=${format} to enable live metagame data.`
  );
  return [];

  // --- Uncomment when proxy is ready ---
  // try {
  //   const res = await fetch(`${PROXY_URL}?format=${format}&limit=${limit}`);
  //   if (!res.ok) return [];
  //   const decks = await res.json();
  //   return decks.map((d) => ({ ...d, source: 'MTGGoldfish' }));
  // } catch (err) {
  //   console.warn('[MTGGoldfish] Proxy fetch failed:', err);
  //   return [];
  // }
}

/**
 * isMTGGoldfishAvailable
 * Quick check the UI can use to show/hide a "Powered by MTGGoldfish" badge.
 */
export function isMTGGoldfishAvailable() {
  return false; // Flip to true once proxy is live
}
