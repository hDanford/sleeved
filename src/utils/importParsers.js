// src/utils/importParsers.js
// Parsers for card data from Moxfield, Archidekt, Manabox, MTGGoldfish, and plain decklists

function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// "4 Lightning Bolt" or "4x Lightning Bolt" format (Arena, MTGGoldfish, Moxfield export)
export function parseDecklist(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const cards = [];
  let section = 'mainboard';
  for (const line of lines) {
    if (/^(\/\/|#)\s*sideboard/i.test(line) || /^sideboard/i.test(line)) { section = 'sideboard'; continue; }
    if (/^(\/\/|#)\s*commander/i.test(line)) { section = 'commander'; continue; }
    if (/^(\/\/|#)/.test(line)) continue;
    const match = line.match(/^(\d+)x?\s+(.+?)(?:\s+\([\w\d]+\)\s*\d+)?(?:\s+\*[FER]\*)?$/);
    if (match) cards.push({ quantity: parseInt(match[1], 10), name: match[2].trim(), section });
  }
  return cards;
}

export function parseMoxfieldCSV(csvText) {
  const lines = csvText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  const countIdx = header.indexOf('count');
  const nameIdx = header.indexOf('name');
  const setIdx = header.findIndex((h) => h.includes('edition'));
  const foilIdx = header.indexOf('foil');
  if (nameIdx === -1) return [];
  return lines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    return {
      quantity: parseInt(cols[countIdx] || '1', 10),
      name: cols[nameIdx]?.trim() || '',
      set: setIdx >= 0 ? cols[setIdx]?.trim() : undefined,
      foil: foilIdx >= 0 ? (cols[foilIdx]?.toLowerCase() === 'true' || cols[foilIdx] === '1') : false,
      section: 'mainboard',
    };
  }).filter((c) => c.name);
}

export function parseArchidektCSV(csvText) {
  const lines = csvText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  const qtyIdx = header.findIndex((h) => ['count','qty','quantity'].includes(h));
  const nameIdx = header.findIndex((h) => ['name','card name'].includes(h));
  const foilIdx = header.indexOf('foil');
  const catIdx = header.findIndex((h) => h.includes('categor'));
  if (nameIdx === -1) return [];
  return lines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    const cats = catIdx >= 0 ? (cols[catIdx] || '').toLowerCase() : '';
    return {
      quantity: parseInt(cols[qtyIdx] || '1', 10),
      name: cols[nameIdx]?.trim() || '',
      foil: foilIdx >= 0 ? cols[foilIdx]?.toLowerCase().includes('foil') : false,
      section: cats.includes('sideboard') ? 'sideboard' : cats.includes('commander') ? 'commander' : 'mainboard',
    };
  }).filter((c) => c.name);
}

export function parseManaboxCSV(csvText) {
  const lines = csvText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  const nameIdx = header.indexOf('name');
  const qtyIdx = header.indexOf('quantity');
  const setIdx = header.findIndex((h) => h === 'set code');
  const foilIdx = header.indexOf('foil');
  if (nameIdx === -1) return [];
  return lines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    return {
      quantity: parseInt(cols[qtyIdx] || '1', 10),
      name: cols[nameIdx]?.trim() || '',
      set: setIdx >= 0 ? cols[setIdx]?.trim() : undefined,
      foil: foilIdx >= 0 ? (cols[foilIdx]?.toLowerCase() === 'true') : false,
      section: 'mainboard',
    };
  }).filter((c) => c.name);
}

export function autoParseImport(text) {
  const trimmed = text.trim();
  if (trimmed.includes(',')) {
    const h = trimmed.split('\n')[0].toLowerCase();
    if (h.includes('tradelist count') || h.includes('purchase price')) return { source: 'Moxfield', cards: parseMoxfieldCSV(trimmed) };
    if (h.includes('categories')) return { source: 'Archidekt', cards: parseArchidektCSV(trimmed) };
    if (h.includes('set code') || h.includes('collector number')) return { source: 'Manabox', cards: parseManaboxCSV(trimmed) };
    if (h.includes('name')) return { source: 'CSV', cards: parseMoxfieldCSV(trimmed) };
  }
  return { source: 'Decklist', cards: parseDecklist(trimmed) };
}
