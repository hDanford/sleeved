// src/utils/deckSuggestions.js
// Generates a scored, ranked list of deck suggestions.
//
// Sources (by format):
//   commander               → EDHREC (live)
//   standard/modern/pioneer → MTGGoldfish proxy (placeholder) + Scryfall archetypes (live fallback)
//
// Pipeline:
//   1. Fetch candidates from all sources in parallel
//   2. Resolve + score all decks in parallel
//   3. Sort by weighted main score

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
 * Fetches raw (unscored) deck candidates for all formats in parallel.
 */
export async function getCandidateDecks(formats, countPerFormat = 5) {
  // Fetch all formats simultaneously
  const perFormat = await Promise.all(
    formats.map(async (format) => {
      if (format === 'commander') {
        return fetchEDHRECDecks(countPerFormat);
      }

      if (isMTGGoldfishAvailable()) {
        const goldfish = await fetchMTGGoldfishDecks(format, countPerFormat);
        if (goldfish.length > 0) return goldfish;
      }

      const scryfall = await fetchScryfallArchetypeDecks(format);
      return scryfall.slice(0, countPerFormat);
    })
  );

  // Flatten and deduplicate by id
  const seen = new Set();
  return perFormat.flat().filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Scoring pipeline
// ---------------------------------------------------------------------------

async function scoreSingleDeck({ deck, userCollection, userDeckProfiles, weights }) {
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

  return { ...deck, ...scored, resolvedCards };
}

/**
 * generateSuggestions
 *
 * @param {object}   params
 * @param {Map}      params.userCollection     Map<cardNameLower, qty>
 * @param {Array}    params.userDeckProfiles   buildDeckProfile() results from existing decks
 * @param {object}   params.weights            Weight overrides
 * @param {string[]} params.formats            Formats to include
 * @param {number}   params.countPerFormat     Candidates per format
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
  // 1. Fetch all candidates in parallel
  const candidates = await getCandidateDecks(formats, countPerFormat);
  const total = candidates.length;
  let completed = 0;

  onProgress?.(0, total);

  // 2. Score all decks in parallel, reporting progress as each one finishes
  const settled = await Promise.allSettled(
    candidates.map((deck) =>
      scoreSingleDeck({ deck, userCollection, userDeckProfiles, weights }).then((result) => {
        onProgress?.(++completed, total);
        return result;
      })
    )
  );

  const results = settled
    .filter((s) => s.status === 'fulfilled')
    .map((s) => s.value);

  // Log any failures without crashing
  settled
    .filter((s) => s.status === 'rejected')
    .forEach((s) => console.warn('[deckSuggestions] Scoring failed:', s.reason));

  // 3. Sort by mainScore descending
  return results.sort((a, b) => b.mainScore - a.mainScore);
}

// ---------------------------------------------------------------------------
// Instant re-score (no API calls)
// ---------------------------------------------------------------------------

/**
 * rescore
 * Re-apply new weights to already-fetched suggestions without hitting any API.
 */
export function rescore(suggestions, weights) {
  return suggestions
    .map((s) => ({
      ...s,
      mainScore: calculateMainScore(s.subscores, weights),
    }))
    .sort((a, b) => b.mainScore - a.mainScore);
}
