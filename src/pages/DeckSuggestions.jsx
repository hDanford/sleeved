// src/pages/DeckSuggestions.jsx

import { useState, useEffect, useRef } from 'react';
import { loadDecksForFormat, SUPPORTED_FORMATS, fetchAndCacheCommanderDeck } from '../utils/deckCatalog';
import {
  scoreDeck,
  calculateMainScore,
  DEFAULT_WEIGHTS,
  SCORE_META,
} from '../utils/deckScoring';
import { resolveCardNames } from '../utils/scryfallApi';
import { useAuth } from '../App';
import { getDeckProfiles } from '../utils/deckSync';

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMAT_LABELS = {
  standard: 'Standard',
  modern: 'Modern',
  pioneer: 'Pioneer',
  commander: 'Commander',
};

const FORMAT_COLORS = {
  standard: '#22c55e',
  modern: '#818cf8',
  pioneer: '#f59e0b',
  commander: '#ef4444',
};

// Hard deck-size limits by format
const FORMAT_DECK_SIZE = {
  standard: 60,
  modern: 60,
  pioneer: 60,
  commander: 100,
};

const STRATEGY_ICONS = {
  aggro: '⚡', control: '🛡️', combo: '🔄', midrange: '⚔️',
  ramp: '🌱', tempo: '💨', tribal: '👥', goodstuff: '✨',
};

const COLOR_SYMBOLS = { W: '☀️', U: '💧', B: '💀', R: '🔥', G: '🌿' };

// ─── Score helpers ────────────────────────────────────────────────────────────

function scoreDecksChunk(rawDecks, userCollection, userDeckProfiles, weights) {
  return rawDecks.map((deck) => {
    const scored = scoreDeck({
      deckList: deck.keyCards ?? [],
      resolvedCards: [],
      userCollection,
      userDeckProfiles,
      weights,
    });
    return { ...deck, ...scored, resolvedCards: null };
  });
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

function ScoreRing({ score, size = 64 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, score / 100)) * circ;
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e2030" strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.5s ease' }} />
      <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={size * 0.21} fontWeight="800"
        style={{ transform: `rotate(90deg)`, transformOrigin: `${size / 2}px ${size / 2}px`, fontFamily: 'monospace' }}>
        {Math.round(score)}
      </text>
    </svg>
  );
}

