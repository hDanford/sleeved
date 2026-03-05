import { collection, doc, getDocs, setDoc, deleteDoc, writeBatch, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

function colRef(uid) {
  return collection(db, 'users', uid, 'cards');
}

function cardId(name, set, foil) {
  const base = (name + (set ? `-${set}` : '') + (foil ? '-foil' : '')).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return base.slice(0, 100);
}

export async function loadCollection(uid) {
  const snap = await getDocs(query(colRef(uid), orderBy('name')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function upsertCard(uid, card) {
  const id = cardId(card.name, card.set, card.foil);
  await setDoc(doc(colRef(uid), id), {
    name: card.name,
    quantity: card.quantity ?? 1,
    set: card.set ?? null,
    foil: card.foil ?? false,
    condition: card.condition ?? 'NM',
    section: card.section ?? 'mainboard',
    colors: card.colors ?? [],
    type: card.type ?? null,
    cmc: card.cmc ?? null,
    imageUri: card.imageUri ?? null,
    imageUriSmall: card.imageUriSmall ?? null,
    updatedAt: Date.now(),
  }, { merge: true });
  return id;
}

export async function removeCard(uid, id) {
  await deleteDoc(doc(colRef(uid), id));
}

export async function bulkImport(uid, cards) {
  const batch = writeBatch(db);
  for (const card of cards) {
    const id = cardId(card.name, card.set, card.foil);
    const ref = doc(colRef(uid), id);
    batch.set(ref, {
      name: card.name,
      quantity: card.quantity ?? 1,
      set: card.set ?? null,
      foil: card.foil ?? false,
      condition: card.condition ?? 'NM',
      section: card.section ?? 'mainboard',
      colors: card.colors ?? [],
      type: card.type ?? null,
      cmc: card.cmc ?? null,
      imageUri: card.imageUri ?? null,
      imageUriSmall: card.imageUriSmall ?? null,
      updatedAt: Date.now(),
    }, { merge: true });
  }
  await batch.commit();
}
