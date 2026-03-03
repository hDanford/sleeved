import { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { loadCollection, upsertCard, removeCard } from '../utils/collectionStore';
import { searchCard } from '../utils/scryfallApi';

export default function Collection() {
  const { user } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterColor, setFilterColor] = useState('');
  const [filterType, setFilterType] = useState('');
  const [addName, setAddName] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    loadCollection(user.uid).then((c) => { setCards(c); setLoading(false); });
  }, [user.uid]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAddLoading(true); setAddError('');
    const sf = await searchCard(addName.trim());
    if (!sf) { setAddError('Card not found on Scryfall.'); setAddLoading(false); return; }
    const card = {
      name: sf.name, quantity: addQty, set: sf.set?.toUpperCase(),
      colors: sf.colors || sf.color_identity || [],
      type: sf.type_line, cmc: sf.cmc,
      imageUri: sf.image_uris?.small || sf.card_faces?.[0]?.image_uris?.small,
    };
    await upsertCard(user.uid, card);
    setCards((prev) => {
      const ex = prev.find((c) => c.name === card.name);
      if (ex) return prev.map((c) => c.name === card.name ? { ...c, quantity: c.quantity + addQty } : c);
      return [...prev, { id: card.name, ...card }];
    });
    setAddName(''); setAddQty(1); setAddLoading(false);
  }

  async function handleRemove(id) {
    await removeCard(user.uid, id);
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  const filtered = cards.filter((c) => {
    const s = !search || c.name.toLowerCase().includes(search.toLowerCase());
    const col = !filterColor || (c.colors || []).includes(filterColor);
    const type = !filterType || (c.type || '').toLowerCase().includes(filterType.toLowerCase());
    return s && col && type;
  });

  const total = cards.reduce((s, c) => s + (c.quantity || 1), 0);

  return (
    <div className="fade-in">
      <div style={{ marginBottom:28 }}>
        <h1 className="section-title">My Collection</h1>
        <p style={{ color:'var(--text-secondary)' }}>{total} cards ({cards.length} unique)</p>
      </div>

      <div className="card-panel" style={{ marginBottom:24 }}>
        <h2 style={{ fontFamily:'var(--font-display)', fontSize:16, color:'var(--gold-bright)', marginBottom:16, letterSpacing:'0.05em' }}>Add a Card</h2>
        <form onSubmit={handleAdd} style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div style={{ flex:1, minWidth:220 }}>
            <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Card Name</label>
            <input className="input" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Lightning Bolt" />
          </div>
          <div style={{ width:100 }}>
            <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Qty</label>
            <input className="input" type="number" min={1} max={99} value={addQty} onChange={(e) => setAddQty(parseInt(e.target.value) || 1)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={addLoading || !addName.trim()}>
            {addLoading ? <span className="spinner" style={{ width:16, height:16 }} /> : '+ Add'}
          </button>
        </form>
        {addError && <p style={{ color:'#e05050', marginTop:10, fontSize:14 }}>{addError}</p>}
      </div>

      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        <input className="input" style={{ maxWidth:260 }} placeholder="Search cards..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input select" style={{ maxWidth:160 }} value={filterColor} onChange={(e) => setFilterColor(e.target.value)}>
          <option value="">All Colors</option>
          {[['W','White'],['U','Blue'],['B','Black'],['R','Red'],['G','Green']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="input" style={{ maxWidth:200 }} placeholder="Filter by type..." value={filterType} onChange={(e) => setFilterType(e.target.value)} />
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', paddingTop:60 }}><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="card-panel" style={{ textAlign:'center', padding:60, color:'var(--text-muted)' }}>
          <p style={{ fontFamily:'var(--font-display)', fontSize:18, marginBottom:8 }}>No cards found</p>
          <p>Add cards above or use the Import tab.</p>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:16 }}>
          {filtered.map((card) => <CardRow key={card.id} card={card} onRemove={() => handleRemove(card.id)} />)}
        </div>
      )}
    </div>
  );
}

function CardRow({ card, onRemove }) {
  return (
    <div className="card-panel fade-in" style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
      {card.imageUri && <img src={card.imageUri} alt={card.name} style={{ width:44, borderRadius:4, flexShrink:0 }} />}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
          <span style={{ fontFamily:'var(--font-display)', fontSize:14, color:'var(--text-primary)', fontWeight:600 }}>{card.name}</span>
          <button className="btn btn-danger" onClick={onRemove} style={{ padding:'2px 8px', fontSize:11, flexShrink:0 }}>✕</button>
        </div>
        <p style={{ color:'var(--text-muted)', fontSize:13, marginTop:2 }}>{card.type}</p>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6, flexWrap:'wrap' }}>
          <span style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'2px 10px', fontSize:13, color:'var(--gold-bright)', fontFamily:'var(--font-display)' }}>
            x{card.quantity}
          </span>
          {(card.colors || []).map((c) => <span key={c} className={`badge tag-${c}`}>{c}</span>)}
          {card.set && <span style={{ color:'var(--text-muted)', fontSize:12 }}>{card.set}</span>}
          {card.foil && <span className="badge" style={{ background:'rgba(200,168,76,0.15)', color:'var(--gold-bright)', border:'1px solid var(--border-gold)', fontSize:11 }}>Foil</span>}
        </div>
      </div>
    </div>
  );
}
