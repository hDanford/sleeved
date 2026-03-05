// src/utils/collectionSync.js
// Manages the user's card collection in Firestore.
//
// Firestore path: users/{uid}/collection (single document, map of nameLower → qty)
//
// Two write modes:
//   'merge'   — adds imported quantities on top of existing ones (default)
//   'replace' — overwrites the entire collection with the imported data

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from './firebaseConfig';
import { autoParseImport } from './importParsers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be signed in to sync collection.');
  return user;
}

function collectionRef(uid) {
  return doc(db, 'users', uid, 'data', 'collection');
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * getCollection
 * Returns the user's collection as a Map<cardNameLower, quantity>.
 * This is the exact shape the deck scoring pipeline expects.
 *
 * @returns {Promise<Map<string, number>>}
 */
export async function getCollection() {
  const user = requireUser();
  const snap = await getDoc(collectionRef(user.uid));
  if (!snap.exists()) return new Map();

  const data = snap.data();
  const map = new Map();
  for (const [key, val] of Object.entries(data?.cards ?? {})) {
    map.set(key, typeof val === 'number' ? val : 0);
  }
  return map;
}

/**
 * getCollectionMeta
 * Returns metadata about the last sync (timestamp, card count, source).
 */
export async function getCollectionMeta() {
  const user = requireUser();
  const snap = await getDoc(collectionRef(user.uid));
  if (!snap.exists()) return null;
  const { lastSyncedAt, cardCount, source } = snap.data();
  return { lastSyncedAt: lastSyncedAt?.toDate?.() ?? null, cardCount, source };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * syncCollection
 * Parses raw import text and writes the collection to Firestore.
 *
 * @param {object} params
 * @param {string} params.rawText    Raw paste/file content (any supported format)
 * @param {'merge'|'replace'} params.mode
 * @param {function} params.onProgress  ({ phase, pct, cardCount }) => void
 * @returns {Promise<{ cardCount: number, source: string, mode: string }>}
 */
export async function syncCollection({ rawText, mode = 'merge', onProgress }) {
  const user = requireUser();

  onProgress?.({ phase: 'parsing', pct: 10 });

  // 1. Parse the raw input
  const { source, cards } = autoParseImport(rawText);
  if (!cards.length) throw new Error('No cards found in the imported data.');

  // Aggregate quantities (same card may appear multiple times in CSV exports)
  const parsed = new Map();
  for (const card of cards) {
    const key = card.name.toLowerCase().trim();
    parsed.set(key, (parsed.get(key) ?? 0) + (card.quantity ?? 1));
  }

  onProgress?.({ phase: 'syncing', pct: 40 });

  // 2. Merge or replace
  let finalCards;

  if (mode === 'merge') {
    // Load existing and add on top
    const existing = await getCollection();
    finalCards = new Map(existing);
    for (const [key, qty] of parsed) {
      finalCards.set(key, (finalCards.get(key) ?? 0) + qty);
    }
  } else {
    // Replace — use parsed data as-is
    finalCards = parsed;
  }

  onProgress?.({ phase: 'syncing', pct: 70 });

  // 3. Write to Firestore
  // Firestore document keys can't contain '/' so names are safe as-is (lowercase)
  const cardsObj = Object.fromEntries(finalCards);
  await setDoc(collectionRef(user.uid), {
    cards: cardsObj,
    cardCount: finalCards.size,
    source,
    mode,
    lastSyncedAt: serverTimestamp(),
  });

  onProgress?.({ phase: 'done', pct: 100, cardCount: finalCards.size });

  return { cardCount: finalCards.size, source, mode };
}

/**
 * removeFromCollection
 * Removes specific cards or decrements their quantities.
 *
 * @param {Array<{ name: string, quantity?: number }>} cards
 * @param {boolean} removeAll  If true, removes the card entirely regardless of quantity
 */
export async function removeFromCollection(cards, removeAll = false) {
  const user = requireUser();
  const existing = await getCollection();

  for (const { name, quantity = 1 } of cards) {
    const key = name.toLowerCase().trim();
    if (!existing.has(key)) continue;
    if (removeAll) {
      existing.delete(key);
    } else {
      const newQty = (existing.get(key) ?? 0) - quantity;
      if (newQty <= 0) existing.delete(key);
      else existing.set(key, newQty);
    }
  }

  await updateDoc(collectionRef(user.uid), {
    cards: Object.fromEntries(existing),
    cardCount: existing.size,
    lastSyncedAt: serverTimestamp(),
  });
}
