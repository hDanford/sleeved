// scripts/sync-scryfall.mjs
// Downloads the Scryfall default_cards bulk JSON, strips it to the minimal
// fields the app needs, then uploads the result to Firebase Storage.
//
// Required GitHub secrets:
//   FIREBASE_SERVICE_ACCOUNT  — contents of your Firebase service account JSON
//   FIREBASE_STORAGE_BUCKET   — e.g. "your-project.appspot.com"
//
// How to get a service account:
//   Firebase Console → Project Settings → Service Accounts → Generate new private key

import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// ---------------------------------------------------------------------------
// Init Firebase Admin
// ---------------------------------------------------------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const bucket = process.env.FIREBASE_STORAGE_BUCKET;

if (!serviceAccount || !bucket) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_STORAGE_BUCKET env vars.');
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount), storageBucket: bucket });
const storage = getStorage().bucket();

// ---------------------------------------------------------------------------
// Download Scryfall bulk data
// ---------------------------------------------------------------------------
console.log('Fetching Scryfall bulk data manifest…');
const manifestRes = await fetch('https://api.scryfall.com/bulk-data');
const manifest = await manifestRes.json();
const entry = manifest.data?.find((d) => d.type === 'default_cards');
if (!entry) throw new Error('Could not find default_cards in Scryfall manifest');

console.log(`Downloading bulk data (~${Math.round(entry.size / 1024 / 1024)} MB)…`);
const dataRes = await fetch(entry.download_uri);
if (!dataRes.ok) throw new Error(`Download failed: ${dataRes.status}`);
const cards = await dataRes.json();
console.log(`Downloaded ${cards.length} cards.`);

// ---------------------------------------------------------------------------
// Strip to only the fields the app needs
// ---------------------------------------------------------------------------
const slim = cards.map((c) => {
  // Handle double-faced cards (card_faces)
  const face = c.card_faces?.[0];
  return {
    id:             c.id,
    name:           c.name,
    image_normal:   c.image_uris?.normal  ?? face?.image_uris?.normal  ?? null,
    image_small:    c.image_uris?.small   ?? face?.image_uris?.small   ?? null,
    colors:         c.colors         ?? [],
    color_identity: c.color_identity ?? [],
    type_line:      c.type_line      ?? null,
    cmc:            c.cmc            ?? 0,
  };
});

const json = JSON.stringify(slim);
const byteSize = Buffer.byteLength(json, 'utf8');
console.log(`Slim payload: ${slim.length} cards, ${(byteSize / 1024 / 1024).toFixed(1)} MB`);

// ---------------------------------------------------------------------------
// Upload to Firebase Storage (publicly readable)
// ---------------------------------------------------------------------------
const destPath = 'scryfall/cards-slim.json';
const file = storage.file(destPath);

console.log(`Uploading to gs://${bucket}/${destPath}…`);
await file.save(json, {
  contentType: 'application/json',
  metadata: {
    cacheControl: 'public, max-age=86400',   // browsers/CDN cache for 24 h
    scryfallUpdatedAt: entry.updated_at,
  },
});

// Make the file publicly readable so the browser can fetch it without auth
await file.makePublic();

const publicUrl = `https://storage.googleapis.com/${bucket}/${destPath}`;
console.log(`Done! Public URL: ${publicUrl}`);
console.log(`Scryfall data updated at: ${entry.updated_at}`);
