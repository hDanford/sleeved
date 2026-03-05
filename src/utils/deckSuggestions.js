// src/utils/deckSuggestions.js
// Generates a scored, ranked list of deck suggestions.
//
// Sources (by format):
//   commander          → EDHREC (live)
//   standard/modern/pioneer → MTGGoldfish proxy (placeholder) + Scryfall archetypes (live fallback)
//
// Pipeline:
//   1. Fetch candidate decks from relevant sources
//   2. Resolve full card data via scryfallApi (cached + rate-limited)
//   3. Score each deck via deckScoring
//   4. Sort by weighted main score

import { resolveCardNames } from './scryfallApi';
import { scoreDeck, calculateMainScore, DEFAULT_WEIGHTS } from './deckScoring';
import { fetchEDHRECDecks } from './deckSources/edhrecSource';
import { fetchMTGGoldfishDecks, isMTGGoldfishAvailable } from './deckSources/mtgGoldfishSource';
import { fetchScryfallArchetypeDecks } from './deckSources/scryfallSource';

export { DEFAULT_WEIGHTS };

// ---------------------------------------------------------------------------
// Source orchestration
// ---------------------------------------------------------------------------

/**
 * getCandidateDecks
 * Fetches raw (unscored) deck candidates for the given formats.
 *
 * @param {string[]} formats  e.g. ['commander', 'standard', 'modern']
 * @param {number}   countPerFormat  Target deck count per format
 * @returns {Promise<Array>}
 */
export async function getCandidateDecks(formats, countPerFormat = 5) {
  const allDecks = [];

  for (const format of formats) {
    if (format === 'commander') {
      const edhrec = await fetchEDHRECDecks(countPerFormat);
      allDecks.push(...edhrec);
      continue;
    }

    // For 60-card formats: try MTGGoldfish proxy first, fall back to Scryfall archetypes
    if (isMTGGoldfishAvailable()) {
      const goldfish = await fetchMTGGoldfishDecks(format, countPerFormat);
      if (goldfish.length > 0) {
        allDecks.push(...goldfish);
        continue;
      }
    }

    // MTGGoldfish not yet available — use Scryfall-built archetypes
    const scryfall = await fetchScryfallArchetypeDecks(format);
    allDecks.push(...scryfall.slice(0, countPerFormat));
  }

  // Deduplicate by id
  const seen = new Set();
  return allDecks.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Scoring pipeline
// ---------------------------------------------------------------------------

/**
 * generateSuggestions
 *
 * @param {object}   params
 * @param {Map}      params.userCollection     Map<cardNameLower, qty>
 * @param {Array}    params.userDeckProfiles   buildDeckProfile() results from existing decks
 * @param {object}   params.weights            Weight overrides
 * @param {string[]} params.formats            Formats to include (default: all four)
 * @param {number}   params.countPerFormat     Candidates per format (default 5)
 * @param {function} params.onProgress         (current, total) => void
 * @returns {Promise<Array>} Scored and sorted deck suggestions
 */
export async function generateSuggestions({
  userCollection,
  userDeckProfiles = [],
  weights = DEFAULT_WEIGHTS,
  formats = ['commander', 'standard', 'modern', 'pioneer'],
  countPerFormat = 5,
  onProgress,
}) {
  // 1. Fetch candidates from all sources
  const candidates = await getCandidateDecks(formats, countPerFormat);
  const total = candidates.length;
  const results = [];

  // 2. Resolve + score each deck
  for (let i = 0; i < candidates.length; i++) {
    const deck = candidates[i];
    onProgress?.(i, total);

    try {
      const cardNames = deck.keyCards
        .filter((c) => c.section !== 'sideboard')
        .map((c) => c.name);

      const resolvedCards = await resolveCardNames(cardNames);

      const deckList = deck.keyCards.map((c) => ({
        ...c,
        section: c.section ?? 'mainboard',
      }));

      const scored = scoreDeck({
        deckList,
        resolvedCards,
        userCollection,
        userDeckProfiles,
        weights,
      });

      results.push({
        ...deck,
        ...scored,
        resolvedCards,
      });
    } catch (err) {
      console.warn(`[deckSuggestions] Failed to score "${deck.name}":`, err);
    }
  }

  onProgress?.(total, total);

  // 3. Sort by mainScore descending
  return results.sort((a, b) => b.mainScore - a.mainScore);
}

// ---------------------------------------------------------------------------
// Instant re-score (no API calls)
// ---------------------------------------------------------------------------

/**
 * rescore
 * Re-apply new weights to already-fetched suggestions without hitting any API.
 *
 * @param {Array}  suggestions  Output of generateSuggestions()
 * @param {object} weights      New weight map
 * @returns {Array} Re-sorted suggestions
 */
export function rescore(suggestions, weights) {
  return suggestions
    .map((s) => ({
      ...s,
      mainScore: calculateMainScore(s.subscores, weights),
    }))
    .sort((a, b) => b.mainScore - a.mainScore);
}