function FormatBadge({ format, sm }) {
  const color = FORMAT_COLORS[format] ?? '#64748b';
  return (
    <span style={{
      background: `${color}18`, color, border: `1px solid ${color}40`,
      borderRadius: 5, padding: sm ? '1px 6px' : '2px 8px',
      fontSize: sm ? 10 : 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {FORMAT_LABELS[format] ?? format}
    </span>
  );
}

function StratBadge({ strategy }) {
  return (
    <span style={{
      background: '#1e2030', color: '#94a3b8', borderRadius: 5,
      padding: '2px 7px', fontSize: 11, textTransform: 'capitalize',
    }}>
      {STRATEGY_ICONS[strategy] ?? '🎴'} {strategy}
    </span>
  );
}

function ColorPips({ colors }) {
  if (!colors?.length) return null;
  return (
    <span style={{ display: 'flex', gap: 2 }}>
      {colors.map((c) => <span key={c} style={{ fontSize: 13 }}>{COLOR_SYMBOLS[c] ?? c}</span>)}
    </span>
  );
}

function SubBar({ label, score, color, icon }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
          {icon} {label}
        </span>
        <span style={{ fontSize: 11, color, fontWeight: 700, fontFamily: 'monospace' }}>
          {Math.round(score)}
        </span>
      </div>
      <div style={{ height: 3, background: '#1a1c2e', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${score}%`, background: color, borderRadius: 2,
          transition: 'width 0.4s ease', boxShadow: `0 0 4px ${color}55`,
        }} />
      </div>
    </div>
  );
}

// ─── CardRow — single card line with link, owned highlight, price ─────────────

function CardRow({ card, priceMap, ownedSet, striped }) {
  const key = card.name.toLowerCase();
  const info = priceMap?.get(key);
  const price = info?.price_usd ? parseFloat(info.price_usd) : null;
  const uri = info?.scryfall_uri
    ?? `https://scryfall.com/search?q=!"${encodeURIComponent(card.name)}"`;
  const owned = ownedSet?.has(key);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
      padding: '3px 8px', borderRadius: 4,
      background: striped ? '#0a0c1a' : 'transparent',
    }}>
      <span style={{ color: '#334155', fontFamily: 'monospace', minWidth: 18, textAlign: 'right', flexShrink: 0 }}>
        {card.quantity ?? 1}
      </span>
      <a
        href={uri} target="_blank" rel="noopener noreferrer"
        style={{ color: owned ? '#86efac' : '#94a3b8', textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
      >
        {card.name}
      </a>
      {owned && <span title="In your collection" style={{ fontSize: 10, color: '#22c55e', flexShrink: 0 }}>✓</span>}
      {price != null ? (
        <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
          ${(price * (card.quantity ?? 1)).toFixed(2)}
        </span>
      ) : priceMap && (
        <span style={{ color: '#1e2030', fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>—</span>
      )}
    </div>
  );
}

// ─── CardSection — collapsible, with "show all" expansion ────────────────────

function CardSection({ title, cards, priceMap, ownedSet, defaultOpen = true, initialShowAll = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(initialShowAll);

  if (!cards.length) return null;
  const total = cards.reduce((s, c) => s + (c.quantity ?? 1), 0);
  const PREVIEW = 8;
  const visible = showAll ? cards : cards.slice(0, PREVIEW);
  const hidden = cards.length - PREVIEW;

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 0', marginBottom: open ? 4 : 0,
        }}
      >
        <span style={{
          fontSize: 10, color: open ? '#64748b' : '#334155',
          transition: 'transform 0.15s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          display: 'inline-block',
        }}>▶</span>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
          {title}
        </span>
        <span style={{ fontSize: 11, color: '#334155', fontFamily: 'monospace' }}>({total})</span>
        {!open && (
          <span style={{ fontSize: 10, color: '#1e2030', marginLeft: 'auto' }}>click to expand</span>
        )}
      </button>

      {open && (
        <>
          {visible.map((c, i) => (
            <CardRow key={`${c.name}-${i}`} card={c} priceMap={priceMap} ownedSet={ownedSet} striped={i % 2 === 0} />
          ))}
          {!showAll && hidden > 0 && (
            <button
              onClick={() => setShowAll(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: '#3b82f6', padding: '3px 8px',
                textDecoration: 'underline',
              }}
            >
              +{hidden} more
            </button>
          )}
          {showAll && cards.length > PREVIEW && (
            <button
              onClick={() => setShowAll(false)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: '#475569', padding: '3px 8px',
                textDecoration: 'underline',
              }}
            >
              show less
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Expandable list — for acquire / bench / owned swaps ─────────────────────

function ExpandableList({ children, total, preview = 12 }) {
  const [showAll, setShowAll] = useState(false);
  const items = Array.isArray(children) ? children : [children];
  const visible = showAll ? items : items.slice(0, preview);
  const hidden = items.length - preview;

  return (
    <>
      {visible}
      {!showAll && hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: '#3b82f6', padding: '4px 10px',
            textDecoration: 'underline', display: 'block',
          }}
        >
          +{hidden} more
        </button>
      )}
      {showAll && items.length > preview && (
        <button
          onClick={() => setShowAll(false)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: '#475569', padding: '4px 10px',
            textDecoration: 'underline', display: 'block',
          }}
        >
          show less
        </button>
      )}
    </>
  );
}

// ─── Deck Detail Modal ────────────────────────────────────────────────────────

function DeckDetailModal({ deck, onClose, userCollection }) {
  const [priceMap, setPriceMap] = useState(null);
  const [loadingPrices, setLoadingPrices] = useState(true);

  useEffect(() => {
    if (!deck) return;
    let cancelled = false;

    const allNames = [
      ...(deck.keyCards ?? []).map((c) => c.name),
      ...(deck.swapIns ?? []).map((c) => c.name),
    ];
    const uniqueNames = [...new Set(allNames)];

    resolveCardNames(uniqueNames).then((resolved) => {
      if (cancelled) return;
      const map = new Map();
      for (const card of resolved) {
        map.set(card.name.toLowerCase(), {
          price_usd: card.prices?.usd ?? card.prices?.usd_foil ?? null,
          scryfall_uri: card.scryfall_uri ?? null,
        });
      }
      setPriceMap(map);
      setLoadingPrices(false);
    }).catch(() => { if (!cancelled) setLoadingPrices(false); });

    return () => { cancelled = true; };
  }, [deck?.id]); // eslint-disable-line

  if (!deck) return null;

  const cards     = deck.keyCards ?? [];
  const commander = cards.filter((c) => c.section === 'commander');
  const mainboard = cards.filter((c) => c.section === 'mainboard');
  const lands     = cards.filter((c) => c.section === 'land');
  const sideboard = cards.filter((c) => c.section === 'sideboard');
  const swapIns   = deck.swapIns ?? [];

  // Hard deck-size limit
  const limit = FORMAT_DECK_SIZE[deck.format] ?? 60;
  const totalCards = Math.min(
    cards.reduce((s, c) => s + (c.quantity ?? 1), 0),
    limit
  );

  const deckNameSet = new Set(cards.map((c) => c.name.toLowerCase()));

  const ownedSet = new Set(
    cards
      .filter((c) => (userCollection?.get(c.name.toLowerCase()) ?? 0) >= (c.quantity ?? 1))
      .map((c) => c.name.toLowerCase())
  );

  // Commander card info for the header callout
  const cmdCard = commander[0];
  const cmdInfo = cmdCard && priceMap?.get(cmdCard.name.toLowerCase());
  const cmdOwned = cmdCard && (userCollection?.get(cmdCard.name.toLowerCase()) ?? 0) >= 1;

  const ownedSwapIns = swapIns.filter((c) => {
    const key = c.name.toLowerCase();
    return !deckNameSet.has(key) && (userCollection?.get(key) ?? 0) >= 1;
  });

  const totalDeckPrice = priceMap
    ? cards.reduce((sum, c) => {
        const info = priceMap.get(c.name.toLowerCase());
        return sum + (info?.price_usd ? parseFloat(info.price_usd) * (c.quantity ?? 1) : 0);
      }, 0)
    : null;

  const totalMissingCost = priceMap
    ? cards.filter((c) => c.section !== 'sideboard').reduce((sum, c) => {
        const key = c.name.toLowerCase();
        const need = Math.max(0, (c.quantity ?? 1) - (userCollection?.get(key) ?? 0));
        if (need === 0) return sum;
        const info = priceMap.get(key);
        return sum + (info?.price_usd ? parseFloat(info.price_usd) * need : 0);
      }, 0)
    : null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#0f1121', border: '1px solid #2a2d45',
        borderRadius: 16, width: '100%', maxWidth: 860,
        maxHeight: '90vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        animation: 'modalIn 0.2s ease',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #1a1d2e',
          display: 'flex', alignItems: 'flex-start', gap: 16,
        }}>
          <ScoreRing score={deck.mainScore ?? 0} size={72} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>{deck.name}</h2>
              <FormatBadge format={deck.format} />
              <StratBadge strategy={deck.strategy} />
            </div>

            {/* Commander callout — price + owned */}
            {cmdCard && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: '#12162a', border: '1px solid #2a2d45',
                borderRadius: 7, padding: '4px 10px', marginBottom: 8,
              }}>
                <a
                  href={cmdInfo?.scryfall_uri ?? `https://scryfall.com/search?q=!"${encodeURIComponent(cmdCard.name)}"`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: cmdOwned ? '#86efac' : '#c084fc', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
                  onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                >
                  {cmdCard.name}
                </a>
                <span style={{ fontSize: 10, color: '#334155' }}>·</span>
                {loadingPrices ? (
                  <span style={{ fontSize: 11, color: '#334155' }}>…</span>
                ) : cmdInfo?.price_usd ? (
                  <span style={{ fontSize: 12, color: '#f59e0b', fontFamily: 'monospace' }}>
                    ${parseFloat(cmdInfo.price_usd).toFixed(2)}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#334155' }}>price N/A</span>
                )}
                {cmdOwned
                  ? <span style={{ fontSize: 11, color: '#22c55e' }}>✓ owned</span>
                  : <span style={{ fontSize: 11, color: '#f87171' }}>not owned</span>
                }
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <ColorPips colors={deck.colors} />
              <span style={{ fontSize: 12, color: '#334155' }}>·</span>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {totalCards}/{limit} cards
              </span>
              {totalDeckPrice != null && (
                <>
                  <span style={{ fontSize: 12, color: '#334155' }}>·</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>
                    Value <span style={{ color: '#e2e8f0', fontWeight: 700, fontFamily: 'monospace' }}>
                      ${totalDeckPrice.toFixed(2)}
                    </span>
                  </span>
                </>
              )}
              {totalMissingCost != null && totalMissingCost > 0 && (
                <>
                  <span style={{ fontSize: 12, color: '#334155' }}>·</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>
                    To acquire <span style={{ color: '#f59e0b', fontWeight: 700, fontFamily: 'monospace' }}>
                      ${totalMissingCost.toFixed(2)}
                    </span>
                  </span>
                </>
              )}
              {loadingPrices && <span style={{ fontSize: 11, color: '#334155' }}>Loading prices…</span>}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{deck.description}</p>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid #1e2030',
            color: '#475569', borderRadius: 8, padding: '6px 10px',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0,
          }}>✕</button>
        </div>

        {/* ── Body ── */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

            {/* ── Left: scores + acquire + owned swaps ── */}
            <div>
              <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                Score Breakdown
              </div>
              {Object.entries(SCORE_META).map(([k, m]) => (
                <SubBar key={k} label={m.label} score={deck.subscores?.[k] ?? 0} color={m.color} icon={m.icon} />
              ))}

              {/* Cards to acquire */}
              {deck.missingCards?.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{
                    fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: 1, marginBottom: 10, display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span>Cards to Acquire</span>
                    {totalMissingCost != null && (
                      <span style={{ color: '#f59e0b', fontFamily: 'monospace' }}>${totalMissingCost.toFixed(2)}</span>
                    )}
                  </div>
                  <ExpandableList preview={12}>
                    {deck.missingCards.map((c) => {
                      const key = c.name.toLowerCase();
                      const info = priceMap?.get(key);
                      const price = info?.price_usd ? parseFloat(info.price_usd) : null;
                      const uri = info?.scryfall_uri ?? `https://scryfall.com/search?q=!"${encodeURIComponent(c.name)}"`;
                      return (
                        <div key={c.name} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '5px 10px', background: '#0a0c1a',
                          border: '1px solid #1a1d2e', borderRadius: 6, fontSize: 12, marginBottom: 3,
                        }}>
                          <a href={uri} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#94a3b8', textDecoration: 'none', flex: 1 }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#e2e8f0'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; }}
                          >
                            <span style={{ color: '#334155', marginRight: 6 }}>{c.quantity}×</span>
                            {c.name}
                          </a>
                          {price != null && price > 0 && (
                            <span style={{ color: '#f59e0b', fontFamily: 'monospace', marginLeft: 10, flexShrink: 0 }}>
                              ${(price * c.quantity).toFixed(2)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </ExpandableList>
                </div>
              )}

              {/* Owned swap-ins */}
              {ownedSwapIns.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: 1, marginBottom: 8,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ background: '#052e16', color: '#4ade80', borderRadius: 4, padding: '1px 6px', fontSize: 10 }}>
                      OWNED
                    </span>
                    <span style={{ color: '#475569' }}>Cards You Could Swap In</span>
                  </div>
                  <p style={{ fontSize: 11, color: '#334155', marginBottom: 8, lineHeight: 1.4 }}>
                    You own these synergy cards — they didn't make the auto-built list but fit the strategy.
                  </p>
                  <ExpandableList preview={12}>
                    {ownedSwapIns.map((c, i) => {
                      const key = c.name.toLowerCase();
                      const info = priceMap?.get(key);
                      const uri = info?.scryfall_uri ?? `https://scryfall.com/search?q=!"${encodeURIComponent(c.name)}"`;
                      return (
                        <div key={c.name} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '4px 8px', borderRadius: 4, marginBottom: 2,
                          background: i % 2 === 0 ? '#071a12' : 'transparent',
                        }}>
                          <a href={uri} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#86efac', textDecoration: 'none', fontSize: 12, flex: 1 }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                          >
                            {c.name}
                          </a>
                          <span style={{ fontSize: 10, color: '#22c55e', marginLeft: 8, flexShrink: 0 }}>✓ owned</span>
                        </div>
                      );
                    })}
                  </ExpandableList>
                </div>
              )}

              {/* Source link */}
              {deck.sourceUrl && (
                <div style={{ marginTop: 20 }}>
                  <a href={deck.sourceUrl} target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: '#1a1d2e', border: '1px solid #2a2d45',
                      color: '#818cf8', borderRadius: 8,
                      padding: '9px 14px', fontSize: 13, textDecoration: 'none',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = '#818cf8'}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = '#2a2d45'}
                  >
                    🔗 View on {deck.source}
                  </a>
                </div>
              )}
            </div>

            {/* ── Right: decklist ── */}
            <div>
              {/* Legend */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 10, color: '#334155', marginBottom: 10 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#86efac' }}>■</span> In your collection
                </span>
                {loadingPrices && <span style={{ color: '#475569' }}>Loading prices…</span>}
              </div>

              {/* Commander shown separately — always expanded, no collapse */}
              {commander.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                    Commander
                  </div>
                  {commander.map((c, i) => (
                    <CardRow key={c.name} card={c} priceMap={priceMap} ownedSet={ownedSet} striped={false} />
                  ))}
                </div>
              )}

              <CardSection title="Mainboard"  cards={mainboard} priceMap={priceMap} ownedSet={ownedSet} defaultOpen={true} />
              <CardSection title="Lands"      cards={lands}     priceMap={priceMap} ownedSet={ownedSet} defaultOpen={true} />
              <CardSection title="Sideboard"  cards={sideboard} priceMap={priceMap} ownedSet={ownedSet} defaultOpen={false} />

              {/* Bench swap-ins */}
              {swapIns.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => {}}
                    style={{ display: 'none' }}
                    aria-hidden="true"
                  />
                  <CardSection
                    title="Bench (Swap Candidates)"
                    cards={swapIns.map((c) => ({ ...c, quantity: c.quantity ?? 1 }))}
                    priceMap={priceMap}
                    ownedSet={new Set([...ownedSet, ...ownedSwapIns.map((c) => c.name.toLowerCase())])}
                    defaultOpen={false}
                    initialShowAll={false}
                  />
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Deck row card ────────────────────────────────────────────────────────────

