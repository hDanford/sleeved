// src/utils/deckSuggestions.js

import { resolveCardNames } from './scryfallApi';
import { scoreDeck, calculateMainScore, DEFAULT_WEIGHTS } from './deckScoring';
import { fetchEDHRECDecks } from './deckSources/edhrecSource';
import { fetchMTGGoldfishDecks, isMTGGoldfishAvailable } from './deckSources/mtgGoldfishSource';
import { fetchScryfallArchetypeDecks } from './deckSources/scryfallSource';

export { DEFAULT_WEIGHTS };

/**
 * getCandidateDecks
 * Each source is individually wrapped in try/catch so one failing source
 * never kills the others.
 */
export async function getCandidateDecks(formats, countPerFormat = 5) {
  const perFormat = await Promise.allSettled(
    formats.map(async (format) => {
      if (format === 'commander') {
        return fetchEDHRECDecks(countPerFormat);
      }

      if (isMTGGoldfishAvailable()) {
        try {
          const goldfish = await fetchMTGGoldfishDecks(format, countPerFormat);
          if (goldfish.length > 0) return goldfish;
        } catch {
          // fall through to Scryfall
        }
      }

      return fetchScryfallArchetypeDecks(format).then((d) => d.slice(0, countPerFormat));
    })
  );

  // Collect fulfilled results, log failures
  const all = [];
  for (const outcome of perFormat) {
    if (outcome.status === 'fulfilled') {
      all.push(...(outcome.value ?? []));
    } else {
      console.warn('[deckSuggestions] Source fetch failed:', outcome.reason);
    }
  }

  // Deduplicate by id
  const seen = new Set();
  return all.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

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

export async function generateSuggestions({
  userCollection,
  userDeckProfiles = [],
  weights = DEFAULT_WEIGHTS,
  formats = ['commander', 'standard', 'modern', 'pioneer'],
  countPerFormat = 5,
  onProgress,
}) {
  const candidates = await getCandidateDecks(formats, countPerFormat);
  const total = candidates.length;
  let completed = 0;

  onProgress?.(0, total);

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

  settled
    .filter((s) => s.status === 'rejected')
    .forEach((s) => console.warn('[deckSuggestions] Scoring failed:', s.reason));

  return results.sort((a, b) => b.mainScore - a.mainScore);
}

export function rescore(suggestions, weights) {
  return suggestions
    .map((s) => ({
      ...s,
      mainScore: calculateMainScore(s.subscores, weights),
    }))
    .sort((a, b) => b.mainScore - a.mainScore);
}
