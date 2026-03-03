import { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { loadCollection } from '../utils/collectionStore';
import { getSynergyCards } from '../utils/scryfallApi';

const FORMATS = ['standard','modern','legacy','commander','pauper'];
const STRATEGIES = ['any','aggro','midrange','control','ramp'];

export default function DeckSuggestions() {
  const { user } = useAuth();
  const [collection, setCollection] = useState([]);
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState('modern');
  const [strategy, setStrategy] = useState('any');
  const [colors, setColors] = useState([]);
  const [idea, setIdea] = useState('');
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCollection(user.uid).then((c) => { setCollection(c); setLoading(false); });
  }, [user.uid]);

  function toggleColor(c) {
    setColors((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c]);
  }

  async function buildDeck() {
    setBuilding(true); setResult(null); setError('');
    try {
      const usedColors = colors.length > 0 ? colors
        : [...new Set(collection.flatMap((c) => c.colors || []))].slice(0, 2);
      const ownedNames = collection.map((c) => c.name);
      const synergy = await getSynergyCards({ colors: usedColors, format, strategy: strategy === 'any' ? '' : strategy });
      const owned = buildOwned(collection.filter((c) =>
        usedColors.length === 0 || (c.colors||[]).some((x) => usedColors.includes(x))
      ), strategy);
      const ownedTotal = owned.reduce((s, c) => s + c.useQuantity, 0);
      const suggested = synergy.filter((c) => !ownedNames.includes(c.name)).slice(0, Math.max(0, 60 - ownedTotal));
      setResult({ owned, suggested, format, strategy, usedColors });
    } catch (err) { setError('Error: ' + err.message); }
    setBuilding(false);
  }

  function buildOwned(coll, strat) {
    const sorted = [...coll].sort((a, b) =>
      strat === 'aggro' ? (a.cmc||0)-(b.cmc||0) : strat === 'control' ? (b.cmc||0)-(a.cmc||0) : 0
    );
    let slots = 60; const res = [];
    for (const c of sorted) {
      if (slots <= 0) break;
      const use = Math.min(c.quantity, 4, slots);
      res.push({ ...c, useQuantity: use }); slots -= use;
    }
    return res;
  }

  if (loading) return <div style={{ display:'flex', justifyContent:'center', paddingTop:60 }}><div className="spinner" /></div>;

  const colorBtns = ['W','U','B','R','G'];

  return (
    <div className="fade-in">
      <h1 className="section-title" style={{ marginBottom:6 }}>Deck Suggestions</h1>
      <p style={{ color:'var(--text-secondary)', marginBottom:28 }}>Build a deck from your collection with smart fill-in suggestions.</p>

      {collection.length === 0 ? (
        <div className="card-panel" style={{ textAlign:'center', padding:60, color:'var(--text-muted)' }}>
          <p style={{ fontFamily:'var(--font-display)', fontSize:18 }}>Add cards to your collection first.</p>
        </div>
      ) : (
        <>
          <div className="card-panel" style={{ marginBottom:28 }}>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:16, color:'var(--gold-bright)', marginBottom:20 }}>Build Preferences</h2>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:20, marginBottom:20 }}>
              <div>
                <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Format</label>
                <select className="input select" value={format} onChange={(e) => setFormat(e.target.value)}>
                  {FORMATS.map((f) => <option key={f} value={f}>{f[0].toUpperCase()+f.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Strategy</label>
                <select className="input select" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                  {STRATEGIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Colors</label>
                <div style={{ display:'flex', gap:6 }}>
                  {colorBtns.map((c) => (
                    <button key={c} onClick={() => toggleColor(c)} className={`badge tag-${c}`}
                      style={{ cursor:'pointer', opacity: colors.length===0||colors.includes(c)?1:0.3, padding:'6px 12px', fontFamily:'var(--font-display)', fontSize:12 }}>
                      {c}
                    </button>
                  ))}
                </div>
                {colors.length===0 && <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:4 }}>Auto-detect from collection</p>}
              </div>
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={{ display:'block', color:'var(--text-secondary)', fontSize:13, marginBottom:6 }}>Deck Idea (optional)</label>
              <input className="input" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. Goblin tribal, Aura voltron, Graveyard reanimator..." />
            </div>
            <button className="btn btn-primary" onClick={buildDeck} disabled={building} style={{ padding:'12px 32px' }}>
              {building ? 'Building...' : 'Build Deck Suggestion'}
            </button>
          </div>

          {error && <p style={{ color:'#e05050', marginBottom:16 }}>{error}</p>}

          {result && (
            <div className="fade-in">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
                <div>
                  <h2 style={{ fontFamily:'var(--font-display)', fontSize:20, color:'var(--gold-bright)' }}>
                    {result.format[0].toUpperCase()+result.format.slice(1)} — {result.strategy[0].toUpperCase()+result.strategy.slice(1)}
                  </h2>
                  <p style={{ color:'var(--text-secondary)', fontSize:14 }}>
                    {result.owned.reduce((s,c)=>s+c.useQuantity,0)} owned + {result.suggested.length} suggestions
                  </p>
                </div>
                <button className="btn" onClick={() => {
                  const l = [...result.owned.map((c)=>`${c.useQuantity} ${c.name}`), result.suggested.length ? '// Suggested:' : '', ...result.suggested.map((c)=>`1 ${c.name}`)].filter(Boolean);
                  navigator.clipboard.writeText(l.join('\n'));
                }}>Copy Decklist</button>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
                <div>
                  <h3 style={{ fontFamily:'var(--font-display)', fontSize:13, color:'var(--text-secondary)', marginBottom:12, letterSpacing:'0.06em', textTransform:'uppercase' }}>From Your Collection</h3>
                  {result.owned.map((c) => (
                    <div key={c.name} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
                      {c.imageUri && <img src={c.imageUri} alt={c.name} style={{ width:30, borderRadius:3 }} />}
                      <span style={{ fontFamily:'var(--font-display)', fontSize:12, color:'var(--gold-bright)', minWidth:20 }}>x{c.useQuantity}</span>
                      <div><p style={{ fontSize:13, color:'var(--text-primary)' }}>{c.name}</p><p style={{ fontSize:11, color:'var(--text-muted)' }}>{c.type}</p></div>
                    </div>
                  ))}
                </div>
                <div>
                  <h3 style={{ fontFamily:'var(--font-display)', fontSize:13, color:'var(--text-secondary)', marginBottom:12, letterSpacing:'0.06em', textTransform:'uppercase' }}>Suggested Additions</h3>
                  {result.suggested.length === 0
                    ? <p style={{ color:'var(--text-muted)' }}>Your collection covers the full deck!</p>
                    : result.suggested.map((c) => (
                      <div key={c.name} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
                        {c.image_uris?.small && <img src={c.image_uris.small} alt={c.name} style={{ width:30, borderRadius:3 }} />}
                        <span style={{ fontFamily:'var(--font-display)', fontSize:12, color:'var(--text-muted)', minWidth:20 }}>+1</span>
                        <div style={{ flex:1 }}><p style={{ fontSize:13, color:'var(--text-primary)' }}>{c.name}</p><p style={{ fontSize:11, color:'var(--text-muted)' }}>{c.type_line}</p></div>
                        <a href={`https://scryfall.com/search?q=${encodeURIComponent(c.name)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:'var(--gold-dim)', textDecoration:'none' }}>View</a>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
