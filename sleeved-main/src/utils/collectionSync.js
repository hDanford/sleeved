// src/utils/collectionSync.js
// Parses raw import text, enriches cards with Scryfall images, and writes to Firestore.

import { loadCollection, bulkImport } from './collectionStore';
import { autoParseImport } from './importParsers';
import { initScryfallCache, lookupCard, isCacheReady } from './scryfallCache';

export async function syncCollection({ uid, rawText, mode = 'merge', onProgress }) {
  if (!uid) throw new Error('User must be signed in to sync collection.');

  onProgress?.({ phase: 'parsing', pct: 5, label: 'Parsing cards…' });

  const { source, cards } = autoParseImport(rawText);
  if (!cards.length) throw new Error('No cards found in the imported data.');

  // Deduplicate
  const parsed = new Map();
  for (const card of cards) {
    const key = `${card.name.toLowerCase()}||${(card.set || '').toLowerCase()}||${!!card.foil}`;
    if (parsed.has(key)) {
      parsed.get(key).quantity += (card.quantity ?? 1);
    } else {
      parsed.set(key, { ...card, quantity: card.quantity ?? 1 });
    }
  }
  const dedupedCards = [...parsed.values()];

  // Ensure card image cache is ready (fetches from Firebase Storage if stale)
  onProgress?.({ phase: 'cache', pct: 10, label: 'Checking card image database…' });
  let cacheAvailable = false;
  try {
    await initScryfallCache((p) => {
      if (p.phase === 'download') {
        onProgress?.({ phase: 'cache_download', pct: Math.round(10 + p.pct * 0.3), label: `Downloading card database… ${p.pct}%` });
      } else if (p.phase === 'index') {
        onProgress?.({ phase: 'cache_index', pct: Math.round(40 + (p.pct - 50) * 0.3), label: `Indexing cards… ${p.pct}%` });
      } else if (p.phase === 'ready') {
        onProgress?.({ phase: 'cache_ready', pct: 60, label: 'Card database ready.' });
      }
    });
    cacheAvailable = true;
  } catch (e) {
    console.warn('[syncCollection] Card cache unavailable, images may be missing:', e.message);
  }

  // Enrich with images
  if (cacheAvailable) {
    onProgress?.({ phase: 'enriching', pct: 62, label: `Looking up images for ${dedupedCards.length} cards…` });
    for (let i = 0; i < dedupedCards.length; i++) {
      const card = dedupedCards[i];
      try {
        const sf = await lookupCard(card.name);
        if (sf) {
          dedupedCards[i] = {
            ...card,
            colors:        sf.colors?.length ? sf.colors : (sf.color_identity || card.colors || []),
            type:          sf.type_line   || card.type || null,
            cmc:           sf.cmc         ?? card.cmc  ?? null,
            imageUri:      sf.image_normal ?? null,
            imageUriSmall: sf.image_small  ?? null,
          };
        }
      } catch { /* skip */ }
      if (i % 50 === 0) {
        onProgress?.({ phase: 'enriching', pct: Math.round(62 + (i / dedupedCards.length) * 18), label: `Looking up images… ${i + 1}/${dedupedCards.length}` });
      }
    }
  }

  onProgress?.({ phase: 'syncing', pct: 80, label: 'Saving to cloud…' });

  if (mode === 'replace') {
    const { doc, collection, writeBatch } = await import('firebase/firestore');
    const { db } = await import('../firebase');
    const existing = await loadCollection(uid);
    const batch = writeBatch(db);
    for (const card of existing) batch.delete(doc(collection(db, 'users', uid, 'cards'), card.id));
    await batch.commit();
  }

  onProgress?.({ phase: 'syncing', pct: 90, label: 'Saving to cloud…' });
  await bulkImport(uid, dedupedCards);
  onProgress?.({ phase: 'done', pct: 100 });

  return { cardCount: dedupedCards.length, source, mode };
}

export async function getCollectionMeta(uid) {
  if (!uid) return null;
  try {
    const cards = await loadCollection(uid);
    if (!cards.length) return null;
    const cardCount = cards.reduce((sum, c) => sum + (c.quantity ?? 1), 0);
    return { cardCount, lastSyncedAt: Math.max(...cards.map((c) => c.updatedAt ?? 0)) };
  } catch {
    return null;
  }
}

/**
 * enrichMissingImages
 * Backfills imageUri for cards in Firestore that have no image.
 * Triggers a cache download if needed.
 */
export async function enrichMissingImages(uid, cards, onUpdate, onStatus) {
  const missing = cards.filter((c) => !c.imageUri);
  if (!missing.length) return;

  try {
    onStatus?.('downloading');
    await initScryfallCache((p) => {
      if (p.phase === 'ready') onStatus?.('enriching');
    });
    onStatus?.('enriching');
  } catch (e) {
    console.warn('[enrichMissingImages] Cache init failed:', e.message);
    onStatus?.(null);
    return;
  }

  const { upsertCard } = await import('./collectionStore');
  const enriched = [];

  for (const card of missing) {
    try {
      const sf = await lookupCard(card.name);
      if (!sf?.image_normal) continue;
      const updated = {
        ...card,
        imageUri:      sf.image_normal,
        imageUriSmall: sf.image_small  ?? null,
        colors:        card.colors?.length ? card.colors : (sf.colors?.length ? sf.colors : (sf.color_identity || [])),
        type:          card.type  || sf.type_line || null,
        cmc:           card.cmc   ?? sf.cmc       ?? null,
      };
      await upsertCard(uid, updated);
      enriched.push(updated);
    } catch { /* skip */ }
  }

  if (enriched.length > 0) {
    onUpdate(cards.map((c) => enriched.find((e) => e.id === c.id) || c));
  }

  onStatus?.('done');
}
