// src/pages/DeckSuggestions.jsx

import { useState, useEffect, useRef, useMemo } from 'react';
import { loadDecksForFormat, SUPPORTED_FORMATS, fetchAndCacheCommanderDeck, FORMAT_LIMITS } from '../utils/deckCatalog';
import { scoreDeck, calculateMainScore, DEFAULT_WEIGHTS, SCORE_META } from '../utils/deckScoring';
import { resolveCardNames } from '../utils/scryfallApi';
import { saveDeck, getDeckProfiles } from '../utils/deckSync';
import { useAuth } from '../App';

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMAT_LABELS  = { standard:'Standard', modern:'Modern', pioneer:'Pioneer', commander:'Commander' };
const FORMAT_COLORS  = { standard:'#22c55e', modern:'#818cf8', pioneer:'#f59e0b', commander:'#ef4444' };
const STRATEGY_ICONS = { aggro:'⚡', control:'🛡️', combo:'🔄', midrange:'⚔️', ramp:'🌱', tempo:'💨', tribal:'👥', goodstuff:'✨' };
const COLOR_SYMBOLS  = { W:'☀️', U:'💧', B:'💀', R:'🔥', G:'🌿' };

// Basic land data — used for the "Your Basics" drag shelf
const BASIC_LAND_INFO = [
  { name:'Plains',   color:'W', bg:'#f5f0e8', fg:'#5a4a2a' },
  { name:'Island',   color:'U', bg:'#e8f0f5', fg:'#1a4a6a' },
  { name:'Swamp',    color:'B', bg:'#1e1e2a', fg:'#9090b0' },
  { name:'Mountain', color:'R', bg:'#f5e8e8', fg:'#6a1a1a' },
  { name:'Forest',   color:'G', bg:'#e8f5e8', fg:'#1a4a1a' },
];
const BASIC_LAND_NAMES = new Set(['Plains','Island','Swamp','Mountain','Forest','Wastes',
  'Snow-Covered Plains','Snow-Covered Island','Snow-Covered Swamp','Snow-Covered Mountain','Snow-Covered Forest']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreDecksChunk(rawDecks, userCollection, userDeckProfiles, weights) {
  return rawDecks.map((deck) => {
    const scored = scoreDeck({ deckList:deck.keyCards??[], resolvedCards:[], userCollection, userDeckProfiles, weights });
    return { ...deck, ...scored, resolvedCards:null };
  });
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function ScoreRing({ score, size=64 }) {
  const r=size/2-5, circ=2*Math.PI*r, filled=Math.max(0,Math.min(1,score/100))*circ;
  const color = score>=75?'#22c55e':score>=50?'#f59e0b':'#ef4444';
  return (
    <svg width={size} height={size} style={{ transform:'rotate(-90deg)', flexShrink:0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e2030" strokeWidth={7} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${filled} ${circ}`} strokeLinecap="round" style={{ transition:'stroke-dasharray 0.5s ease' }} />
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={size*0.21} fontWeight="800"
        style={{ transform:`rotate(90deg)`, transformOrigin:`${size/2}px ${size/2}px`, fontFamily:'monospace' }}>
        {Math.round(score)}
      </text>
    </svg>
  );
}
function FormatBadge({ format, sm }) {
  const c=FORMAT_COLORS[format]??'#64748b';
  return <span style={{ background:`${c}18`,color:c,border:`1px solid ${c}40`,borderRadius:5,padding:sm?'1px 6px':'2px 8px',fontSize:sm?10:11,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5 }}>{FORMAT_LABELS[format]??format}</span>;
}
function StratBadge({ strategy }) {
  return <span style={{ background:'#1e2030',color:'#94a3b8',borderRadius:5,padding:'2px 7px',fontSize:11,textTransform:'capitalize' }}>{STRATEGY_ICONS[strategy]??'🎴'} {strategy}</span>;
}
function ColorPips({ colors }) {
  if (!colors?.length) return null;
  return <span style={{ display:'flex',gap:2 }}>{colors.map((c)=><span key={c} style={{ fontSize:13 }}>{COLOR_SYMBOLS[c]??c}</span>)}</span>;
}
function SubBar({ label, score, color, icon }) {
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:'flex',justifyContent:'space-between',marginBottom:3 }}>
        <span style={{ fontSize:11,color:'#94a3b8',display:'flex',alignItems:'center',gap:4 }}>{icon} {label}</span>
        <span style={{ fontSize:11,color,fontWeight:700,fontFamily:'monospace' }}>{Math.round(score)}</span>
      </div>
      <div style={{ height:3,background:'#1a1c2e',borderRadius:2,overflow:'hidden' }}>
        <div style={{ height:'100%',width:`${score}%`,background:color,borderRadius:2,transition:'width 0.4s ease',boxShadow:`0 0 4px ${color}55` }} />
      </div>
    </div>
  );
}

// ─── ExpandList — show N, +X more button, collapse ────────────────────────────

function ExpandList({ items, preview=12, renderItem }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, preview);
  const hidden  = items.length - preview;
  return (
    <>
      {visible.map((item, i) => renderItem(item, i))}
      {!showAll && hidden>0 && (
        <button onClick={()=>setShowAll(true)}
          style={{ background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#3b82f6',padding:'3px 8px',textDecoration:'underline',display:'block' }}>
          +{hidden} more
        </button>
      )}
      {showAll && items.length>preview && (
        <button onClick={()=>setShowAll(false)}
          style={{ background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#475569',padding:'3px 8px',textDecoration:'underline',display:'block' }}>
          show less
        </button>
      )}
    </>
  );
}

// ─── CollapsibleSection ───────────────────────────────────────────────────────

function CollapsibleSection({ title, count, defaultOpen=true, accent, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom:12 }}>
      <button onClick={()=>setOpen(o=>!o)}
        style={{ display:'flex',alignItems:'center',gap:6,width:'100%',background:'none',border:'none',cursor:'pointer',padding:'4px 0',marginBottom:open?4:0 }}>
        <span style={{ fontSize:10,color:open?'#64748b':'#334155',transition:'transform 0.15s',transform:open?'rotate(90deg)':'rotate(0deg)',display:'inline-block' }}>▶</span>
        <span style={{ fontSize:11,color:accent??'#64748b',fontWeight:700,textTransform:'uppercase',letterSpacing:1 }}>{title}</span>
        <span style={{ fontSize:11,color:'#334155',fontFamily:'monospace' }}>({count})</span>
      </button>
      {open && children}
    </div>
  );
}

// ─── Drag rows ────────────────────────────────────────────────────────────────

function cardUri(name, info) {
  return info?.scryfall_uri ?? `https://scryfall.com/search?q=!"${encodeURIComponent(name)}"`;
}

function DraggableCardRow({ card, priceMap, ownedSet, onDragStart }) {
  const key   = card.name.toLowerCase();
  const info  = priceMap?.get(key);
  const price = info?.price_usd ? parseFloat(info.price_usd) : null;
  const owned = ownedSet?.has(key);
  return (
    <div draggable onDragStart={(e)=>{ e.dataTransfer.effectAllowed='move'; onDragStart(card); }}
      style={{ display:'flex',alignItems:'center',gap:8,fontSize:12,padding:'4px 8px',borderRadius:5,cursor:'grab',userSelect:'none',background:owned?'#071a12':'#0a0c1a',border:'1px solid #181a2a' }}
      onMouseEnter={(e)=>e.currentTarget.style.borderColor=owned?'#22c55e40':'#3b82f640'}
      onMouseLeave={(e)=>e.currentTarget.style.borderColor='#181a2a'}
    >
      <span style={{ fontSize:10,color:'#334155' }}>⠿</span>
      <a href={cardUri(card.name,info)} target="_blank" rel="noopener noreferrer"
        style={{ color:owned?'#86efac':'#94a3b8',textDecoration:'none',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}
        onMouseEnter={(e)=>e.currentTarget.style.textDecoration='underline'}
        onMouseLeave={(e)=>e.currentTarget.style.textDecoration='none'}
        onClick={(e)=>e.stopPropagation()}
      >{card.name}</a>
      {owned && <span style={{ fontSize:10,color:'#22c55e',flexShrink:0 }}>✓</span>}
      {price!=null && <span style={{ color:'#475569',fontFamily:'monospace',fontSize:11,flexShrink:0 }}>${price.toFixed(2)}</span>}
    </div>
  );
}

function DroppableCardRow({ card, priceMap, ownedSet, striped, isDropTarget, isDragging, onDragStart, onDragOver, onDragLeave, onDrop }) {
  const key   = card.name.toLowerCase();
  const info  = priceMap?.get(key);
  const price = info?.price_usd ? parseFloat(info.price_usd) : null;
  const owned = ownedSet?.has(key);
  return (
    <div draggable
      onDragStart={(e)=>{ e.dataTransfer.effectAllowed='move'; onDragStart(card); }}
      onDragOver={(e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; onDragOver(card); }}
      onDragLeave={onDragLeave}
      onDrop={(e)=>{ e.preventDefault(); onDrop(card); }}
      style={{ display:'flex',alignItems:'center',gap:8,fontSize:12,padding:'3px 8px',borderRadius:4,cursor:isDragging?'copy':'grab',userSelect:'none',background:isDropTarget?'#0d2137':(striped?'#0a0c1a':'transparent'),border:isDropTarget?'1px dashed #3b82f6':'1px solid transparent',transition:'all 0.1s' }}
    >
      <span style={{ fontSize:10,color:'#252840' }}>⠿</span>
      <span style={{ color:'#334155',fontFamily:'monospace',minWidth:18,textAlign:'right',flexShrink:0 }}>{card.quantity??1}</span>
      <a href={cardUri(card.name,info)} target="_blank" rel="noopener noreferrer"
        style={{ color:owned?'#86efac':'#94a3b8',textDecoration:'none',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}
        onMouseEnter={(e)=>e.currentTarget.style.textDecoration='underline'}
        onMouseLeave={(e)=>e.currentTarget.style.textDecoration='none'}
        onClick={(e)=>e.stopPropagation()}
      >{card.name}</a>
      {owned && <span title="In your collection" style={{ fontSize:10,color:'#22c55e',flexShrink:0 }}>✓</span>}
      {price!=null ? <span style={{ color:'#475569',fontFamily:'monospace',fontSize:11,flexShrink:0 }}>${(price*(card.quantity??1)).toFixed(2)}</span>
                   : priceMap && <span style={{ color:'#1e2030',fontFamily:'monospace',fontSize:11,flexShrink:0 }}>—</span>}
    </div>
  );
}

// ─── BasicLandShelf — draggable basics the user owns ─────────────────────────

function BasicLandShelf({ userCollection, onDragStart }) {
  const available = BASIC_LAND_INFO.filter((b) => (userCollection?.get(b.name.toLowerCase())??0) >= 1);
  if (!available.length) return null;
  return (
    <div style={{ marginTop:14 }}>
      <div style={{ fontSize:11,color:'#475569',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:6 }}>Your Basics</div>
      <p style={{ fontSize:11,color:'#334155',marginBottom:8,lineHeight:1.4 }}>Drag a basic land onto any land in the deck to swap it in.</p>
      <div style={{ display:'flex',flexWrap:'wrap',gap:5 }}>
        {available.map((b) => {
          const qty = userCollection?.get(b.name.toLowerCase())??0;
          return (
            <div key={b.name} draggable
              onDragStart={(e)=>{ e.dataTransfer.effectAllowed='move'; onDragStart({ name:b.name, quantity:1, section:'land', isBasic:true }); }}
              style={{ display:'flex',alignItems:'center',gap:4,padding:'4px 10px',borderRadius:6,cursor:'grab',userSelect:'none',background:b.bg,border:`1px solid ${b.fg}30`,fontSize:12,color:b.fg,fontWeight:600 }}
              onMouseEnter={(e)=>e.currentTarget.style.opacity='0.85'}
              onMouseLeave={(e)=>e.currentTarget.style.opacity='1'}
            >
              {b.name}
              <span style={{ fontSize:10,opacity:0.6,fontFamily:'monospace' }}>×{qty}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DeckDetailModal ─────────────────────────────────────────────────────────

function DeckDetailModal({ deck, onClose, userCollection }) {
  const [priceMap,       setPriceMap]       = useState(null);
  const [loadingPrices,  setLoadingPrices]  = useState(true);
  const [localCards,     setLocalCards]     = useState(()=>deck?.keyCards??[]);
  const [localBench,     setLocalBench]     = useState(()=>deck?.swapIns??[]);
  const [isModified,     setIsModified]     = useState(false);
  const [saveState,      setSaveState]      = useState('idle'); // idle | saving | saved | error

  const dragRef     = useRef(null);
  const [dropTarget,  setDropTarget]  = useState(null);
  const [isDragging,  setIsDragging]  = useState(false);

  useEffect(() => {
    setLocalCards(deck?.keyCards??[]);
    setLocalBench(deck?.swapIns??[]);
    setIsModified(false);
    setSaveState('idle');
  }, [deck?.id]); // eslint-disable-line

  useEffect(() => {
    if (!deck) return;
    let cancelled = false;
    setLoadingPrices(true);
    const names = [...new Set([...(deck.keyCards??[]).map(c=>c.name), ...(deck.swapIns??[]).map(c=>c.name)])];
    resolveCardNames(names).then((resolved) => {
      if (cancelled) return;
      const map = new Map();
      for (const card of resolved) map.set(card.name.toLowerCase(), { price_usd:card.prices?.usd??card.prices?.usd_foil??null, scryfall_uri:card.scryfall_uri??null });
      setPriceMap(map); setLoadingPrices(false);
    }).catch(()=>{ if (!cancelled) setLoadingPrices(false); });
    return ()=>{ cancelled=true; };
  }, [deck?.id]); // eslint-disable-line

  const commander = useMemo(()=>localCards.filter(c=>c.section==='commander'), [localCards]);
  const mainboard = useMemo(()=>localCards.filter(c=>c.section==='mainboard'), [localCards]);
  const lands     = useMemo(()=>localCards.filter(c=>c.section==='land'),      [localCards]);
  const sideboard = useMemo(()=>localCards.filter(c=>c.section==='sideboard'), [localCards]);

  const limit      = FORMAT_LIMITS[deck?.format]??60;
  const totalCards = localCards.reduce((s,c)=>s+(c.quantity??1),0);

  const ownedSet = useMemo(()=>new Set(
    localCards.filter(c=>(userCollection?.get(c.name.toLowerCase())??0)>=(c.quantity??1)).map(c=>c.name.toLowerCase())
  ), [localCards, userCollection]);

  const deckNameSet = useMemo(()=>new Set(localCards.map(c=>c.name.toLowerCase())), [localCards]);

  const missingCards = useMemo(()=>
    localCards.filter(c=>c.section!=='sideboard'&&c.section!=='commander').reduce((arr,c)=>{
      const have=userCollection?.get(c.name.toLowerCase())??0;
      const need=Math.max(0,(c.quantity??1)-have);
      if (need>0) arr.push({ name:c.name, quantity:need });
      return arr;
    }, [])
  , [localCards, userCollection]);

  const missingCost = useMemo(()=>{ if (!priceMap) return null; return missingCards.reduce((s,c)=>{ const i=priceMap.get(c.name.toLowerCase()); return s+(i?.price_usd?parseFloat(i.price_usd)*c.quantity:0); },0); }, [missingCards,priceMap]);
  const totalDeckPrice = useMemo(()=>{ if (!priceMap) return null; return localCards.reduce((s,c)=>{ const i=priceMap.get(c.name.toLowerCase()); return s+(i?.price_usd?parseFloat(i.price_usd)*(c.quantity??1):0); },0); }, [localCards,priceMap]);
  const ownedSwapIns = useMemo(()=>localBench.filter(c=>!deckNameSet.has(c.name.toLowerCase())&&(userCollection?.get(c.name.toLowerCase())??0)>=1), [localBench,deckNameSet,userCollection]);

  const cmdCard  = commander[0];
  const cmdInfo  = cmdCard&&priceMap?.get(cmdCard.name.toLowerCase());
  const cmdOwned = cmdCard&&(userCollection?.get(cmdCard.name.toLowerCase())??0)>=1;

  // ── Drag ────────────────────────────────────────────────────────────────────

  function onDragStart(card, source) { dragRef.current={ card, source }; setIsDragging(true); }
  function onDragOver(targetCard) { if (dragRef.current?.card.name!==targetCard.name) setDropTarget(targetCard.name); }
  function onDragLeave() { setDropTarget(null); }

  function onDropOnDeckCard(targetCard) {
    const dragged = dragRef.current; dragRef.current=null; setDropTarget(null); setIsDragging(false);
    if (!dragged||dragged.card.name===targetCard.name) return;
    const { card: dc, source } = dragged;

    if (dc.isBasic) {
      // Basic land chip → replace target land with the basic
      if (targetCard.section !== 'land') return; // only swap onto lands
      setLocalCards(prev=>{
        const existing = prev.find(c=>c.name===dc.name&&c.section==='land');
        if (existing) {
          // increase existing basic by target qty, remove target
          return prev.filter(c=>c.name!==targetCard.name).map(c=>c.name===dc.name&&c.section==='land'?{ ...c, quantity:(c.quantity??1)+(targetCard.quantity??1) }:c);
        }
        // replace target with the basic
        return prev.map(c=>c.name===targetCard.name?{ ...dc, section:'land', quantity:targetCard.quantity??1 }:c);
      });
      setLocalBench(prev=>{ if (prev.some(c=>c.name===targetCard.name)) return prev; return [{ ...targetCard,quantity:1},...prev]; });
      setIsModified(true);
      return;
    }

    if (source==='bench') {
      setLocalCards(prev=>prev.map(c=>c.name===targetCard.name?{ ...dc, section:targetCard.section, quantity:targetCard.quantity??1 }:c));
      setLocalBench(prev=>{ const f=prev.filter(c=>c.name!==dc.name); return [{ ...targetCard, quantity:1 },...f]; });
      setIsModified(true);
    } else if (source==='deck') {
      setLocalCards(prev=>prev.map(c=>{
        if (c.name===targetCard.name) return { ...dc, section:targetCard.section, quantity:targetCard.quantity??1 };
        if (c.name===dc.name)         return { ...targetCard, section:dc.section, quantity:dc.quantity??1 };
        return c;
      }));
      setIsModified(true);
    }
  }

  function onDropOnBench(e) {
    e.preventDefault();
    const dragged=dragRef.current; dragRef.current=null; setDropTarget(null); setIsDragging(false);
    if (!dragged||dragged.source!=='deck') return;
    setLocalCards(prev=>prev.filter(c=>c.name!==dragged.card.name));
    setLocalBench(prev=>prev.some(c=>c.name===dragged.card.name)?prev:[dragged.card,...prev]);
    setIsModified(true);
  }

  function handleReset() { setLocalCards(deck?.keyCards??[]); setLocalBench(deck?.swapIns??[]); setIsModified(false); setSaveState('idle'); }

  // ── Save to My Decks ────────────────────────────────────────────────────────

  async function handleSaveToDeck() {
    setSaveState('saving');
    try {
      await saveDeck({
        name:     deck.name,
        format:   deck.format,
        strategy: deck.strategy,
        colors:   deck.colors,
        cards:    localCards.map(c=>({ name:c.name, quantity:c.quantity??1, section:c.section })),
        source:   'Sleeved Suggestions',
      });
      setSaveState('saved');
      setTimeout(()=>setSaveState('idle'), 3000);
    } catch (e) {
      console.error('[DeckSuggestions] save failed:', e);
      setSaveState('error');
      setTimeout(()=>setSaveState('idle'), 3000);
    }
  }

  if (!deck) return null;

  return (
    <div onClick={onClose} onDragEnd={()=>{ dragRef.current=null; setDropTarget(null); setIsDragging(false); }}
      style={{ position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.8)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:'#0f1121',border:'1px solid #2a2d45',borderRadius:16,width:'100%',maxWidth:920,maxHeight:'90vh',overflow:'hidden',display:'flex',flexDirection:'column',animation:'modalIn 0.2s ease' }}>

        {/* ── Header ── */}
        <div style={{ padding:'20px 24px 16px',borderBottom:'1px solid #1a1d2e',display:'flex',alignItems:'flex-start',gap:16 }}>
          <ScoreRing score={deck.mainScore??0} size={72} />
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:6 }}>
              <h2 style={{ margin:0,fontSize:20,fontWeight:800,color:'#f1f5f9' }}>{deck.name}</h2>
              <FormatBadge format={deck.format} /><StratBadge strategy={deck.strategy} />
              {isModified && <span style={{ fontSize:11,background:'#1e3a5f',color:'#60a5fa',borderRadius:4,padding:'1px 8px' }}>modified</span>}
            </div>
            {cmdCard && (
              <div style={{ display:'inline-flex',alignItems:'center',gap:8,background:'#12162a',border:'1px solid #2a2d45',borderRadius:7,padding:'4px 10px',marginBottom:8 }}>
                <a href={cmdInfo?.scryfall_uri??`https://scryfall.com/search?q=!"${encodeURIComponent(cmdCard.name)}"`} target="_blank" rel="noopener noreferrer"
                  style={{ color:cmdOwned?'#86efac':'#c084fc',fontWeight:700,fontSize:13,textDecoration:'none' }}
                  onMouseEnter={e=>e.currentTarget.style.textDecoration='underline'} onMouseLeave={e=>e.currentTarget.style.textDecoration='none'}
                >{cmdCard.name}</a>
                <span style={{ fontSize:10,color:'#334155' }}>·</span>
                {loadingPrices ? <span style={{ fontSize:11,color:'#334155' }}>…</span>
                  : cmdInfo?.price_usd ? <span style={{ fontSize:12,color:'#f59e0b',fontFamily:'monospace' }}>${parseFloat(cmdInfo.price_usd).toFixed(2)}</span>
                  : <span style={{ fontSize:11,color:'#334155' }}>price N/A</span>}
                {cmdOwned ? <span style={{ fontSize:11,color:'#22c55e' }}>✓ owned</span> : <span style={{ fontSize:11,color:'#f87171' }}>not owned</span>}
              </div>
            )}
            <div style={{ display:'flex',alignItems:'center',gap:10,flexWrap:'wrap' }}>
              <ColorPips colors={deck.colors} />
              <span style={{ fontSize:12,color:'#334155' }}>·</span>
              <span style={{ fontSize:12,color:totalCards>limit?'#f87171':'#64748b' }}>{totalCards}/{limit} cards</span>
              {totalDeckPrice!=null&&<><span style={{ fontSize:12,color:'#334155' }}>·</span><span style={{ fontSize:12,color:'#94a3b8' }}>Value <span style={{ color:'#e2e8f0',fontWeight:700,fontFamily:'monospace' }}>${totalDeckPrice.toFixed(2)}</span></span></>}
              {missingCost!=null&&missingCost>0&&<><span style={{ fontSize:12,color:'#334155' }}>·</span><span style={{ fontSize:12,color:'#94a3b8' }}>To acquire <span style={{ color:'#f59e0b',fontWeight:700,fontFamily:'monospace' }}>${missingCost.toFixed(2)}</span></span></>}
              {loadingPrices&&<span style={{ fontSize:11,color:'#334155' }}>Loading prices…</span>}
            </div>
            <p style={{ margin:'6px 0 0',fontSize:13,color:'#64748b',lineHeight:1.5 }}>{deck.description}</p>
          </div>

          {/* Action buttons */}
          <div style={{ display:'flex',gap:8,flexShrink:0,flexDirection:'column',alignItems:'flex-end' }}>
            <button onClick={onClose}
              style={{ background:'transparent',border:'1px solid #1e2030',color:'#475569',borderRadius:8,padding:'6px 10px',cursor:'pointer',fontSize:16,lineHeight:1 }}>✕</button>
            <button onClick={handleSaveToDeck} disabled={saveState==='saving'}
              style={{ background:saveState==='saved'?'#052e16':saveState==='error'?'#450a0a':'#1e3a5f',border:`1px solid ${saveState==='saved'?'#166534':saveState==='error'?'#7f1d1d':'#2a5fa0'}`,color:saveState==='saved'?'#4ade80':saveState==='error'?'#f87171':'#60a5fa',borderRadius:8,padding:'6px 14px',cursor:saveState==='saving'?'default':'pointer',fontSize:12,fontWeight:600,transition:'all 0.2s',whiteSpace:'nowrap' }}>
              {saveState==='saving'?'Saving…':saveState==='saved'?'✓ Saved!':saveState==='error'?'Save failed':'+ Add to My Decks'}
            </button>
            {isModified&&<button onClick={handleReset}
              style={{ background:'transparent',border:'1px solid #334155',color:'#475569',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12 }}>Reset</button>}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ overflowY:'auto',padding:'20px 24px',flex:1 }}>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:24 }}>

            {/* ── Left: scores + acquire + owned swaps + basics ── */}
            <div>
              <div style={{ fontSize:11,color:'#475569',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:12 }}>Score Breakdown</div>
              {Object.entries(SCORE_META).map(([k,m])=><SubBar key={k} label={m.label} score={deck.subscores?.[k]??0} color={m.color} icon={m.icon} />)}

              {/* Cards to Acquire — collapsible */}
              {missingCards.length>0&&(
                <CollapsibleSection title="Cards to Acquire" count={missingCards.length} defaultOpen={true} accent="#f59e0b">
                  <div style={{ display:'flex',justifyContent:'flex-end',marginBottom:6 }}>
                    {missingCost!=null&&<span style={{ fontSize:11,color:'#f59e0b',fontFamily:'monospace',fontWeight:700 }}>${missingCost.toFixed(2)} total</span>}
                  </div>
                  <ExpandList items={missingCards} preview={12} renderItem={(c)=>{
                    const info=priceMap?.get(c.name.toLowerCase());
                    const price=info?.price_usd?parseFloat(info.price_usd):null;
                    const uri=info?.scryfall_uri??`https://scryfall.com/search?q=!"${encodeURIComponent(c.name)}"`;
                    return (
                      <div key={c.name} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 10px',background:'#0a0c1a',border:'1px solid #1a1d2e',borderRadius:6,fontSize:12,marginBottom:3 }}>
                        <a href={uri} target="_blank" rel="noopener noreferrer"
                          style={{ color:'#94a3b8',textDecoration:'none',flex:1 }}
                          onMouseEnter={e=>e.currentTarget.style.color='#e2e8f0'} onMouseLeave={e=>e.currentTarget.style.color='#94a3b8'}>
                          <span style={{ color:'#334155',marginRight:6 }}>{c.quantity}×</span>{c.name}
                        </a>
                        {price!=null&&price>0&&<span style={{ color:'#f59e0b',fontFamily:'monospace',marginLeft:10,flexShrink:0 }}>${(price*c.quantity).toFixed(2)}</span>}
                      </div>
                    );
                  }} />
                </CollapsibleSection>
              )}

              {/* Owned swap-ins */}
              {ownedSwapIns.length>0&&(
                <div style={{ marginTop:8 }}>
                  <CollapsibleSection title="Cards You Could Swap In" count={ownedSwapIns.length} defaultOpen={true} accent="#4ade80">
                    <p style={{ fontSize:11,color:'#334155',marginBottom:8,lineHeight:1.4 }}>You own these — drag onto a deck card to swap in.</p>
                    <ExpandList items={ownedSwapIns} preview={12} renderItem={(c,i)=>(
                      <div key={c.name} style={{ marginBottom:2 }}>
                        <DraggableCardRow card={c} priceMap={priceMap} ownedSet={ownedSet} onDragStart={card=>onDragStart(card,'bench')} />
                      </div>
                    )} />
                  </CollapsibleSection>
                </div>
              )}

              {/* Basic land shelf */}
              <BasicLandShelf userCollection={userCollection} onDragStart={card=>onDragStart(card,'basic')} />

              {/* Source link */}
              {deck.sourceUrl&&(
                <div style={{ marginTop:16 }}>
                  <a href={deck.sourceUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display:'inline-flex',alignItems:'center',gap:6,background:'#1a1d2e',border:'1px solid #2a2d45',color:'#818cf8',borderRadius:8,padding:'9px 14px',fontSize:13,textDecoration:'none',transition:'border-color 0.15s' }}
                    onMouseEnter={e=>e.currentTarget.style.borderColor='#818cf8'} onMouseLeave={e=>e.currentTarget.style.borderColor='#2a2d45'}>
                    🔗 View on {deck.source}
                  </a>
                </div>
              )}
            </div>

            {/* ── Right: editable decklist ── */}
            <div>
              <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:10,color:'#334155',marginBottom:10 }}>
                <span style={{ display:'flex',alignItems:'center',gap:4 }}><span style={{ color:'#86efac' }}>■</span> In your collection</span>
                <span style={{ color:isDragging?'#3b82f6':'#252840' }}>{isDragging?'⬇ Drop to swap':'⠿ Drag to swap cards'}</span>
              </div>

              {/* Commander */}
              {commander.length>0&&(
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11,color:'#64748b',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:4 }}>Commander</div>
                  {commander.map(c=>{
                    const info=priceMap?.get(c.name.toLowerCase());
                    const price=info?.price_usd?parseFloat(info.price_usd):null;
                    const owned=ownedSet.has(c.name.toLowerCase());
                    return (
                      <div key={c.name} style={{ display:'flex',alignItems:'center',gap:8,fontSize:12,padding:'3px 8px' }}>
                        <span style={{ color:'#334155',fontFamily:'monospace',minWidth:18,textAlign:'right',flexShrink:0 }}>1</span>
                        <a href={cardUri(c.name,info)} target="_blank" rel="noopener noreferrer"
                          style={{ color:owned?'#86efac':'#c084fc',textDecoration:'none',flex:1 }}
                          onMouseEnter={e=>e.currentTarget.style.textDecoration='underline'} onMouseLeave={e=>e.currentTarget.style.textDecoration='none'}>{c.name}</a>
                        {owned&&<span style={{ fontSize:10,color:'#22c55e' }}>✓</span>}
                        {price!=null&&<span style={{ color:'#475569',fontFamily:'monospace',fontSize:11 }}>${price.toFixed(2)}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              <CollapsibleSection title="Mainboard" count={mainboard.reduce((s,c)=>s+(c.quantity??1),0)} defaultOpen={true}>
                {mainboard.map((c,i)=>(
                  <DroppableCardRow key={c.name} card={c} priceMap={priceMap} ownedSet={ownedSet} striped={i%2===0}
                    isDropTarget={dropTarget===c.name} isDragging={isDragging}
                    onDragStart={card=>onDragStart(card,'deck')} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDropOnDeckCard} />
                ))}
              </CollapsibleSection>

              <CollapsibleSection title="Lands" count={lands.reduce((s,c)=>s+(c.quantity??1),0)} defaultOpen={true}>
                {lands.map((c,i)=>(
                  <DroppableCardRow key={c.name} card={c} priceMap={priceMap} ownedSet={ownedSet} striped={i%2===0}
                    isDropTarget={dropTarget===c.name} isDragging={isDragging}
                    onDragStart={card=>onDragStart(card,'deck')} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDropOnDeckCard} />
                ))}
              </CollapsibleSection>

              {sideboard.length>0&&(
                <CollapsibleSection title="Sideboard" count={sideboard.reduce((s,c)=>s+(c.quantity??1),0)} defaultOpen={false}>
                  {sideboard.map((c,i)=>(
                    <DroppableCardRow key={c.name} card={c} priceMap={priceMap} ownedSet={ownedSet} striped={i%2===0}
                      isDropTarget={dropTarget===c.name} isDragging={isDragging}
                      onDragStart={card=>onDragStart(card,'deck')} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDropOnDeckCard} />
                  ))}
                </CollapsibleSection>
              )}

              {/* Bench */}
              {localBench.length>0&&(
                <CollapsibleSection title="Bench — Swap Candidates" count={localBench.length} defaultOpen={false}>
                  <div onDragOver={e=>e.preventDefault()} onDrop={onDropOnBench}
                    style={{ minHeight:isDragging?36:0,border:isDragging?'1px dashed #334155':'1px solid transparent',borderRadius:6,padding:isDragging?'4px 0':0,marginBottom:isDragging?6:0,transition:'all 0.15s' }}>
                    {isDragging&&dragRef.current?.source==='deck'&&(
                      <div style={{ fontSize:11,color:'#334155',textAlign:'center',padding:'6px 0' }}>Drop here to move card to bench</div>
                    )}
                  </div>
                  <ExpandList items={localBench} preview={10} renderItem={(c,i)=>(
                    <div key={c.name} style={{ marginBottom:2 }}>
                      <DraggableCardRow card={c} priceMap={priceMap} ownedSet={ownedSet} onDragStart={card=>onDragStart(card,'bench')} />
                    </div>
                  )} />
                </CollapsibleSection>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DeckCard (list row) ─────────────────────────────────────────────────────

function DeckCard({ deck, rank, onClick }) {
  const [hov, setHov] = useState(false);
  const rc    = rank===1?'#fbbf24':rank===2?'#94a3b8':rank===3?'#cd7f32':'#1e2030';
  const limit = FORMAT_LIMITS[deck.format]??60;
  const total = Math.min((deck.keyCards??[]).reduce((s,c)=>s+(c.quantity??1),0), limit);
  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ background:hov?'#141628':'#0d0f1e',border:`1px solid ${hov?'#252840':'#181a2a'}`,borderRadius:10,padding:'14px 18px',cursor:'pointer',transition:'all 0.15s',display:'flex',alignItems:'center',gap:14,position:'relative',overflow:'hidden' }}>
      <div style={{ position:'absolute',top:0,left:0,background:rc,color:rank<=3?'#000':'#334155',fontSize:9,fontWeight:800,padding:'2px 8px',borderBottomRightRadius:6,letterSpacing:1,fontFamily:'monospace' }}>#{rank}</div>
      <ScoreRing score={deck.mainScore??0} size={62} />
      <div style={{ flex:1,minWidth:0,paddingTop:4 }}>
        <div style={{ fontSize:14,fontWeight:700,color:'#e2e8f0',marginBottom:5,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{deck.name}</div>
        <div style={{ display:'flex',flexWrap:'wrap',gap:5,alignItems:'center' }}>
          <FormatBadge format={deck.format} sm /><StratBadge strategy={deck.strategy} /><ColorPips colors={deck.colors} />
          <span style={{ fontSize:10,color:'#334155',fontFamily:'monospace' }}>{total}/{limit}</span>
        </div>
      </div>
      <div style={{ textAlign:'right',flexShrink:0 }}>
        {deck.totalCost!=null&&<div style={{ fontSize:12,color:'#64748b',marginBottom:2 }}><span style={{ color:'#f59e0b',fontWeight:700 }}>${deck.totalCost.toFixed(0)}</span> to complete</div>}
        <div style={{ fontSize:11,color:'#334155' }}>{deck.missingCards?.length??0} cards missing</div>
        <div style={{ fontSize:10,color:'#252840',marginTop:2 }}>{deck.source}</div>
      </div>
      <div style={{ color:'#252840',fontSize:20,flexShrink:0 }}>›</div>
    </div>
  );
}

function WeightSlider({ k, value, onChange }) {
  const m = SCORE_META[k];
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ display:'flex',justifyContent:'space-between',marginBottom:4 }}>
        <span style={{ fontSize:12,color:'#94a3b8',display:'flex',alignItems:'center',gap:5 }}>{m.icon} {m.label}</span>
        <span style={{ fontSize:12,fontFamily:'monospace',color:m.color,fontWeight:700 }}>{value.toFixed(1)}×</span>
      </div>
      <input type="range" min={0} max={2} step={0.1} value={value} onChange={(e)=>onChange(parseFloat(e.target.value))} style={{ width:'100%',accentColor:m.color,cursor:'pointer' }} />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DeckSuggestions({ userCollection }) {
  const { user } = useAuth();
  const [activeFormat,   setActiveFormat]   = useState('modern');
  const [activeStrategy, setActiveStrategy] = useState('all');
  const [weights,        setWeights]        = useState({...DEFAULT_WEIGHTS});
  const [cmdSearch,      setCmdSearch]      = useState('');
  const [cmdSearching,   setCmdSearching]   = useState(false);
  const [cmdSearchError, setCmdSearchError] = useState(null);
  const [rawDecks,       setRawDecks]       = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError,   setCatalogError]   = useState(null);
  const [syncDate,       setSyncDate]       = useState(null);
  const [scoredDecks,    setScoredDecks]    = useState([]);
  const [detailDeck,     setDetailDeck]     = useState(null);
  const [displayDecks,   setDisplayDecks]   = useState([]);
  const profilesRef = useRef([]);

  useEffect(() => { if (!user) return; getDeckProfiles().then(p=>{ profilesRef.current=p; }).catch(()=>{}); }, [user]);

  async function handleCommanderSearch(e) {
    e.preventDefault();
    const name = cmdSearch.trim(); if (!name) return;
    const ss = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
    const ls = name.toLowerCase().replace(/[^a-z0-9\s]/g,'').trim().replace(/\s+/g,'-');
    if (rawDecks.some(d=>d.id===`scryfall-cmd-${ss}`||d.id===`edhrec-${ls}`)) { setCmdSearch(''); return; }
    setCmdSearching(true); setCmdSearchError(null);
    try {
      const deck=await fetchAndCacheCommanderDeck(name);
      if (!deck) setCmdSearchError(`Commander not found for "${name}". Check the spelling and try the full card name.`);
      else { setRawDecks(prev=>prev.some(d=>d.id===deck.id)?prev:[deck,...prev]); setCmdSearch(''); }
    } catch { setCmdSearchError('Search failed. Check your connection and try again.'); }
    finally { setCmdSearching(false); }
  }

  useEffect(() => {
    let alive=true;
    setLoadingCatalog(true); setCatalogError(null); setRawDecks([]); setScoredDecks([]); setDisplayDecks([]);
    loadDecksForFormat(activeFormat)
      .then(decks=>{ if (!alive) return; if (!decks.length) { setCatalogError('no_data'); setLoadingCatalog(false); return; } const d=decks.find(d=>d.syncDate||d.syncedAt); setSyncDate(d?.syncDate??d?.syncedAt??null); setRawDecks(decks); setLoadingCatalog(false); })
      .catch(e=>{ if (!alive) return; console.error('[DeckSuggestions]',e); setCatalogError('error'); setLoadingCatalog(false); });
    return ()=>{ alive=false; };
  }, [activeFormat]);

  useEffect(() => { if (!rawDecks.length) return; const s=scoreDecksChunk(rawDecks,userCollection??new Map(),profilesRef.current,weights); setScoredDecks([...s].sort((a,b)=>b.mainScore-a.mainScore)); }, [rawDecks,userCollection]); // eslint-disable-line
  useEffect(() => { if (!scoredDecks.length) return; setScoredDecks(prev=>[...prev.map(d=>({...d,mainScore:calculateMainScore(d.subscores??{},weights)}))].sort((a,b)=>b.mainScore-a.mainScore)); }, [weights]); // eslint-disable-line
  useEffect(() => { setDisplayDecks(activeStrategy==='all'?scoredDecks:scoredDecks.filter(d=>d.strategy===activeStrategy)); }, [scoredDecks,activeStrategy]);

  const strategies = ['all',...Array.from(new Set(scoredDecks.map(d=>d.strategy).filter(Boolean))).sort()];

  return (
    <div style={{ display:'grid',gridTemplateColumns:'240px 1fr',gap:20,minHeight:'80vh' }}>
      <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.97) translateY(6px)}to{opacity:1;transform:none}}@keyframes shimmer{0%{opacity:.4}50%{opacity:.7}100%{opacity:.4}}input[type=range]{-webkit-appearance:none;appearance:none;background:#1e2030;border-radius:4px;height:3px}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;cursor:pointer}`}</style>

      <aside style={{ background:'#0d0f1e',border:'1px solid #181a2a',borderRadius:14,padding:18,height:'fit-content',position:'sticky',top:20 }}>
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11,color:'#334155',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:8 }}>Format</div>
          {SUPPORTED_FORMATS.map(f=>{ const on=f===activeFormat,col=FORMAT_COLORS[f]; return (
            <button key={f} onClick={()=>{ setActiveFormat(f); setActiveStrategy('all'); }}
              style={{ display:'block',width:'100%',marginBottom:4,background:on?`${col}15`:'transparent',border:`1px solid ${on?col+'50':'#181a2a'}`,color:on?col:'#475569',borderRadius:8,padding:'8px 12px',fontSize:13,fontWeight:on?700:400,cursor:'pointer',textAlign:'left',transition:'all 0.15s' }}>
              {FORMAT_LABELS[f]}<span style={{ float:'right',fontSize:10,color:on?col+'80':'#252840',fontFamily:'monospace' }}>{FORMAT_LIMITS[f]}</span>
            </button>
          ); })}
        </div>

        {activeFormat==='commander'&&(
          <div style={{ marginBottom:18,paddingTop:14,borderTop:'1px solid #181a2a' }}>
            <div style={{ fontSize:11,color:'#334155',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:8 }}>Search Commander</div>
            <form onSubmit={handleCommanderSearch} style={{ display:'flex',flexDirection:'column',gap:6 }}>
              <input type="text" placeholder="e.g. Atraxa, Praetors' Voice" value={cmdSearch}
                onChange={e=>{ setCmdSearch(e.target.value); setCmdSearchError(null); }} disabled={cmdSearching}
                style={{ width:'100%',boxSizing:'border-box',background:'#080a18',border:'1px solid #1e2030',borderRadius:7,padding:'7px 10px',color:'#e2e8f0',fontSize:12,outline:'none',opacity:cmdSearching?0.5:1 }} />
              <button type="submit" disabled={cmdSearching||!cmdSearch.trim()}
                style={{ background:cmdSearching||!cmdSearch.trim()?'#1e2030':'#3730a3',border:'none',borderRadius:7,padding:'7px 0',color:cmdSearching||!cmdSearch.trim()?'#334155':'#e2e8f0',fontSize:12,fontWeight:600,cursor:cmdSearching||!cmdSearch.trim()?'default':'pointer',transition:'all 0.15s' }}>
                {cmdSearching?'Searching…':'Add Commander'}
              </button>
              {cmdSearchError&&<p style={{ margin:0,fontSize:11,color:'#f87171',lineHeight:1.4 }}>{cmdSearchError}</p>}
            </form>
          </div>
        )}

        {strategies.length>2&&(
          <div style={{ marginBottom:18,paddingTop:14,borderTop:'1px solid #181a2a' }}>
            <div style={{ fontSize:11,color:'#334155',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:8 }}>Strategy</div>
            {strategies.map(s=>{ const on=s===activeStrategy; return (
              <button key={s} onClick={()=>setActiveStrategy(s)}
                style={{ display:'block',width:'100%',marginBottom:2,background:on?'#181a2a':'transparent',border:`1px solid ${on?'#252840':'transparent'}`,color:on?'#e2e8f0':'#475569',borderRadius:6,padding:'6px 10px',fontSize:12,cursor:'pointer',textAlign:'left',transition:'all 0.1s',textTransform:'capitalize' }}>
                {s==='all'?'🎴 All':`${STRATEGY_ICONS[s]??'🎴'} ${s}`}
              </button>
            ); })}
          </div>
        )}

        <div style={{ paddingTop:14,borderTop:'1px solid #181a2a' }}>
          <div style={{ fontSize:11,color:'#334155',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:12 }}>Score Weights</div>
          {Object.keys(DEFAULT_WEIGHTS).map(k=><WeightSlider key={k} k={k} value={weights[k]} onChange={v=>setWeights(p=>({...p,[k]:v}))} />)}
          <button onClick={()=>setWeights({...DEFAULT_WEIGHTS})}
            style={{ width:'100%',marginTop:6,background:'transparent',border:'1px solid #181a2a',color:'#334155',borderRadius:7,padding:'7px 0',fontSize:11,cursor:'pointer',transition:'all 0.15s' }}
            onMouseEnter={e=>{ e.target.style.color='#64748b'; e.target.style.borderColor='#252840'; }}
            onMouseLeave={e=>{ e.target.style.color='#334155'; e.target.style.borderColor='#181a2a'; }}>
            Reset to defaults
          </button>
        </div>
      </aside>

      <main>
        <div style={{ marginBottom:16 }}>
          <h1 style={{ fontSize:22,fontWeight:800,margin:'0 0 4px',color:'#f1f5f9' }}>Deck Suggestions</h1>
          <p style={{ margin:0,fontSize:13,color:'#334155' }}>
            {loadingCatalog?'Loading catalog…':catalogError==='no_data'?`No decks synced yet for ${FORMAT_LABELS[activeFormat]}`:catalogError==='error'?'Failed to load catalog':`${displayDecks.length} ${FORMAT_LABELS[activeFormat]} decks · sorted by your weights`}
            {syncDate&&!loadingCatalog&&!catalogError&&<span style={{ color:'#252840',marginLeft:8 }}>· synced {syncDate}</span>}
          </p>
        </div>

        {loadingCatalog&&<div style={{ marginBottom:14 }}><div style={{ height:2,background:'#181a2a',borderRadius:2,overflow:'hidden' }}><div style={{ height:'100%',width:'100%',background:FORMAT_COLORS[activeFormat],borderRadius:2,animation:'shimmer 1.2s infinite' }} /></div></div>}

        {catalogError==='error'&&!loadingCatalog&&<div style={{ background:'#120a0a',border:'1px solid #5a1d1d',borderRadius:12,padding:'16px 20px',color:'#fca5a5',fontSize:13,lineHeight:1.6 }}><strong>Failed to load deck catalog.</strong> Ensure Firestore rules allow reads from <code style={{ background:'#1a0a0a',padding:'1px 5px',borderRadius:4 }}>meta_decks/{'{format}'}/decks</code>.</div>}

        {catalogError==='no_data'&&!loadingCatalog&&<div style={{ background:'#0d0f1e',border:'1px dashed #1e2030',borderRadius:12,padding:48,textAlign:'center' }}><div style={{ fontSize:32,marginBottom:14 }}>🌙</div><h3 style={{ color:'#e2e8f0',margin:'0 0 8px',fontSize:16 }}>No decks synced yet</h3><p style={{ color:'#334155',fontSize:13,margin:'0 auto',maxWidth:420,lineHeight:1.6 }}>The nightly sync hasn't run for <strong style={{ color:'#475569' }}>{FORMAT_LABELS[activeFormat]}</strong>. Trigger <code style={{ color:'#818cf8' }}>sync-decks</code> or wait for 3 AM UTC.</p></div>}

        {!loadingCatalog&&!catalogError&&rawDecks.length>0&&displayDecks.length===0&&<div style={{ background:'#0d0f1e',border:'1px dashed #181a2a',borderRadius:12,padding:40,textAlign:'center',color:'#334155',fontSize:13 }}>No decks match the current filters. Try a different strategy.</div>}

        {!loadingCatalog&&displayDecks.length>0&&(
          <div style={{ display:'flex',flexDirection:'column',gap:7 }}>
            {displayDecks.map((deck,i)=><DeckCard key={deck.id} deck={deck} rank={i+1} onClick={()=>setDetailDeck(deck)} />)}
          </div>
        )}
      </main>

      {detailDeck&&<DeckDetailModal deck={detailDeck} onClose={()=>setDetailDeck(null)} userCollection={userCollection} />}
    </div>
  );
}
