// src/utils/deckSync.js
// Manages saved decks in Firestore.
//
// Firestore path: users/{uid}/decks/{deckId}
//
// Each deck document:
// {
//   id:          string   (auto or slugified name)
//   name:        string
//   format:      string
//   cards:       Array<{ name, quantity, section }>
//   source:      string   (e.g. 'Moxfield', 'Archidekt', 'Decklist')
//   createdAt:   Timestamp
//   updatedAt:   Timestamp
// }

import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from './firebaseConfig';
import { autoParseImport } from './importParsers';
import { buildDeckProfile } from './deckScoring';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be signed in to sync decks.');
  return user;
}

function decksRef(uid) {
  return collection(db, 'users', uid, 'decks');
}

function deckDocRef(uid, deckId) {
  return doc(db, 'users', uid, 'decks', deckId);
}

/** Produce a stable ID from a deck name (used for upsert matching). */
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * getDecks
 * Returns all saved decks for the current user, sorted by updatedAt desc.
 * @returns {Promise<Array>}
 */
export async function getDecks() {
  const user = requireUser();
  const q = query(decksRef(user.uid), orderBy('updatedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt?.toDate?.() ?? null,
    updatedAt: d.data().updatedAt?.toDate?.() ?? null,
  }));
}

/**
 * getDeckProfiles
 * Returns lightweight profiles (colors, avgCmc, typeCounts) for all saved decks.
 * Used by the deck suggestion scoring pipeline (styleMatchScore).
 * @returns {Promise<Array>}
 */
export async function getDeckProfiles() {
  const decks = await getDecks();
  return decks.map((deck) => buildDeckProfile(deck.resolvedCards ?? []));
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * syncDeck
 * Parses raw import text and saves it as a deck. If a deck with the same name
 * already exists, it is overwritten (upsert). Otherwise a new deck is created.
 *
 * @param {object} params
 * @param {string} params.rawText     Raw paste/file content
 * @param {string} params.deckName    Optional override name (defaults to first comment line or "Imported Deck")
 * @param {string} params.format      Optional format tag ('standard', 'modern', etc.)
 * @param {function} params.onProgress ({ phase, pct }) => void
 * @returns {Promise<{ id, name, cardCount, source, isUpdate }>}
 */
export async function syncDeck({ rawText, deckName, format, onProgress }) {
  const user = requireUser();

  onProgress?.({ phase: 'parsing', pct: 10 });

  const { source, cards } = autoParseImport(rawText);
  if (!cards.length) throw new Error('No cards found in the imported data.');

  // Derive a name from the first comment line if not supplied
  const name = deckName?.trim() || extractDeckName(rawText) || 'Imported Deck';
  const id = slugify(name);

  onProgress?.({ phase: 'syncing', pct: 50 });

  // Check if a deck with this id already exists (for the isUpdate flag in the response)
  const existingSnap = await getDocs(decksRef(user.uid));
  const isUpdate = existingSnap.docs.some((d) => d.id === id);

  const deckData = {
    name,
    format: format ?? inferFormat(cards),
    source,
    cards,
    cardCount: cards.reduce((sum, c) => sum + (c.quantity ?? 1), 0),
    updatedAt: serverTimestamp(),
    ...(!isUpdate && { createdAt: serverTimestamp() }),
  };

  await setDoc(deckDocRef(user.uid, id), deckData, { merge: true });

  onProgress?.({ phase: 'done', pct: 100 });

  return { id, name, cardCount: deckData.cardCount, source, isUpdate };
}

/**
 * saveDeck
 * Directly saves a deck object (e.g. from the deck builder) to Firestore.
 * Upserts by deck name slug.
 *
 * @param {object} deck  { name, format, cards, resolvedCards? }
 */
export async function saveDeck(deck) {
  const user = requireUser();
  const id = slugify(deck.name);
  await setDoc(deckDocRef(user.uid, id), {
    ...deck,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });
  return id;
}

/**
 * deleteDeck
 * Permanently removes a deck from Firestore.
 */
export async function deleteDeck(deckId) {
  const user = requireUser();
  await deleteDoc(deckDocRef(user.uid, deckId));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Try to extract a deck name from comment lines at the top of the raw text. */
function extractDeckName(text) {
  const lines = text.split('\n').map((l) => l.trim());
  for (const line of lines.slice(0, 5)) {
    const match = line.match(/^(?:\/\/|#)\s*(?:name|deck)?:?\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Very rough format inference from card legality keywords in the raw text.
 * Real format data should come from the importer metadata when available.
 */
function inferFormat(cards) {
  const total = cards.reduce((n, c) => n + (c.quantity ?? 1), 0);
  if (total === 100) return 'commander';
  if (total <= 60) return 'standard'; // can't tell standard vs modern from card list alone
  return 'unknown';
}
