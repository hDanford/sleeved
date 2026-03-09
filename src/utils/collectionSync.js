// src/utils/collectionSync.js
// Parses raw import text, enriches cards with Scryfall images, and writes to Firestore.

import { loadCollection, bulkImport } from './collectionStore';
import { autoParseImport } from './importParsers';
import { initBulkData, lookupCard, isBulkReady } from './bulkDataManager';

/**
 * syncCollection
 * @param {object} params
 * @param {string} params.uid       Firebase user uid
 * @param {string} params.rawText   Raw paste/file content (any supported format)
 * @param {'merge'|'replace'} params.mode
 * @param {function} params.onProgress  ({ phase, pct, label? }) => void
 * @returns {Promise<{ cardCount, source, mode }>}
 */
export async function syncCollection({ uid, rawText, mode = 'merge', onProgress }) {
  if (!uid) throw new Error('User must be signed in to sync collection.');

  onProgress?.({ phase: 'parsing', pct: 5, label: 'Parsing cards…' });

  // 1. Parse the raw input
  const { source, cards } = autoParseImport(rawText);
  if (!cards.length) throw new Error('No cards found in the imported data.');

  // 2. Aggregate duplicates
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

  // 3. Ensure Scryfall bulk data is available for image enrichment
  onProgress?.({ phase: 'bulk', pct: 10, label: 'Checking card image database…' });
  let bulkAvailable = false;
  try {
    await initBulkData((progress) => {
      if (progress.phase === 'download') {
        onProgress?.({
          phase: 'bulk_download',
          pct: Math.round(10 + progress.pct * 0.35),
          label: `Downloading card database… ${progress.pct}%`,
        });
      } else if (progress.phase === 'index') {
        onProgress?.({
          phase: 'bulk_index',
          pct: Math.round(45 + progress.pct * 0.15),
          label: `Indexing cards… ${progress.pct}%`,
        });
      } else if (progress.phase === 'ready') {
        onProgress?.({ phase: 'bulk_ready', pct: 60, label: 'Card database ready.' });
      }
    });
    bulkAvailable = true;
  } catch (e) {
    console.warn('[syncCollection] Bulk data unavailable, images may be missing:', e.message);
  }

  // 4. Enrich cards with Scryfall data (images, colors, type, cmc)
  if (bulkAvailable) {
    onProgress?.({ phase: 'enriching', pct: 62, label: `Looking up images for ${dedupedCards.length} cards…` });
    for (let i = 0; i < dedupedCards.length; i++) {
      const card = dedupedCards[i];
      try {
        const sf = await lookupCard(card.name);
        if (sf) {
          dedupedCards[i] = {
            ...card,
            colors: sf.colors?.length ? sf.colors : (sf.color_identity || card.colors || []),
            type: sf.type_line || card.type || null,
            cmc: sf.cmc ?? card.cmc ?? null,
            imageUri: sf.image_uris?.normal || sf.card_faces?.[0]?.image_uris?.normal || null,
            imageUriSmall: sf.image_uris?.small || sf.card_faces?.[0]?.image_uris?.small || null,
          };
        }
      } catch { /* skip enrichment for this card */ }
      if (i % 50 === 0) {
        onProgress?.({
          phase: 'enriching',
          pct: Math.round(62 + (i / dedupedCards.length) * 18),
          label: `Looking up images… ${i + 1}/${dedupedCards.length}`,
        });
      }
    }
  }

  onProgress?.({ phase: 'syncing', pct: 80, label: 'Saving to cloud…' });

  // 5. If replace mode, wipe existing cards first
  if (mode === 'replace') {
    const { deleteDoc, doc, collection, writeBatch } = await import('firebase/firestore');
    const { db } = await import('../firebase');
    const existing = await loadCollection(uid);
    const batch = writeBatch(db);
    for (const card of existing) {
      batch.delete(doc(collection(db, 'users', uid, 'cards'), card.id));
    }
    await batch.commit();
  }

  onProgress?.({ phase: 'syncing', pct: 90, label: 'Saving to cloud…' });

  // 6. Write via bulkImport
  await bulkImport(uid, dedupedCards);

  onProgress?.({ phase: 'done', pct: 100 });

  return { cardCount: dedupedCards.length, source, mode };
}

/**
 * getCollectionMeta
 */
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
 * Backfills imageUri for cards already in Firestore that are missing images.
 * Only runs if bulk data is already downloaded (won't trigger a new download).
 */
export async function enrichMissingImages(uid, cards, onUpdate) {
  const missing = cards.filter((c) => !c.imageUri);
  if (!missing.length) return;

  const ready = await isBulkReady();
  if (!ready) return;

  const { upsertCard } = await import('./collectionStore');
  const enriched = [];

  for (const card of missing) {
    try {
      const sf = await lookupCard(card.name);
      if (!sf) continue;
      const imageUri = sf.image_uris?.normal || sf.card_faces?.[0]?.image_uris?.normal || null;
      const imageUriSmall = sf.image_uris?.small || sf.card_faces?.[0]?.image_uris?.small || null;
      if (!imageUri) continue;
      const updated = {
        ...card,
        imageUri,
        imageUriSmall,
        colors: card.colors?.length ? card.colors : (sf.colors?.length ? sf.colors : (sf.color_identity || [])),
        type: card.type || sf.type_line || null,
        cmc: card.cmc ?? sf.cmc ?? null,
      };
      await upsertCard(uid, updated);
      enriched.push(updated);
    } catch { /* skip */ }
  }

  if (enriched.length > 0) {
    onUpdate(
      cards.map((c) => {
        const patch = enriched.find((e) => e.id === c.id);
        return patch || c;
      })
    );
  }
}
