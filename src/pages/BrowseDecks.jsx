import { useState } from 'react';
import { searchCards } from '../utils/scryfallApi';

const POPULAR_ARCHETYPES = [
  { name: 'Mono Red Aggro', format: 'Modern', colors: ['R'], desc: 'Fast burn and aggressive creatures.' },
  { name: 'Azorius Control', format: 'Standard', colors: ['W', 'U'], desc: 'Counter spells, card draw, and board wipes.' },
  { name: 'Sultai Midrange', format: 'Pioneer', colors: ['B', 'U', 'G'], desc: 'Value engines and flexible threats.' },
  { name: 'Gruul Stompy', format: 'Standard', colors: ['R', 'G'], desc: 'Big creatures and ramp spells.' },
  { name: 'Dimir Rogues', format: 'Historic', colors: ['U', 'B'], desc: 'Mill and tempo strategy.' },
  { name: 'Selesnya Tokens', format: 'Modern', colors: ['W', 'G'], desc: 'Go wide with token generators.' },
  { name: 'Rakdos Sacrifice', format: 'Standard', colors: ['B', 'R'], desc: 'Sacrifice synergies for value and damage.' },
  { name: 'Simic Ramp', format: 'Pioneer', colors: ['U', 'G'], desc: 'Accelerate mana and land big payoffs.' },
  { name: 'Esper Legends', format: 'Standard', colors: ['W', 'U', 'B'], desc: 'Legendary creatures with Kaito and friends.' },
  { name: 'Mono Green Devotion', format: 'Pioneer', colors: ['G'], desc: 'Devotion payoffs and massive mana production.' },
  { name: 'Izzet Phoenix', format: 'Modern', colors: ['U', 'R'], desc: 'Arclight Phoenix recursion with spells.' },
  { name: 'Orzhov Midrange', format: 'Standard', colors: ['W', 'B'], desc: 'Removal-heavy midrange with lifegain.' },
];

export default function BrowseDecks() {
  const [filterFormat, setFilterFormat] = useState('');
  const [filterColor, setFilterColor] = useState('');

  const formats = [...new Set(POPULAR_ARCHETYPES.map((d) => d.format))];

  const filtered = POPULAR_ARCHETYPES.filter((d) => {
    const matchFormat = !filterFormat || d.format === filterFormat;
    const matchColor = !filterColor || d.colors.includes(filterColor);
    return matchFormat && matchColor;
  });

  return (
    <div className="fade-in">
      <h1 className="section-title" style={{ marginBottom: 6 }}>Browse Decks</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 28 }}>
        Explore popular archetypes and strategies across formats.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <select className="input select" style={{ maxWidth: 180 }} value={filterFormat} onChange={(e) => setFilterFormat(e.target.value)}>
          <option value="">All Formats</option>
          {formats.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="input select" style={{ maxWidth: 180 }} value={filterColor} onChange={(e) => setFilterColor(e.target.value)}>
          <option value="">All Colors</option>
          {[['W','White'],['U','Blue'],['B','Black'],['R','Red'],['G','Green']].map(([v,l]) =>
            <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {filtered.map((deck) => (
          <div key={deck.name} className="card-panel"
            style={{ transition: 'all 0.2s', cursor: 'default' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-gold)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--gold-bright)', letterSpacing: '0.04em' }}>{deck.name}</h2>
              <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', fontSize: 11 }}>{deck.format}</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 14, lineHeight: 1.5 }}>{deck.desc}</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {deck.colors.map((c) => (
                <span key={c} className={`badge tag-${c}`}>{c}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
