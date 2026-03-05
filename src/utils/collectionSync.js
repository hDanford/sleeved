// src/utils/collectionSync.js
// Parses raw import text and writes cards to Firestore via collectionStore.
// Uses the same users/{uid}/cards/{cardId} path as the rest of the app.
// comment to update

import { loadCollection, bulkImport, upsertCard } from './collectionStore';
import { autoParseImport } from './importParsers';

/**
 * syncCollection
 * @param {object} params
 * @param {string} params.uid       Firebase user uid
 * @param {string} params.rawText   Raw paste/file content (any supported format)
 * @param {'merge'|'replace'} params.mode
 * @param {function} params.onProgress  ({ phase, pct }) => void
 * @returns {Promise<{ cardCount, source, mode }>}
 */
export async function syncCollection({ uid, rawText, mode = 'merge', onProgress }) {
  if (!uid) throw new Error('User must be signed in to sync collection.');

  onProgress?.({ phase: 'parsing', pct: 10 });

  // 1. Parse the raw input
  const { source, cards } = autoParseImport(rawText);
  if (!cards.length) throw new Error('No cards found in the imported data.');

  // 2. Aggregate duplicates (same card can appear multiple times in some exports)
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

  onProgress?.({ phase: 'syncing', pct: 40 });

  // 3. If replace mode, load existing cards and remove ones not in the new import
  if (mode === 'replace') {
    const { deleteDoc, doc, collection } = await import('firebase/firestore');
    const { db } = await import('../firebase');
    const existing = await loadCollection(uid);
    const { writeBatch } = await import('firebase/firestore');
    const batch = writeBatch(db);
    for (const card of existing) {
      batch.delete(doc(collection(db, 'users', uid, 'cards'), card.id));
    }
    await batch.commit();
  }

  onProgress?.({ phase: 'syncing', pct: 65 });

  // 4. Write via bulkImport — same path/shape as the rest of the app
  await bulkImport(uid, dedupedCards);

  onProgress?.({ phase: 'done', pct: 100 });

  return { cardCount: dedupedCards.length, source, mode };
}

/**
 * getCollectionMeta
 * Returns a lightweight summary from the live collection.
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
