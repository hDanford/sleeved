import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../App';
import { loadCollection, upsertCard, removeCard } from '../utils/collectionStore';
import { searchCard, searchCards } from '../utils/scryfallApi';

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];

export default function Collection() {
  const { user } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('grid');
  const [search, setSearch] = useState('');
  const [filterColor, setFilterColor] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterFoil, setFilterFoil] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadCollection(user.uid).then((c) => { setCards(c); setLoading(false); });
  }, [user.uid]);

  async function handleAdd(cardData) {
    const id = await upsertCard(user.uid, cardData);
    setCards((prev) => {
      const ex = prev.find((c) => c.id === id);
      if (ex) return prev.map((c) => c.id === id ? { ...c, ...cardData, id } : c);
      return [...prev, { id, ...cardData }];
    });
    setShowAddForm(false);
  }

  async function handleRemove(id) {
    await removeCard(user.uid, id);
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleUpdate(id, updates) {
    const card = cards.find((c) => c.id === id);
    await upsertCard(user.uid, { ...card, ...updates });
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, ...updates } : c));
  }

  const filtered = cards
    .filter((c) => {
      const s = !search || c.name.toLowerCase().includes(search.toLowerCase());
      const col = !filterColor || (c.colors || []).includes(filterColor);
      const type = !filterType || (c.type || '').toLowerCase().includes(filterType.toLowerCase());
      const foil = !filterFoil || (filterFoil === 'foil' ? c.foil : !c.foil);
      return s && col && type && foil;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'cmc') return (a.cmc || 0) - (b.cmc || 0);
      if (sortBy === 'qty') return (b.quantity || 1) - (a.quantity || 1);
      if (sortBy === 'set') return (a.set || '').localeCompare(b.set || '');
      return 0;
    });

  const total = cards.reduce((s, c) => s + (c.quantity || 1), 0);

  return (
    <div className="fade-in">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24, flexWrap:'wrap', gap:16 }}>
        <div>
          <h1 className="section-title" style={{ marginBottom:4 }}>My Collection</h1>
          <p style={{ color:'var(--text-secondary)' }}>{total} cards · {cards.length} unique</p>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button className="btn" onClick={() => setView(view === 'grid' ? 'list' : 'grid')} style={{ fontSize:12 }}>
            {view === 'grid' ? '☰ List View' : '⊞ Grid View'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)} style={{ fontSize:12 }}>
            {showAddForm ? '✕ Cancel' : '+ Add Card'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="card-panel fade-in" style={{ marginBottom:24, border:'1px solid var(--border-gold)' }}>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:15, color:'var(--gold-bright)', marginBottom:18 }}>Add a Card</h2>
          <AddCardForm onAdd={handleAdd} />
        </div>
      )}

      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
        <input className="input" style={{ maxWidth:240 }} placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input select" style={{ maxWidth:150 }} value={filterColor} onChange={(e) => setFilterColor(e.target.value)}>
          <option value="">All Colors</option>
          {[['W','White'],['U','Blue'],['B','Black'],['R','Red'],['G','Green']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="input" style={{ maxWidth:160 }} placeholder="Filter by type..." value={filterType} onChange={(e) => setFilterType(e.target.value)} />
        <select className="input select" style={{ maxWidth:140 }} value={filterFoil} onChange={(e) => setFilterFoil(e.target.value)}>
          <option value="">Foil + Non-foil</option>
          <option value="foil">Foil only</option>
          <option value="nonfoil">Non-foil only</option>
        </select>
        <select className="input select" style={{ maxWidth:140 }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="name">Sort: Name</option>
          <option value="cmc">Sort: Mana Cost</option>
          <option value="qty">Sort: Quantity</option>
          <option value="set">Sort: Set</option>
        </select>
      </div>

      {(search || filterColor || filterType || filterFoil) && (
        <p style={{ color:'var(--text-muted)', fontSize:13, marginBottom:16 }}>Showing {filtered.length} of {cards.length} cards</p>
      )}

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', paddingTop:60 }}><div className="spinner" /></div>
      ) : cards.length === 0 ? (
        <div className="card-panel" style={{ textAlign:'center', padding:60, color:'var(--text-muted)' }}>
          <p style={{ fontFamily:'var(--font-display)', fontSize:20, marginBottom:10 }}>No cards yet</p>
          <p style={{ fontSize:15, marginBottom:24 }}>Add your first card or import your collection.</p>
          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>+ Add a Card</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-panel" style={{ textAlign:'center', padding:40, color:'var(--text-muted)' }}>
          <p>No cards match your filters.</p>
        </div>
      ) : view === 'grid' ? (
        <GridView cards={filtered} onRemove={handleRemove} onUpdate={handleUpdate} />
      ) : (
        <ListView cards={filtered} onRemove={handleRemove} onUpdate={handleUpdate} />
      )}
    </div>
  );
}

