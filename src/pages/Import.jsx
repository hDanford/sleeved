import { useState, useRef } from 'react';
import { useAuth } from '../App';
import { autoParseImport } from '../utils/importParsers';
import { searchCard } from '../utils/scryfallApi';
import { bulkImport } from '../utils/collectionStore';

const SITES = [
  { name:'Moxfield', steps:['Go to your collection/deck','Click Export > CSV','Copy and paste below'] },
  { name:'Archidekt', steps:['Open your deck','Click Export > CSV','Paste below'] },
  { name:'Manabox', steps:['Collection > Export > CSV (Manabox)','Paste below'] },
  { name:'MTGGoldfish', steps:['Open a deck','Copy the text list or download','Paste below'] },
  { name:'Arena/MTGO', steps:['Export Deck in-game','Paste the decklist below'] },
];

export default function Import() {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [source, setSource] = useState('');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [openGuide, setOpenGuide] = useState(null);
  const fileRef = useRef();

  function handleParse() {
    if (!text.trim()) return;
    const result = autoParseImport(text);
    setParsed(result.cards); setSource(result.source); setDone(false); setError('');
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    new FileReader().onload = (ev) => setText(ev.target.result);
    const r = new FileReader();
    r.onload = (ev) => setText(ev.target.result);
    r.readAsText(file);
  }

  async function handleImport() {
    if (!parsed?.length) return;
    setImporting(true); setError('');
    try {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const enriched = [];
      for (const card of parsed) {
        const sf = await searchCard(card.name);
        enriched.push(sf ? {
          ...card, name: sf.name,
          colors: sf.colors || sf.color_identity || [],
          type: sf.type_line, cmc: sf.cmc,
          set: card.set || sf.set?.toUpperCase(),
          imageUri: sf.image_uris?.small || sf.card_faces?.[0]?.image_uris?.small,
        } : card);
        await delay(80);
      }
      await bulkImport(user.uid, enriched);
      setDone(true); setParsed(null); setText('');
    } catch (err) { setError('Import failed: ' + err.message); }
    setImporting(false);
  }

  return (
    <div className="fade-in" style={{ position:'relative' }}>
      <h1 className="section-title" style={{ marginBottom:6 }}>Import Cards</h1>
      <p style={{ color:'var(--text-secondary)', marginBottom:28 }}>
        Import from Moxfield, Archidekt, Manabox, MTGGoldfish, or any standard decklist format.
      </p>

      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:28 }}>
        {SITES.map((g) => (
          <div key={g.name} style={{ position:'relative' }}>
            <button className="btn" style={{ fontSize:12 }} onClick={() => setOpenGuide(openGuide === g.name ? null : g.name)}>
              {g.name} {openGuide === g.name ? '▲' : '▼'}
            </button>
            {openGuide === g.name && (
              <div className="card-panel fade-in" style={{ position:'absolute', zIndex:20, top:'100%', left:0, marginTop:4, minWidth:260, boxShadow:'0 8px 32px rgba(0,0,0,0.6)' }}>
                <p style={{ fontFamily:'var(--font-display)', fontSize:13, color:'var(--gold-bright)', marginBottom:10 }}>Export from {g.name}</p>
                <ol style={{ paddingLeft:20, color:'var(--text-secondary)', fontSize:14 }}>
                  {g.steps.map((s, i) => <li key={i} style={{ marginBottom:4 }}>{s}</li>)}
                </ol>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card-panel" style={{ marginBottom:24 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:16, color:'var(--gold-bright)', letterSpacing:'0.05em' }}>Paste or Upload</h2>
          <span className="btn" style={{ fontSize:12, cursor:'pointer' }} onClick={() => fileRef.current?.click()}>
            Upload File (.csv/.txt)
          </span>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display:'none' }} />
        </div>
        <textarea className="input" style={{ minHeight:180, fontFamily:'monospace', fontSize:13, resize:'vertical' }}
          placeholder={'Paste your card list here...\n\nExamples:\n4 Lightning Bolt\n2x Counterspell\n\nOr paste a CSV export from Moxfield, Archidekt, or Manabox.'}
          value={text} onChange={(e) => { setText(e.target.value); setParsed(null); setDone(false); }} />
        <div style={{ display:'flex', gap:12, marginTop:14 }}>
          <button className="btn btn-primary" onClick={handleParse} disabled={!text.trim()}>Parse Cards</button>
          {text && <button className="btn" onClick={() => { setText(''); setParsed(null); setDone(false); }}>Clear</button>}
        </div>
      </div>

      {done && (
        <div className="card-panel fade-in" style={{ border:'1px solid var(--border-gold)', marginBottom:24, background:'rgba(201,168,76,0.05)' }}>
          <p style={{ color:'var(--gold-bright)', fontFamily:'var(--font-display)' }}>Import complete! Cards have been added to your collection.</p>
        </div>
      )}
      {error && <p style={{ color:'#e05050', marginBottom:16 }}>{error}</p>}

      {parsed && (
        <div className="fade-in">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:16, color:'var(--gold-bright)' }}>Preview — {parsed.length} cards detected</h2>
              <p style={{ color:'var(--text-muted)', fontSize:13 }}>Detected format: {source}</p>
            </div>
            <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? 'Importing...' : `Import ${parsed.length} Cards`}
            </button>
          </div>
          <div style={{ maxHeight:400, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
              <thead style={{ position:'sticky', top:0, background:'var(--bg-card)', borderBottom:'1px solid var(--border)' }}>
                <tr>{['Qty','Name','Set','Section'].map((h) => (
                  <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontFamily:'var(--font-display)', fontSize:12, color:'var(--text-secondary)', letterSpacing:'0.06em' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {parsed.map((card, i) => (
                  <tr key={i} style={{ borderBottom:'1px solid var(--border)', background: i%2===0 ? 'var(--bg-deep)' : 'var(--bg-card)' }}>
                    <td style={{ padding:'8px 16px', color:'var(--gold-bright)', fontFamily:'var(--font-display)' }}>x{card.quantity}</td>
                    <td style={{ padding:'8px 16px', color:'var(--text-primary)' }}>{card.name}</td>
                    <td style={{ padding:'8px 16px', color:'var(--text-muted)' }}>{card.set || '—'}</td>
                    <td style={{ padding:'8px 16px', color:'var(--text-secondary)', textTransform:'capitalize' }}>{card.section}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
