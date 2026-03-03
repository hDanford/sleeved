// src/utils/collectionStore.js
// Firestore CRUD helpers for the user's card collection
// Each user's collection lives at: /users/{uid}/cards/{cardId}

import {
  collection, doc, getDocs, setDoc, deleteDoc, writeBatch, query, orderBy,
} from 'firebase/firestore';
import { db } from '../firebase';

function colRef(uid) {
  return collection(db, 'users', uid, 'cards');
}

function cardId(name, set) {
  // Stable ID from card name + optional set code
  return (name + (set ? `-${set}` : '')).toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

export async function loadCollection(uid) {
  const snap = await getDocs(query(colRef(uid), orderBy('name')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function upsertCard(uid, card) {
  const id = cardId(card.name, card.set);
  await setDoc(doc(colRef(uid), id), {
    name: card.name,
    quantity: card.quantity ?? 1,
    set: card.set ?? null,
    foil: card.foil ?? false,
    section: card.section ?? 'mainboard',
    colors: card.colors ?? [],
    type: card.type ?? null,
    cmc: card.cmc ?? null,
    imageUri: card.imageUri ?? null,
    updatedAt: Date.now(),
  }, { merge: true });
  return id;
}

export async function removeCard(uid, id) {
  await deleteDoc(doc(colRef(uid), id));
}

// Bulk import: merge incoming cards with existing collection
export async function bulkImport(uid, cards) {
  const batch = writeBatch(db);
  for (const card of cards) {
    const id = cardId(card.name, card.set);
    const ref = doc(colRef(uid), id);
    batch.set(ref, {
      name: card.name,
      quantity: card.quantity ?? 1,
      set: card.set ?? null,
      foil: card.foil ?? false,
      section: card.section ?? 'mainboard',
      colors: card.colors ?? [],
      type: card.type ?? null,
      cmc: card.cmc ?? null,
      imageUri: card.imageUri ?? null,
      updatedAt: Date.now(),
    }, { merge: true });
  }
  await batch.commit();
}