function DeckCard({ deck, rank, onClick }) {
  const [hov, setHov] = useState(false);
  const rc = rank === 1 ? '#fbbf24' : rank === 2 ? '#94a3b8' : rank === 3 ? '#cd7f32' : '#1e2030';
  const limit = FORMAT_DECK_SIZE[deck.format] ?? 60;
  const totalCards = (deck.keyCards ?? []).reduce((s, c) => s + (c.quantity ?? 1), 0);

  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? '#141628' : '#0d0f1e',
        border: `1px solid ${hov ? '#252840' : '#181a2a'}`,
        borderRadius: 10, padding: '14px 18px', cursor: 'pointer',
        transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 14,
        position: 'relative', overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0,
        background: rc, color: rank <= 3 ? '#000' : '#334155',
        fontSize: 9, fontWeight: 800, padding: '2px 8px',
        borderBottomRightRadius: 6, letterSpacing: 1, fontFamily: 'monospace',
      }}>
        #{rank}
      </div>

      <ScoreRing score={deck.mainScore ?? 0} size={62} />

      <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {deck.name}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          <FormatBadge format={deck.format} sm />
          <StratBadge strategy={deck.strategy} />
          <ColorPips colors={deck.colors} />
          <span style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace' }}>
            {Math.min(totalCards, limit)}/{limit}
          </span>
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {deck.totalCost != null && (
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>
            <span style={{ color: '#f59e0b', fontWeight: 700 }}>${deck.totalCost.toFixed(0)}</span> to complete
          </div>
        )}
        <div style={{ fontSize: 11, color: '#334155' }}>{deck.missingCards?.length ?? 0} cards missing</div>
        <div style={{ fontSize: 10, color: '#252840', marginTop: 2 }}>{deck.source}</div>
      </div>

      <div style={{ color: '#252840', fontSize: 20, flexShrink: 0 }}>›</div>
    </div>
  );
}

