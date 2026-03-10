// src/utils/deckSources/edhrecSource.js
// Builds Commander deck archetypes using Scryfall search queries.
// EDHREC's json.edhrec.com API is CORS-blocked in the browser, so we use
// Scryfall to find popular commanders and build representative decklists.

import { searchCards } from '../scryfallApi';

const COMMANDER_ARCHETYPES = [
  {
    id: 'edhrec-atraxa-praetors-voice',
    name: "Atraxa, Praetors' Voice",
    colors: ['W', 'U', 'B', 'G'],
    strategy: 'goodstuff',
    description: 'Proliferate counters and planeswalkers across all four colours.',
    queries: ['o:proliferate f:commander', 'f:commander t:planeswalker (ci:wubg)', 'f:commander o:"+1/+1 counter" (ci:wubg) (r:rare OR r:mythic)'],
  },
  {
    id: 'edhrec-edgar-markov',
    name: 'Edgar Markov',
    colors: ['W', 'B', 'R'],
    strategy: 'aggro',
    description: 'Vampire tribal — every vampire spell creates free tokens.',
    queries: ['f:commander t:vampire (ci:wbr) (r:rare OR r:uncommon)', 'f:commander o:vampire o:token (ci:wbr)', 'f:commander o:lifelink t:vampire cmc<=3'],
  },
  {
    id: 'edhrec-the-ur-dragon',
    name: 'The Ur-Dragon',
    colors: ['W', 'U', 'B', 'R', 'G'],
    strategy: 'goodstuff',
    description: 'Five-colour dragon tribal with massive flying threats.',
    queries: ['f:commander t:dragon (r:rare OR r:mythic)', 'f:commander o:dragon (o:"search your library" OR o:"when ~ enters")', 'f:commander t:land o:add cmc=0'],
  },
  {
    id: 'edhrec-meren-of-clan-nel-toth',
    name: 'Meren of Clan Nel Toth',
    colors: ['B', 'G'],
    strategy: 'midrange',
    description: 'Graveyard recursion engine — sacrifice and reanimate for value.',
    queries: ['f:commander (ci:bg) o:dies t:creature (r:rare OR r:uncommon)', 'f:commander (ci:bg) o:graveyard o:return t:sorcery', 'f:commander (ci:bg) o:sacrifice o:token cmc<=3'],
  },
  {
    id: 'edhrec-oloro-ageless-ascetic',
    name: 'Oloro, Ageless Ascetic',
    colors: ['W', 'U', 'B'],
    strategy: 'control',
    description: 'Esper control — gain life, draw cards, and outlast opponents.',
    queries: ['f:commander (ci:wub) o:"whenever you gain life" (r:rare OR r:uncommon)', 'f:commander (ci:wub) (t:instant OR t:sorcery) o:counter cmc<=3', 'f:commander (ci:wub) t:creature o:lifelink (r:rare OR r:mythic)'],
  },
  {
    id: 'edhrec-kaalia-of-the-vast',
    name: 'Kaalia of the Vast',
    colors: ['W', 'B', 'R'],
    strategy: 'aggro',
    description: 'Cheat Angels, Demons, and Dragons into play for free.',
    queries: ['f:commander (ci:wbr) (t:angel OR t:demon OR t:dragon) (r:rare OR r:mythic)', 'f:commander (ci:wbr) o:haste t:creature cmc<=4'],
  },
  {
    id: 'edhrec-krenko-mob-boss',
    name: 'Krenko, Mob Boss',
    colors: ['R'],
    strategy: 'aggro',
    description: 'Mono-red goblin tribal — exponential token generation.',
    queries: ['f:commander ci:r t:goblin (r:uncommon OR r:rare)', 'f:commander ci:r o:goblin o:token', 'f:commander ci:r o:haste t:creature cmc<=2'],
  },
  {
    id: 'edhrec-selvala-heart-of-the-wilds',
    name: 'Selvala, Heart of the Wilds',
    colors: ['G'],
    strategy: 'ramp',
    description: 'Mono-green ramp into massive creatures.',
    queries: ['f:commander ci:g t:creature cmc>=6 (r:rare OR r:mythic)', 'f:commander ci:g o:add o:mana t:creature cmc<=3', 'f:commander ci:g o:"search your library" t:sorcery'],
  },
  {
    id: 'edhrec-breya-etherium-shaper',
    name: 'Breya, Etherium Shaper',
    colors: ['W', 'U', 'B', 'R'],
    strategy: 'combo',
    description: 'Artifact combo — sacrifice artifacts for value and win conditions.',
    queries: ['f:commander (ci:wubr) t:artifact t:creature (r:rare OR r:uncommon)', 'f:commander (ci:wubr) o:artifact o:sacrifice (t:instant OR t:sorcery)', 'f:commander (ci:wubr) o:"whenever an artifact" (r:uncommon OR r:rare)'],
  },
  {
    id: 'edhrec-animar-soul-of-elements',
    name: 'Animar, Soul of Elements',
    colors: ['U', 'R', 'G'],
    strategy: 'combo',
    description: 'Temur creature storm — cast creatures to reduce costs to zero.',
    queries: ['f:commander (ci:urg) t:creature cmc>=5 (r:rare OR r:mythic)', 'f:commander (ci:urg) o:morph t:creature', 'f:commander (ci:urg) o:"+1/+1 counter" t:creature cmc<=3'],
  },
];

export async function fetchEDHRECDecks(count = 10) {
  const archetypes = COMMANDER_ARCHETYPES.slice(0, count);
  const results = [];

  for (const archetype of archetypes) {
    try {
      const cardMap = new Map();
      for (const query of archetype.queries) {
        const data = await searchCards(query);
        for (const card of data?.data ?? []) {
          if (!cardMap.has(card.name)) cardMap.set(card.name, card);
          if (cardMap.size >= 40) break;
        }
      }
      if (cardMap.size < 4) continue;

      const keyCards = [...cardMap.values()].map((card) => ({
        name: card.name,
        quantity: guessQuantity(card, archetype.strategy),
        section: card.type_line?.toLowerCase().includes('land') ? 'land' : 'mainboard',
      }));

      results.push({
        id: archetype.id,
        name: archetype.name,
        source: 'EDHREC',
        sourceUrl: `https://edhrec.com/commanders/${archetype.id.replace('edhrec-', '')}`,
        format: 'commander',
        strategy: archetype.strategy,
        colors: archetype.colors,
        description: archetype.description,
        keyCards,
      });
    } catch (err) {
      console.warn(`[edhrecSource] Failed to build "${archetype.name}":`, err);
    }
  }

  return results;
}

function guessQuantity(card, strategy) {
  if (card.type_line?.toLowerCase().includes('land')) return 2;
  if (card.rarity === 'mythic') return 1;
  if (card.rarity === 'rare') return 1;
  if (card.rarity === 'uncommon') return strategy === 'aggro' ? 3 : 2;
  return 3;
}

// Keep these exports so nothing else breaks
export async function getTopCommanders() { return []; }
export async function getCommanderDeck() { return null; }
