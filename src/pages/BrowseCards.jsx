import { useState } from 'react';
import { searchCards } from '../utils/scryfallApi';

export default function BrowseCards() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [total, setTotal] = useState(0);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setSearched(true);
    const data = await searchCards(query);
    setResults(data.data || []);
    setTotal(data.total_cards || 0);
    setLoading(false);
  }

  return (
    <div className="fade-in">
      <h1 className="section-title" style={{ marginBottom: 6 }}>Browse Cards</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 28 }}>
        Search the full MTG card database. Uses Scryfall search syntax.
      </p>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <input className="input" style={{ maxWidth: 480 }} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder='e.g. "lightning" or t:creature c:red cmc<=2' />
        <button className="btn btn-primary" type="submit" disabled={loading || !query.trim()}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {searched && !loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>
          {total > 0 ? `${total.toLocaleString()} cards found` : 'No cards found'}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16 }}>
        {results.map((card) => {
          const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal;
          return (
            <a key={card.id} href={card.scryfall_uri} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}>
              <div className="card-panel" style={{ padding: 12, transition: 'all 0.2s', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-gold)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}>
                {img ? (
                  <img src={img} alt={card.name} style={{ width: '100%', borderRadius: 6, marginBottom: 8 }} />
                ) : (
                  <div style={{ width: '100%', paddingBottom: '140%', background: 'var(--bg-elevated)', borderRadius: 6, marginBottom: 8 }} />
                )}
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--text-primary)', marginBottom: 2 }}>{card.name}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{card.type_line}</p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