// ─── Weight slider ────────────────────────────────────────────────────────────

function WeightSlider({ k, value, onChange }) {
  const m = SCORE_META[k];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
          {m.icon} {m.label}
        </span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: m.color, fontWeight: 700 }}>
          {value.toFixed(1)}×
        </span>
      </div>
      <input type="range" min={0} max={2} step={0.1} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: m.color, cursor: 'pointer' }} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DeckSuggestions({ userCollection }) {
  const { user } = useAuth();

  const [activeFormat, setActiveFormat] = useState('modern');
  const [activeStrategy, setActiveStrategy] = useState('all');
  const [weights, setWeights] = useState({ ...DEFAULT_WEIGHTS });

  const [cmdSearch, setCmdSearch] = useState('');
  const [cmdSearching, setCmdSearching] = useState(false);
  const [cmdSearchError, setCmdSearchError] = useState(null);

  const [rawDecks, setRawDecks] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [syncDate, setSyncDate] = useState(null);

  const [scoredDecks, setScoredDecks] = useState([]);
  const [detailDeck, setDetailDeck] = useState(null);
  const [displayDecks, setDisplayDecks] = useState([]);

  const profilesRef = useRef([]);
  useEffect(() => {
    if (!user) return;
    getDeckProfiles().then((p) => { profilesRef.current = p; }).catch(() => {});
  }, [user]);

  async function handleCommanderSearch(e) {
    e.preventDefault();
    const name = cmdSearch.trim();
    if (!name) return;

    const scryfallSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const legacySlug   = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-');
    const alreadyLoaded = rawDecks.some(
      (d) => d.id === `scryfall-cmd-${scryfallSlug}` || d.id === `edhrec-${legacySlug}`
    );
    if (alreadyLoaded) { setCmdSearch(''); return; }

    setCmdSearching(true);
    setCmdSearchError(null);
    try {
      const deck = await fetchAndCacheCommanderDeck(name);
      if (!deck) {
        setCmdSearchError(`Commander not found for "${name}". Check the spelling and try the full card name.`);
      } else {
        setRawDecks((prev) => prev.some((d) => d.id === deck.id) ? prev : [deck, ...prev]);
        setCmdSearch('');
      }
    } catch {
      setCmdSearchError('Search failed. Check your connection and try again.');
    } finally {
      setCmdSearching(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setLoadingCatalog(true);
    setCatalogError(null);
    setRawDecks([]);
    setScoredDecks([]);
    setDisplayDecks([]);

    loadDecksForFormat(activeFormat)
      .then((decks) => {
        if (!alive) return;
        if (!decks.length) { setCatalogError('no_data'); setLoadingCatalog(false); return; }
        const date = decks.find((d) => d.syncDate || d.syncedAt);
        setSyncDate(date?.syncDate ?? date?.syncedAt ?? null);
        setRawDecks(decks);
        setLoadingCatalog(false);
      })
      .catch((e) => {
        if (!alive) return;
        console.error('[DeckSuggestions]', e);
        setCatalogError('error');
        setLoadingCatalog(false);
      });

    return () => { alive = false; };
  }, [activeFormat]);

  useEffect(() => {
    if (!rawDecks.length) return;
    const scored = scoreDecksChunk(rawDecks, userCollection ?? new Map(), profilesRef.current, weights);
    setScoredDecks([...scored].sort((a, b) => b.mainScore - a.mainScore));
  }, [rawDecks, userCollection]); // eslint-disable-line

  useEffect(() => {
    if (!scoredDecks.length) return;
    const rescored = scoredDecks
      .map((d) => ({ ...d, mainScore: calculateMainScore(d.subscores ?? {}, weights) }))
      .sort((a, b) => b.mainScore - a.mainScore);
    setScoredDecks(rescored);
  }, [weights]); // eslint-disable-line

  useEffect(() => {
    setDisplayDecks(
      activeStrategy === 'all' ? scoredDecks : scoredDecks.filter((d) => d.strategy === activeStrategy)
    );
  }, [scoredDecks, activeStrategy]);

  const strategies = ['all', ...Array.from(new Set(scoredDecks.map((d) => d.strategy).filter(Boolean))).sort()];
  const isLoading = loadingCatalog;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, minHeight: '80vh' }}>
      <style>{`
        @keyframes modalIn { from { opacity:0; transform:scale(0.97) translateY(6px); } to { opacity:1; transform:none; } }
        @keyframes shimmer { 0%{opacity:.4} 50%{opacity:.7} 100%{opacity:.4} }
        input[type=range]{-webkit-appearance:none;appearance:none;background:#1e2030;border-radius:4px;height:3px;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;cursor:pointer;}
      `}</style>

      {/* ── Sidebar ── */}
      <aside style={{
        background: '#0d0f1e', border: '1px solid #181a2a', borderRadius: 14,
        padding: 18, height: 'fit-content', position: 'sticky', top: 20,
      }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Format
          </div>
          {SUPPORTED_FORMATS.map((f) => {
            const on = f === activeFormat;
            const col = FORMAT_COLORS[f];
            return (
              <button key={f}
                onClick={() => { setActiveFormat(f); setActiveStrategy('all'); }}
                style={{
                  display: 'block', width: '100%', marginBottom: 4,
                  background: on ? `${col}15` : 'transparent',
                  border: `1px solid ${on ? col + '50' : '#181a2a'}`,
                  color: on ? col : '#475569',
                  borderRadius: 8, padding: '8px 12px',
                  fontSize: 13, fontWeight: on ? 700 : 400,
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                }}
              >
                {FORMAT_LABELS[f]}
                <span style={{ float: 'right', fontSize: 10, color: on ? col + '80' : '#252840', fontFamily: 'monospace' }}>
                  {FORMAT_DECK_SIZE[f]}
                </span>
              </button>
            );
          })}
        </div>

        {activeFormat === 'commander' && (
          <div style={{ marginBottom: 18, paddingTop: 14, borderTop: '1px solid #181a2a' }}>
            <div style={{ fontSize: 11, color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Search Commander
            </div>
            <form onSubmit={handleCommanderSearch} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                type="text"
                placeholder="e.g. Atraxa, Praetors' Voice"
                value={cmdSearch}
                onChange={(e) => { setCmdSearch(e.target.value); setCmdSearchError(null); }}
                disabled={cmdSearching}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#080a18', border: '1px solid #1e2030',
                  borderRadius: 7, padding: '7px 10px',
                  color: '#e2e8f0', fontSize: 12, outline: 'none',
                  opacity: cmdSearching ? 0.5 : 1,
                }}
              />
              <button
                type="submit"
                disabled={cmdSearching || !cmdSearch.trim()}
                style={{
                  background: cmdSearching || !cmdSearch.trim() ? '#1e2030' : '#3730a3',
                  border: 'none', borderRadius: 7, padding: '7px 0',
                  color: cmdSearching || !cmdSearch.trim() ? '#334155' : '#e2e8f0',
                  fontSize: 12, fontWeight: 600,
                  cursor: cmdSearching || !cmdSearch.trim() ? 'default' : 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {cmdSearching ? 'Searching…' : 'Add Commander'}
              </button>
              {cmdSearchError && (
                <p style={{ margin: 0, fontSize: 11, color: '#f87171', lineHeight: 1.4 }}>{cmdSearchError}</p>
              )}
            </form>
          </div>
        )}

        {strategies.length > 2 && (
          <div style={{ marginBottom: 18, paddingTop: 14, borderTop: '1px solid #181a2a' }}>
            <div style={{ fontSize: 11, color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Strategy
            </div>
            {strategies.map((s) => {
              const on = s === activeStrategy;
              return (
                <button key={s} onClick={() => setActiveStrategy(s)}
                  style={{
                    display: 'block', width: '100%', marginBottom: 2,
                    background: on ? '#181a2a' : 'transparent',
                    border: `1px solid ${on ? '#252840' : 'transparent'}`,
                    color: on ? '#e2e8f0' : '#475569',
                    borderRadius: 6, padding: '6px 10px',
                    fontSize: 12, cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.1s', textTransform: 'capitalize',
                  }}
                >
                  {s === 'all' ? '🎴 All' : `${STRATEGY_ICONS[s] ?? '🎴'} ${s}`}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ paddingTop: 14, borderTop: '1px solid #181a2a' }}>
          <div style={{ fontSize: 11, color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Score Weights
          </div>
          {Object.keys(DEFAULT_WEIGHTS).map((k) => (
            <WeightSlider key={k} k={k} value={weights[k]}
              onChange={(v) => setWeights((p) => ({ ...p, [k]: v }))} />
          ))}
          <button onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}
            style={{
              width: '100%', marginTop: 6, background: 'transparent',
              border: '1px solid #181a2a', color: '#334155',
              borderRadius: 7, padding: '7px 0', fontSize: 11, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.target.style.color = '#64748b'; e.target.style.borderColor = '#252840'; }}
            onMouseLeave={(e) => { e.target.style.color = '#334155'; e.target.style.borderColor = '#181a2a'; }}
          >
            Reset to defaults
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px', color: '#f1f5f9' }}>Deck Suggestions</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#334155' }}>
            {isLoading
              ? 'Loading catalog…'
              : catalogError === 'no_data'
                ? `No decks synced yet for ${FORMAT_LABELS[activeFormat]}`
                : catalogError === 'error'
                  ? 'Failed to load catalog'
                  : `${displayDecks.length} ${FORMAT_LABELS[activeFormat]} decks · sorted by your weights`
            }
            {syncDate && !isLoading && !catalogError && (
              <span style={{ color: '#252840', marginLeft: 8 }}>· synced {syncDate}</span>
            )}
          </p>
        </div>

        {loadingCatalog && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ height: 2, background: '#181a2a', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: '100%', background: FORMAT_COLORS[activeFormat],
                borderRadius: 2, animation: 'shimmer 1.2s infinite',
              }} />
            </div>
          </div>
        )}

        {catalogError === 'error' && !isLoading && (
          <div style={{ background: '#120a0a', border: '1px solid #5a1d1d', borderRadius: 12, padding: '16px 20px', color: '#fca5a5', fontSize: 13, lineHeight: 1.6 }}>
            <strong>Failed to load deck catalog.</strong><br />
            Ensure Firestore rules allow reads from <code style={{ background: '#1a0a0a', padding: '1px 5px', borderRadius: 4 }}>meta_decks/{'{'}format{'}'}/decks</code>.
          </div>
        )}

        {catalogError === 'no_data' && !isLoading && (
          <div style={{ background: '#0d0f1e', border: '1px dashed #1e2030', borderRadius: 12, padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 14 }}>🌙</div>
            <h3 style={{ color: '#e2e8f0', margin: '0 0 8px', fontSize: 16 }}>No decks synced yet</h3>
            <p style={{ color: '#334155', fontSize: 13, margin: '0 auto', maxWidth: 420, lineHeight: 1.6 }}>
              The nightly sync hasn't run for <strong style={{ color: '#475569' }}>{FORMAT_LABELS[activeFormat]}</strong>.
              Trigger the <code style={{ color: '#818cf8' }}>sync-decks</code> workflow or wait for 3 AM UTC.
            </p>
          </div>
        )}

        {!isLoading && !catalogError && rawDecks.length > 0 && displayDecks.length === 0 && (
          <div style={{ background: '#0d0f1e', border: '1px dashed #181a2a', borderRadius: 12, padding: 40, textAlign: 'center', color: '#334155', fontSize: 13 }}>
            No decks match the current filters. Try a different strategy.
          </div>
        )}

        {!loadingCatalog && displayDecks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {displayDecks.map((deck, i) => (
              <DeckCard key={deck.id} deck={deck} rank={i + 1} onClick={() => setDetailDeck(deck)} />
            ))}
          </div>
        )}
      </main>

      {detailDeck && (
        <DeckDetailModal
          deck={detailDeck}
          onClose={() => setDetailDeck(null)}
          userCollection={userCollection}
        />
      )}
    </div>
  );
}
