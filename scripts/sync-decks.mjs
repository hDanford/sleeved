// src/utils/deckSuggestions.js
// Loads all decks from the nightly-synced Firebase Storage cache,
// then scores them entirely client-side using the local Scryfall card cache.
// No live API calls at suggestion time.

import { initDeckCache, getAllDecks } from './deckCache';
import { initScryfallCache, lookupCard } from './scryfallCache';
import { scoreDeck, calculateMainScore, DEFAULT_WEIGHTS } from './deckScoring';

export { DEFAULT_WEIGHTS };

// ---------------------------------------------------------------------------
// Ensure both caches are ready before scoring
// ---------------------------------------------------------------------------

/**
 * ensureCaches
 * Downloads deck data and card data from Firebase Storage if stale.
 * Runs both in parallel. Calls onProgress with combined status.
 */
export async function ensureCaches(onProgress) {
  let cardPct = 0;
  let deckPct = 0;

  const report = (label) => {
    const combined = Math.round((cardPct + deckPct) / 2);
    onProgress?.({ phase: 'loading', pct: combined, label });
  };

  const [cardResult, deckResult] = await Promise.all([
    initScryfallCache((p) => {
      if (p.phase === 'download') cardPct = Math.round(p.pct * 0.5);
      else if (p.phase === 'index')  cardPct = 50 + Math.round((p.pct - 50) * 0.5);
      else if (p.phase === 'ready')  cardPct = 100;
      report(p.phase === 'ready' ? 'Card database ready' : `Loading cards… ${p.pct}%`);
    }),
    initDeckCache((p) => {
      deckPct = p.pct;
      report(p.phase === 'ready' ? 'Deck database ready' : `Loading decks… ${p.pct}%`);
    }),
  ]);

  return { cardResult, deckResult };
}

// ---------------------------------------------------------------------------
// Score a single deck against the user's collection (fully local)
// ---------------------------------------------------------------------------

async function scoreSingleDeck({ deck, userCollection, userDeckProfiles, weights }) {
  // Resolve card data from local IndexedDB cache — no network calls
  const cardNames = (deck.keyCards ?? [])
    .filter((c) => c.section !== 'sideboard')
    .map((c) => c.name);

  const resolvedCards = (
    await Promise.all(cardNames.map((name) => lookupCard(name)))
  ).filter(Boolean);

  const deckList = (deck.keyCards ?? []).map((c) => ({
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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * generateSuggestions
 *
 * @param {object} params
 * @param {Map}    params.userCollection     Map<cardNameLower, qty>
 * @param {Array}  params.userDeckProfiles   buildDeckProfile() results
 * @param {object} params.weights            Score weight overrides
 * @param {Array}  params.formats            Format filter ['commander','modern',...]
 * @param {Array}  params.colorFilter        Color filter ['W','G',...] — empty = all
 * @param {function} params.onProgress       ({ phase, pct, label, current, total }) => void
 */
export async function generateSuggestions({
  userCollection,
  userDeckProfiles = [],
  weights = DEFAULT_WEIGHTS,
  formats = ['commander', 'standard', 'modern', 'pioneer'],
  colorFilter = [],
  onProgress,
}) {
  // Step 1: ensure both caches are warm
  await ensureCaches((p) => onProgress?.({ ...p, current: 0, total: 0 }));

  onProgress?.({ phase: 'loading_decks', pct: 95, label: 'Filtering decks…' });

  // Step 2: load all decks and apply format + color filters
  const allDecks = await getAllDecks();

  const candidates = allDecks.filter((deck) => {
    // Format filter
    if (formats.length > 0 && !formats.includes(deck.format)) return false;
    // Color filter: show decks whose colors are a subset of selected colors
    if (colorFilter.length > 0 && deck.colors.length > 0) {
      if (!deck.colors.every((c) => colorFilter.includes(c))) return false;
    }
    return true;
  });

  if (candidates.length === 0) return [];

  // Step 3: score all candidates (local lookups, no API calls)
  const total = candidates.length;
  let completed = 0;
  onProgress?.({ phase: 'scoring', pct: 0, label: `Scoring ${total} decks…`, current: 0, total });

  const settled = await Promise.allSettled(
    candidates.map((deck) =>
      scoreSingleDeck({ deck, userCollection, userDeckProfiles, weights }).then((result) => {
        completed++;
        onProgress?.({
          phase: 'scoring',
          pct: Math.round((completed / total) * 100),
          label: `Scoring decks… ${completed}/${total}`,
          current: completed,
          total,
        });
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