function AddCardForm({ onAdd }) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [foil, setFoil] = useState(false);
  const [condition, setCondition] = useState('NM');
  const [set, setSet] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef();

  function handleNameChange(val) {
    setName(val);
    clearTimeout(debounce.current);
    if (val.length < 2) { setSuggestions([]); return; }
    debounce.current = setTimeout(async () => {
      const data = await searchCards(`name:${val}`);
      setSuggestions((data.data || []).slice(0, 6));
    }, 350);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true); setError('');
    const sf = await searchCard(name.trim());
    if (!sf) { setError('Card not found. Check the spelling.'); setLoading(false); return; }
    await onAdd({
      name: sf.name, quantity: qty, foil, condition,
      set: set || sf.set?.toUpperCase(),
      colors: sf.colors || sf.color_identity || [],
      type: sf.type_line, cmc: sf.cmc,
      imageUri: sf.image_uris?.normal || sf.card_faces?.[0]?.image_uris?.normal,
      imageUriSmall: sf.image_uris?.small || sf.card_faces?.[0]?.image_uris?.small,
    });
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px,1fr))', gap:16, marginBottom:16 }}>
        <div style={{ position:'relative' }}>
          <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Card Name *</label>
          <input className="input" value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g. Lightning Bolt" autoComplete="off" />
          {suggestions.length > 0 && (
            <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:50, background:'var(--bg-elevated)', border:'1px solid var(--border-gold)', borderRadius:'var(--radius)', marginTop:2, overflow:'hidden' }}>
              {suggestions.map((s) => (
                <div key={s.id} onClick={() => { setName(s.name); setSuggestions([]); }}
                  style={{ padding:'8px 14px', cursor:'pointer', fontSize:14, color:'var(--text-primary)', borderBottom:'1px solid var(--border)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gold-glow)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  {s.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Quantity</label>
          <input className="input" type="number" min={1} max={999} value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} />
        </div>
        <div>
          <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Condition</label>
          <select className="input select" value={condition} onChange={(e) => setCondition(e.target.value)}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Set Code (optional)</label>
          <input className="input" value={set} onChange={(e) => setSet(e.target.value.toUpperCase())} placeholder="e.g. M21" maxLength={6} />
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <div onClick={() => setFoil(!foil)} style={{ width:40, height:22, borderRadius:11, background: foil ? 'var(--gold-bright)' : 'var(--bg-elevated)', border:'1px solid var(--border-gold)', position:'relative', transition:'all 0.2s', cursor:'pointer', flexShrink:0 }}>
          <div style={{ width:16, height:16, borderRadius:'50%', background: foil ? 'var(--bg-deep)' : 'var(--text-muted)', position:'absolute', top:2, left: foil ? 20 : 2, transition:'all 0.2s' }} />
        </div>
        <span style={{ color:'var(--text-secondary)', fontSize:15, cursor:'pointer' }} onClick={() => setFoil(!foil)}>Foil</span>
      </div>
      {error && <p style={{ color:'#e05050', marginBottom:12, fontSize:14 }}>{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={loading || !name.trim()}>
        {loading ? 'Looking up...' : 'Add to Collection'}
      </button>
    </form>
  );
}

function GridView({ cards, onRemove, onUpdate }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:16 }}>
      {cards.map((card) => <GridCard key={card.id} card={card} onRemove={onRemove} />)}
    </div>
  );
}

function GridCard({ card, onRemove }) {
  const [hover, setHover] = useState(false);
  const img = card.imageUri || card.imageUriSmall;
  return (
    <div className="fade-in" style={{ position:'relative' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ background:'var(--bg-card)', border:`1px solid ${hover ? 'var(--border-gold)' : 'var(--border)'}`, borderRadius:'var(--radius-lg)', overflow:'hidden', transition:'all 0.2s', transform: hover ? 'translateY(-3px)' : 'none', boxShadow: hover ? '0 8px 24px rgba(0,0,0,0.4)' : 'none' }}>
        {img ? (
          <div style={{ position:'relative' }}>
            <img src={img} alt={card.name} style={{ width:'100%', display:'block' }} />
            {card.foil && <div style={{ position:'absolute', top:8, right:8, background:'rgba(201,168,76,0.9)', borderRadius:4, padding:'2px 7px', fontSize:11, fontFamily:'var(--font-display)', color:'var(--bg-deep)', fontWeight:700 }}>FOIL</div>}
            {hover && <button onClick={() => onRemove(card.id)} style={{ position:'absolute', top:8, left:8, background:'rgba(0,0,0,0.7)', border:'none', color:'#e05050', cursor:'pointer', fontSize:14, borderRadius:4, width:24, height:24 }}>✕</button>}
          </div>
        ) : (
          <div style={{ paddingBottom:'140%', background:'var(--bg-elevated)', position:'relative' }}>
            <span style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontSize:13, color:'var(--text-muted)', textAlign:'center', padding:8 }}>{card.name}</span>
          </div>
        )}
        <div style={{ padding:'10px 12px' }}>
          <p style={{ fontFamily:'var(--font-display)', fontSize:12, color:'var(--text-primary)', marginBottom:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{card.name}</p>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            <span style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'1px 8px', fontSize:12, color:'var(--gold-bright)', fontFamily:'var(--font-display)' }}>x{card.quantity}</span>
            <span style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'1px 8px', fontSize:11, color:'var(--text-muted)' }}>{card.condition || 'NM'}</span>
            {card.set && <span style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'1px 8px', fontSize:11, color:'var(--text-muted)' }}>{card.set}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ListView({ cards, onRemove, onUpdate }) {
  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', overflow:'hidden' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
        <thead style={{ background:'var(--bg-card)', borderBottom:'1px solid var(--border)' }}>
          <tr>
            {['Card','Type','Colors','Set','Qty','Condition','Foil',''].map((h) => (
              <th key={h} style={{ padding:'12px 16px', textAlign:'left', fontFamily:'var(--font-display)', fontSize:11, color:'var(--text-secondary)', letterSpacing:'0.06em', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cards.map((card, i) => <ListRow key={card.id} card={card} i={i} onRemove={onRemove} onUpdate={onUpdate} />)}
        </tbody>
      </table>
    </div>
  );
}

function ListRow({ card, i, onRemove, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(card.quantity || 1);
  const [condition, setCondition] = useState(card.condition || 'NM');

  function save() { onUpdate(card.id, { quantity: qty, condition }); setEditing(false); }

  return (
    <tr style={{ borderBottom:'1px solid var(--border)', background: i%2===0 ? 'var(--bg-deep)' : 'var(--bg-card)' }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-elevated)'}
      onMouseLeave={(e) => e.currentTarget.style.background = i%2===0 ? 'var(--bg-deep)' : 'var(--bg-card)'}>
      <td style={{ padding:'10px 16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {card.imageUriSmall && <img src={card.imageUriSmall} alt={card.name} style={{ width:28, borderRadius:3, flexShrink:0 }} />}
          <span style={{ fontFamily:'var(--font-display)', fontSize:13, color:'var(--text-primary)' }}>{card.name}</span>
        </div>
      </td>
      <td style={{ padding:'10px 16px', color:'var(--text-muted)', fontSize:12, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{card.type}</td>
      <td style={{ padding:'10px 16px' }}>
        <div style={{ display:'flex', gap:3 }}>
          {(card.colors || []).map((c) => <span key={c} className={`badge tag-${c}`} style={{ padding:'1px 6px', fontSize:10 }}>{c}</span>)}
        </div>
      </td>
      <td style={{ padding:'10px 16px', color:'var(--text-muted)', fontSize:12 }}>{card.set || '—'}</td>
      <td style={{ padding:'10px 16px' }}>
        {editing
          ? <input type="number" min={1} max={999} value={qty} onChange={(e) => setQty(parseInt(e.target.value)||1)} style={{ width:60, background:'var(--bg-elevated)', border:'1px solid var(--border-gold)', borderRadius:'var(--radius)', color:'var(--text-primary)', padding:'2px 6px', fontSize:13, outline:'none' }} />
          : <span style={{ fontFamily:'var(--font-display)', color:'var(--gold-bright)', fontSize:13 }}>x{card.quantity || 1}</span>}
      </td>
      <td style={{ padding:'10px 16px' }}>
        {editing
          ? <select value={condition} onChange={(e) => setCondition(e.target.value)} style={{ background:'var(--bg-elevated)', border:'1px solid var(--border-gold)', borderRadius:'var(--radius)', color:'var(--text-primary)', padding:'2px 6px', fontSize:13, outline:'none' }}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          : <span style={{ color:'var(--text-secondary)', fontSize:13 }}>{card.condition || 'NM'}</span>}
      </td>
      <td style={{ padding:'10px 16px' }}>
        {card.foil
          ? <span className="badge" style={{ background:'rgba(201,168,76,0.15)', color:'var(--gold-bright)', border:'1px solid var(--border-gold)', fontSize:10 }}>Foil</span>
          : <span style={{ color:'var(--text-muted)', fontSize:12 }}>—</span>}
      </td>
      <td style={{ padding:'10px 16px' }}>
        <div style={{ display:'flex', gap:8 }}>
          {editing
            ? <><button onClick={save} style={{ background:'none', border:'none', color:'var(--gold-bright)', cursor:'pointer', fontSize:13, fontFamily:'var(--font-display)' }}>Save</button>
               <button onClick={() => setEditing(false)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13 }}>Cancel</button></>
            : <><button onClick={() => setEditing(true)} style={{ background:'none', border:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:13 }}>Edit</button>
               <button onClick={() => onRemove(card.id)} style={{ background:'none', border:'none', color:'#e05050', cursor:'pointer', fontSize:13 }}>✕</button></>}
        </div>
      </td>
    </tr>
  );
}
